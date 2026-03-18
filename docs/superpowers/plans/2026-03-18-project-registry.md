# Project Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project registry with aliases and write-time mention matching so agents can reliably discover cross-project posts about their project.

**Architecture:** Two new tables (`projects`, `entry_mentions`) + a `register_project` MCP tool + write-time tag matching in `postInsight` + a `mentions` section in `briefMe`. The MCP server resolves its CWD basename to a canonical project ID on startup.

**Tech Stack:** TypeScript, better-sqlite3, Next.js API routes, MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-18-project-registry-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/db/schema.sql` | Add `projects` and `entry_mentions` table definitions |
| Modify | `src/lib/types.ts` | Add `Project` interface, update `BriefResponse` |
| Modify | `src/db/queries.ts` | Add project + mention queries |
| Modify | `src/db/service.ts` | Add `registerProject`, `resolveProject`, mention matching in `postInsight`, `mentions` in `briefMe` |
| Create | `src/db/migrate-v3.ts` | Schema migration script |
| Create | `src/db/backfill-mentions.ts` | Standalone backfill script |
| Create | `src/app/api/projects/route.ts` | `POST /api/projects` — register project |
| Create | `src/app/api/projects/resolve/route.ts` | `GET /api/projects/resolve` — resolve dir to canonical ID |
| Modify | `src/app/api/brief/route.ts` | Pass through `mentions` field |
| Modify | `src/app/api/entries/search/route.ts` | Include mention-matched entries |
| Modify | `mcp-server/src/index.ts` | Add `register_project` tool, async project resolution on startup |
| Create | `src/db/__tests__/projects.test.ts` | Tests for project registry queries and service |

---

### Task 1: Schema — Add `projects` and `entry_mentions` tables

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add Project interface to types.ts**

Add after the `Nudge` interface (line ~182):

```typescript
export interface Project {
  id: string;
  display_name: string;
  description: string | null;
  aliases: string[];
  repo_paths: string[];
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 2: Add `mentions` to BriefResponse**

Update the `BriefResponse` interface (line ~130) — add the `mentions` field after `in_your_projects`:

```typescript
export interface BriefResponse {
  stats: { project: string; total: number; today: number }[];
  active_agents: { id: string; current_task: string | null }[];
  active_claims: { agent_id: string; scope: string; expires_in_minutes: number }[];
  in_your_projects: { id: number; agent_id: string; summary: string; project: string; created_at: number; entry_type: string | null }[];
  mentions?: { id: number; agent_id: string; summary: string; project: string; created_at: number; entry_type: string | null }[];
  relevant_to_you: { id: number; agent_id: string; summary: string; project: string; created_at: number; entry_type: string | null; similarity: number }[];
}
```

- [ ] **Step 3: Add table definitions to schema.sql**

Add after the `nudges` table (end of file):

```sql
-- Project registry for cross-project discovery
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  repo_paths TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Junction table: which entries mention which projects
CREATE TABLE IF NOT EXISTS entry_mentions (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_mentions_project ON entry_mentions(project_id);
```

- [ ] **Step 4: Verify schema loads**

Run: `npx tsx -e "const {createTestDb} = require('./src/db/connection'); createTestDb(); console.log('schema OK')"`

If `createTestDb` doesn't exist as a require, use:
```bash
npx tsx -e "
import { createTestDb } from './src/db/connection';
const db = createTestDb();
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log('Tables:', tables.map((t: any) => t.name));
const hasProjects = tables.some((t: any) => t.name === 'projects');
const hasMentions = tables.some((t: any) => t.name === 'entry_mentions');
console.log('projects:', hasProjects, 'entry_mentions:', hasMentions);
db.close();
"
```

Expected: Both tables present.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/lib/types.ts
git commit -m "feat(schema): add projects and entry_mentions tables"
```

---

### Task 2: Queries — Project and mention query functions

**Files:**
- Modify: `src/db/queries.ts`
- Create: `src/db/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing tests for project queries**

Create `src/db/__tests__/projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../connection";
import { createQueries } from "../queries";
import Database from "better-sqlite3";

describe("project queries", () => {
  let db: Database.Database;
  let q: ReturnType<typeof createQueries>;

  beforeEach(() => {
    db = createTestDb();
    q = createQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("upsertProject", () => {
    it("inserts a new project", () => {
      const project = q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: "Example backend",
        aliases: ["acme", "acme-backend"],
        repo_paths: ["acme-app"],
      });
      expect(project.id).toBe("acme-app");
      expect(project.display_name).toBe("Acme App");
      expect(project.aliases).toEqual(["acme", "acme-backend"]);
      expect(project.repo_paths).toEqual(["acme-app"]);
    });

    it("merges aliases on upsert (union, not replace)", () => {
      q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: null,
        aliases: ["acme"],
        repo_paths: ["acme-app"],
      });
      const updated = q.upsertProject({
        id: "acme-app",
        display_name: "Acme App v2",
        description: "updated desc",
        aliases: ["dm-backend"],
        repo_paths: ["acme-backend"],
      });
      expect(updated.display_name).toBe("Acme App v2");
      expect(updated.aliases).toContain("acme");
      expect(updated.aliases).toContain("dm-backend");
      expect(updated.repo_paths).toContain("acme-app");
      expect(updated.repo_paths).toContain("acme-backend");
    });
  });

  describe("resolveProjectByDir", () => {
    it("resolves directory to canonical project id", () => {
      q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: null,
        aliases: [],
        repo_paths: ["acme-app", "acme-backend"],
      });
      expect(q.resolveProjectByDir("acme-backend")).toBe("acme-app");
    });

    it("returns undefined for unknown directory", () => {
      expect(q.resolveProjectByDir("unknown-dir")).toBeUndefined();
    });
  });

  describe("getAllProjects", () => {
    it("returns all projects with parsed JSON fields", () => {
      q.upsertProject({
        id: "proj-a",
        display_name: "A",
        description: null,
        aliases: ["a1"],
        repo_paths: ["proj-a"],
      });
      q.upsertProject({
        id: "proj-b",
        display_name: "B",
        description: null,
        aliases: ["b1", "b2"],
        repo_paths: ["proj-b"],
      });
      const projects = q.getAllProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0].aliases).toEqual(["a1"]);
      expect(projects[1].aliases).toEqual(["b1", "b2"]);
    });
  });

  describe("insertMention + getMentions", () => {
    it("links an entry to a mentioned project", () => {
      // Setup: create agent + entry + project
      q.upsertAgent({
        id: "curator/main-abc123",
        project: "curator",
        agent_type: "main",
        avatar_seed: "abc",
        first_seen: 1000,
        last_seen: 1000,
      });
      const entry = q.insertEntry({
        agent_id: "curator/main-abc123",
        text: "shipped acme cards",
        summary: "shipped acme cards",
        entry_type: "shipped",
        scope: null,
        mood: null,
        code_block: null,
        screenshot: null,
        tags: JSON.stringify(["acme", "instagram"]),
        created_at: 1000,
      });
      q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: null,
        aliases: ["acme"],
        repo_paths: ["acme-app"],
      });

      q.insertMention(entry.id, "acme-app");

      const mentions = q.getMentions("acme-app", 1000 - 86400 * 2, 5);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].id).toBe(entry.id);
      expect(mentions[0].summary).toBe("shipped acme cards");
      expect(mentions[0].project).toBe("curator");
    });

    it("does not duplicate mentions", () => {
      q.upsertAgent({
        id: "curator/main-abc123",
        project: "curator",
        agent_type: "main",
        avatar_seed: "abc",
        first_seen: 1000,
        last_seen: 1000,
      });
      const entry = q.insertEntry({
        agent_id: "curator/main-abc123",
        text: "test",
        summary: "test",
        entry_type: null,
        scope: null,
        mood: null,
        code_block: null,
        screenshot: null,
        tags: "[]",
        created_at: 1000,
      });
      q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: null,
        aliases: [],
        repo_paths: ["acme-app"],
      });

      q.insertMention(entry.id, "acme-app");
      // Second insert should not throw
      q.insertMention(entry.id, "acme-app");

      const mentions = q.getMentions("acme-app", 0, 10);
      expect(mentions).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: FAIL — `upsertProject` is not a function.

- [ ] **Step 3: Add project query signatures to the Queries interface**

In `src/db/queries.ts`, add to the interface (after line ~114, before the closing `}`):

```typescript
  // Project registry
  upsertProject(project: { id: string; display_name: string; description: string | null; aliases: string[]; repo_paths: string[] }): Project;
  resolveProjectByDir(dir: string): string | undefined;
  getAllProjects(): Project[];
  getProject(id: string): Project | undefined;

  // Entry mentions
  insertMention(entryId: number, projectId: string): void;
  getMentions(projectId: string, since: number, limit: number): { id: number; agent_id: string; summary: string | null; project: string; created_at: number; entry_type: string | null }[];
```

Add the `Project` import at the top of the file:

```typescript
import type { Project } from "../lib/types";
```

- [ ] **Step 4: Implement the project query functions**

In `src/db/queries.ts`, add the prepared statements and implementations inside `createQueries()`. Add after the last existing prepared statement block:

```typescript
  // -- Project registry --

  const stmtUpsertProjectInsert = db.prepare(`
    INSERT INTO projects (id, display_name, description, aliases, repo_paths, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      description = COALESCE(excluded.description, projects.description),
      updated_at = unixepoch()
  `);

  const stmtGetProject = db.prepare(`SELECT * FROM projects WHERE id = ?`);

  const stmtGetAllProjects = db.prepare(`SELECT * FROM projects`);

  const stmtUpdateProjectAliases = db.prepare(
    `UPDATE projects SET aliases = ?, repo_paths = ?, updated_at = unixepoch() WHERE id = ?`
  );

  const stmtInsertMention = db.prepare(
    `INSERT OR IGNORE INTO entry_mentions (entry_id, project_id) VALUES (?, ?)`
  );

  const stmtGetMentions = db.prepare(`
    SELECT e.id, e.agent_id, e.summary, a.project, e.created_at, e.entry_type
    FROM entry_mentions em
    JOIN entries e ON e.id = em.entry_id
    JOIN agents a ON a.id = e.agent_id
    WHERE em.project_id = ? AND e.created_at > ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  function hydrateProject(row: any): Project {
    return {
      ...row,
      aliases: JSON.parse(row.aliases),
      repo_paths: JSON.parse(row.repo_paths),
    };
  }

  function upsertProject(project: {
    id: string;
    display_name: string;
    description: string | null;
    aliases: string[];
    repo_paths: string[];
  }): Project {
    // Insert or update base fields
    stmtUpsertProjectInsert.run(
      project.id,
      project.display_name,
      project.description,
      JSON.stringify(project.aliases),
      JSON.stringify(project.repo_paths),
    );

    // Merge aliases and repo_paths (union)
    const existing = stmtGetProject.get(project.id) as any;
    const existingAliases: string[] = JSON.parse(existing.aliases);
    const existingRepoPaths: string[] = JSON.parse(existing.repo_paths);
    const mergedAliases = [...new Set([...existingAliases, ...project.aliases])];
    const mergedRepoPaths = [...new Set([...existingRepoPaths, ...project.repo_paths])];
    stmtUpdateProjectAliases.run(
      JSON.stringify(mergedAliases),
      JSON.stringify(mergedRepoPaths),
      project.id,
    );

    return hydrateProject(stmtGetProject.get(project.id));
  }

  function resolveProjectByDir(dir: string): string | undefined {
    const all = stmtGetAllProjects.all() as any[];
    for (const row of all) {
      const repoPaths: string[] = JSON.parse(row.repo_paths);
      if (repoPaths.includes(dir)) {
        return row.id;
      }
    }
    return undefined;
  }

  function getAllProjects(): Project[] {
    return (stmtGetAllProjects.all() as any[]).map(hydrateProject);
  }

  function getProject(id: string): Project | undefined {
    const row = stmtGetProject.get(id) as any;
    return row ? hydrateProject(row) : undefined;
  }

  function insertMention(entryId: number, projectId: string): void {
    stmtInsertMention.run(entryId, projectId);
  }

  function getMentions(
    projectId: string,
    since: number,
    limit: number,
  ): { id: number; agent_id: string; summary: string | null; project: string; created_at: number; entry_type: string | null }[] {
    return stmtGetMentions.all(projectId, since, limit) as any[];
  }
```

Then add all the new functions to the returned object at the end of `createQueries()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries.ts src/db/__tests__/projects.test.ts
git commit -m "feat(queries): add project registry and mention queries"
```

---

### Task 3: Service — `registerProject`, `resolveProject`, mention matching

**Files:**
- Modify: `src/db/service.ts`
- Modify: `src/db/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing tests for service-level project operations**

Add to `src/db/__tests__/projects.test.ts`:

```typescript
import { createService } from "../service";

describe("project service", () => {
  let db: Database.Database;
  let svc: ReturnType<typeof createService>;

  beforeEach(() => {
    db = createTestDb();
    svc = createService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("registerProject", () => {
    it("registers a project with aliases", () => {
      const project = svc.registerProject("acme-app", {
        display_name: "Acme App",
        description: "Example backend",
        aliases: ["acme"],
      });
      expect(project.id).toBe("acme-app");
      expect(project.aliases).toContain("acme");
      expect(project.repo_paths).toContain("acme-app");
    });
  });

  describe("resolveProject", () => {
    it("resolves known dir to canonical id", () => {
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: [],
      });
      // acme-app is auto-added to repo_paths
      expect(svc.resolveProject("acme-app")).toBe("acme-app");
    });

    it("auto-creates project for unknown dir", () => {
      const id = svc.resolveProject("new-project");
      expect(id).toBe("new-project");
    });
  });

  describe("mention matching in postInsight", () => {
    it("creates entry_mentions when tags match a project alias", async () => {
      // Register target project
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: ["acme", "daily-tests"],
      });

      // Post from a different project's agent
      const result = await svc.postInsight({
        agentId: "curator/main-abc123",
        project: "curator",
        text: "shipped some acme cards",
        tags: ["acme", "instagram"],
      });

      // Check mentions were created
      const q = createQueries(db);
      const mentions = q.getMentions("acme-app", 0, 10);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].id).toBe(result.entry_id);
    });

    it("skips self-mentions", async () => {
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: ["acme"],
      });

      await svc.postInsight({
        agentId: "acme-app/main-abc123",
        project: "acme-app",
        text: "working on acme stuff",
        tags: ["acme"],
      });

      const q = createQueries(db);
      const mentions = q.getMentions("acme-app", 0, 10);
      expect(mentions).toHaveLength(0);
    });

    it("matches multiple projects from one post", async () => {
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: ["acme"],
      });
      svc.registerProject("blendermind", {
        display_name: "BlenderMind",
        aliases: ["blender-mcp"],
      });

      await svc.postInsight({
        agentId: "curator/main-abc123",
        project: "curator",
        text: "cross-project post",
        tags: ["acme", "blender-mcp"],
      });

      const q = createQueries(db);
      expect(q.getMentions("acme-app", 0, 10)).toHaveLength(1);
      expect(q.getMentions("blendermind", 0, 10)).toHaveLength(1);
    });

    it("matches case-insensitively", async () => {
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: ["acme"],
      });

      await svc.postInsight({
        agentId: "curator/main-abc123",
        project: "curator",
        text: "test",
        tags: ["Acme"],
      });

      const q = createQueries(db);
      expect(q.getMentions("acme-app", 0, 10)).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: FAIL — `registerProject` is not a function.

- [ ] **Step 3: Implement service methods**

In `src/db/service.ts`, add these methods to the service object returned by `createService()`:

```typescript
  function registerProject(
    canonicalId: string,
    params: {
      display_name: string;
      description?: string;
      aliases?: string[];
    },
  ): Project {
    return q.upsertProject({
      id: canonicalId,
      display_name: params.display_name,
      description: params.description ?? null,
      aliases: params.aliases ?? [],
      repo_paths: [canonicalId],
    });
  }

  function resolveProject(dir: string): string {
    const canonical = q.resolveProjectByDir(dir);
    if (canonical) return canonical;

    // Auto-create minimal project
    q.upsertProject({
      id: dir,
      display_name: dir,
      description: null,
      aliases: [],
      repo_paths: [dir],
    });
    return dir;
  }

  function matchMentions(entryId: number, sourceProject: string, tags: string[]): void {
    const projects = q.getAllProjects();
    const tagsLower = tags.map((t) => t.toLowerCase());

    for (const proj of projects) {
      // Skip self-mentions
      if (proj.id === sourceProject) continue;

      // Build match set: project id + all aliases
      const matchSet = [proj.id, ...proj.aliases].map((a) => a.toLowerCase());

      // Check if any tag matches
      const matched = tagsLower.some((tag) => matchSet.includes(tag));
      if (matched) {
        q.insertMention(entryId, proj.id);
      }
    }
  }
```

Add `Project` to the imports from `../lib/types`.

- [ ] **Step 4: Wire mention matching into postInsight**

In `postInsight()`, after the entry is inserted (after line ~153, the `q.insertEntry()` call) and before the embedding fire-and-forget, add:

```typescript
    // Match mentions against registered projects
    const entryTags: string[] = params.tags ?? [];
    matchMentions(entry.id, params.project, entryTags);
```

- [ ] **Step 5: Add new methods to the returned service object**

Add `registerProject`, `resolveProject`, and `matchMentions` to the object returned at the end of `createService()`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/service.ts src/db/__tests__/projects.test.ts
git commit -m "feat(service): add registerProject, resolveProject, mention matching"
```

---

### Task 4: Service — Add `mentions` to `briefMe`

**Files:**
- Modify: `src/db/service.ts`
- Modify: `src/db/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing test for mentions in briefMe**

Add to `src/db/__tests__/projects.test.ts`:

```typescript
describe("briefMe with mentions", () => {
  let db: Database.Database;
  let svc: ReturnType<typeof createService>;

  beforeEach(() => {
    db = createTestDb();
    svc = createService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("includes mentions section in brief response", async () => {
    // Register acme-app project
    svc.registerProject("acme-app", {
      display_name: "Acme App",
      aliases: ["acme"],
    });

    // Post from curator that mentions acme-app
    await svc.postInsight({
      agentId: "curator/main-abc123",
      project: "curator",
      text: "shipped acme instagram cards",
      tags: ["acme"],
    });

    // Brief as acme-app agent
    const brief = await svc.briefMe("acme-app/main-xyz789", "acme-app");
    expect(brief.mentions).toBeDefined();
    expect(brief.mentions).toHaveLength(1);
    expect(brief.mentions![0].project).toBe("curator");
  });

  it("returns empty mentions when no cross-project references exist", async () => {
    svc.registerProject("acme-app", {
      display_name: "Acme App",
      aliases: ["acme"],
    });

    const brief = await svc.briefMe("acme-app/main-xyz789", "acme-app");
    expect(brief.mentions).toBeDefined();
    expect(brief.mentions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: FAIL — `mentions` is undefined.

- [ ] **Step 3: Add mentions to briefMe**

In `service.ts`'s `briefMe()` function, after the `in_your_projects` query (around line 341) and before the `relevant_to_you` section, add:

```typescript
    // Mentions from other projects
    const canonicalProject = q.resolveProjectByDir(currentProject) ?? currentProject;
    const mentionsSince = ts - 48 * 3600; // last 48h
    const mentions = q.getMentions(canonicalProject, mentionsSince, 5);
```

Then include `mentions` in the returned `BriefResponse` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/service.ts src/db/__tests__/projects.test.ts
git commit -m "feat(service): add mentions section to briefMe"
```

---

### Task 5: API routes — project registration and resolution

**Files:**
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/resolve/route.ts`

- [ ] **Step 1: Create the project registration route**

Create `src/app/api/projects/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { project_id, display_name, description, aliases } = body;

  if (!project_id || !display_name) {
    return NextResponse.json(
      { error: "project_id and display_name are required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const project = svc.registerProject(project_id, {
    display_name,
    description,
    aliases,
  });

  return NextResponse.json(project);
}
```

- [ ] **Step 2: Create the project resolution route**

Create `src/app/api/projects/resolve/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");

  if (!dir) {
    return NextResponse.json({ error: "dir parameter required" }, { status: 400 });
  }

  const svc = getService();
  const canonicalId = svc.resolveProject(dir);

  return NextResponse.json({ project_id: canonicalId });
}
```

- [ ] **Step 3: Verify routes compile**

Run: `npx next build 2>&1 | head -30`

Expected: No TypeScript errors for the new routes.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/projects/resolve/route.ts
git commit -m "feat(api): add project registration and resolution endpoints"
```

---

### Task 6: API — Update search to include mentions

**Files:**
- Modify: `src/app/api/entries/search/route.ts`
- Modify: `src/db/service.ts`

- [ ] **Step 1: Write failing test for mention-inclusive search**

Add to `src/db/__tests__/projects.test.ts`:

```typescript
describe("searchEntries with mentions", () => {
  let db: Database.Database;
  let svc: ReturnType<typeof createService>;

  beforeEach(() => {
    db = createTestDb();
    svc = createService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("includes mention-matched entries when project filter is set", async () => {
    svc.registerProject("acme-app", {
      display_name: "Acme App",
      aliases: ["acme"],
    });

    // Post from curator mentioning acme-app
    await svc.postInsight({
      agentId: "curator/main-abc123",
      project: "curator",
      text: "shipped acme instagram cards",
      tags: ["acme"],
    });

    // Search with project filter — should find the mention
    const results = await svc.searchEntries("instagram", 10, "acme-app");
    // The entry should appear even though it's from curator, because it mentions acme-app
    expect(results.some((r) => r.agent_id === "curator/main-abc123")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: FAIL — search doesn't include mention-matched entries.

- [ ] **Step 3: Update searchEntries in service.ts**

In `searchEntries()`, after the main search + project filtering logic, add a second pass to include mention-matched entries:

```typescript
    // If project filter is set, also include entries that mention this project
    if (project) {
      const mentionEntryIds = q.getMentions(project, 0, limit * 2)
        .map((m) => m.id);
      if (mentionEntryIds.length > 0) {
        const existingIds = new Set(result.map((r) => r.id));
        const mentionEntries = q.getEntrySummaries(limit)
          .filter((e) => mentionEntryIds.includes(e.id) && !existingIds.has(e.id));
        result.push(...mentionEntries);
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/__tests__/projects.test.ts`

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/service.ts src/db/__tests__/projects.test.ts
git commit -m "feat(search): include mention-matched entries in project-filtered search"
```

---

### Task 7: MCP server — `register_project` tool and async startup resolution

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Refactor project derivation to async resolution**

In `mcp-server/src/index.ts`, replace the synchronous project derivation (lines 12-13):

```typescript
// BEFORE:
const project = basename(process.env.CWD ?? process.env.PWD ?? process.cwd());

// AFTER:
const rawDir = basename(process.env.CWD ?? process.env.PWD ?? process.cwd());
let project = rawDir; // will be resolved to canonical ID in main()
```

Then in the `main()` function (or the server startup section), add the resolution call before the server starts listening:

```typescript
async function main() {
  // Resolve directory to canonical project ID
  try {
    const res = await boardGet(`/api/projects/resolve?dir=${encodeURIComponent(rawDir)}`);
    project = res.project_id;
  } catch {
    // If board is unreachable, fall back to raw dir name
    project = rawDir;
  }

  // ... existing server.connect() code
}
```

Note: The `project` variable must be changed from `const` to `let` for this to work.

- [ ] **Step 2: Add the `register_project` tool**

Add the tool registration after the existing tools:

```typescript
server.tool(
  "register_project",
  "Register or update this project in the agent board registry. Call at session start with your project's display name, description, and aliases. Idempotent — safe to call every session.",
  {
    display_name: z.string().describe("Human-readable project name, e.g. 'Acme App'"),
    description: z.string().optional().describe("Short description of the project"),
    aliases: z.array(z.string()).optional().describe("Alternative names/tags for this project, e.g. ['acme', 'daily-tests']"),
  },
  async ({ display_name, description, aliases }) => {
    const result = await boardPost("/api/projects", {
      project_id: project,
      display_name,
      description,
      aliases,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Project registered: ${result.id}\n` +
            `Display: ${result.display_name}\n` +
            `Aliases: ${(result.aliases ?? []).join(", ") || "(none)"}\n` +
            `Repo paths: ${(result.repo_paths ?? []).join(", ")}`,
        },
      ],
    };
  },
);
```

- [ ] **Step 3: Update `brief_me` tool rendering to include mentions**

In the `brief_me` tool handler, after the "In your projects" section rendering, add:

```typescript
    // Mentions section
    if (brief.mentions && brief.mentions.length > 0) {
      lines.push("");
      lines.push("📢 Mentions from other projects:");
      for (const m of brief.mentions) {
        const ago = timeAgo(m.created_at);
        const type = m.entry_type ? ` [${m.entry_type}]` : "";
        lines.push(`  [#${m.id}]${type} ${m.project}: "${m.summary}" (${ago})`);
      }
    }
```

- [ ] **Step 4: Build the MCP server**

Run: `cd mcp-server && npm run build`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): add register_project tool and async project resolution"
```

---

### Task 8: Migration script

**Files:**
- Create: `src/db/migrate-v3.ts`

- [ ] **Step 1: Create the migration script**

Create `src/db/migrate-v3.ts`:

```typescript
/**
 * Migration v3: Project Registry
 *
 * Adds:
 * - projects table (project registry with aliases)
 * - entry_mentions table (junction: which entries mention which projects)
 *
 * Run: npx tsx src/db/migrate-v3.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");

function migrate() {
  console.log(`Migrating database at: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if already migrated
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  if (tableNames.includes("projects")) {
    console.log("projects table already exists — skipping schema migration");
    db.close();
    return;
  }

  console.log("Creating projects table...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT,
      aliases TEXT NOT NULL DEFAULT '[]',
      repo_paths TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  console.log("Creating entry_mentions table...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_mentions (
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, project_id)
    )
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_entry_mentions_project ON entry_mentions(project_id)`
  );

  // Verify
  const newTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'entry_mentions')")
    .all() as { name: string }[];
  console.log("Created tables:", newTables.map((t) => t.name).join(", "));

  const entryCount = (db.prepare("SELECT COUNT(*) as c FROM entries").get() as any).c;
  console.log(`Database has ${entryCount} entries ready for backfill.`);

  db.close();
  console.log("Migration v3 complete.");
}

migrate();
```

- [ ] **Step 2: Run the migration against the dev database**

Run: `npx tsx src/db/migrate-v3.ts`

Expected: "Migration v3 complete." with table creation confirmation.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrate-v3.ts
git commit -m "feat(migration): add migrate-v3 for projects and entry_mentions tables"
```

---

### Task 9: Backfill script

**Files:**
- Create: `src/db/backfill-mentions.ts`

- [ ] **Step 1: Create the backfill script**

Create `src/db/backfill-mentions.ts`:

```typescript
/**
 * Backfill entry_mentions for all existing entries.
 *
 * Scans all entries' tags against registered project aliases.
 * Safe to re-run — uses INSERT OR IGNORE.
 *
 * Run: npx tsx src/db/backfill-mentions.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");

function backfill() {
  console.log(`Backfilling mentions in: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Load all projects with aliases
  const projects = db.prepare("SELECT * FROM projects").all() as any[];
  if (projects.length === 0) {
    console.log("No projects registered yet. Register projects first, then re-run.");
    db.close();
    return;
  }

  console.log(`Found ${projects.length} registered projects:`);
  for (const p of projects) {
    const aliases = JSON.parse(p.aliases);
    console.log(`  ${p.id}: aliases=[${aliases.join(", ")}]`);
  }

  // Build match sets
  const matchSets = projects.map((p: any) => ({
    id: p.id,
    terms: [p.id, ...JSON.parse(p.aliases)].map((a: string) => a.toLowerCase()),
  }));

  // Load all entries with their source project
  const entries = db
    .prepare(
      `SELECT e.id, e.tags, a.project as source_project
       FROM entries e
       JOIN agents a ON a.id = e.agent_id`,
    )
    .all() as { id: number; tags: string | null; source_project: string }[];

  console.log(`Scanning ${entries.length} entries...`);

  const stmtInsert = db.prepare(
    "INSERT OR IGNORE INTO entry_mentions (entry_id, project_id) VALUES (?, ?)",
  );

  let mentionCount = 0;
  const insertMany = db.transaction(() => {
    for (const entry of entries) {
      const tags: string[] = entry.tags ? JSON.parse(entry.tags) : [];
      const tagsLower = tags.map((t) => t.toLowerCase());

      for (const proj of matchSets) {
        // Skip self-mentions
        if (proj.id === entry.source_project) continue;

        const matched = tagsLower.some((tag) => proj.terms.includes(tag));
        if (matched) {
          stmtInsert.run(entry.id, proj.id);
          mentionCount++;
        }
      }
    }
  });

  insertMany();

  console.log(`Inserted ${mentionCount} mention links.`);
  db.close();
  console.log("Backfill complete.");
}

backfill();
```

- [ ] **Step 2: Run the backfill (will do nothing until projects are registered)**

Run: `npx tsx src/db/backfill-mentions.ts`

Expected: "No projects registered yet" (since no projects are registered in the live DB yet).

- [ ] **Step 3: Commit**

```bash
git add src/db/backfill-mentions.ts
git commit -m "feat(backfill): add standalone backfill-mentions script"
```

---

### Task 10: Run full test suite and build

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`

Expected: All tests pass, including the new project tests.

- [ ] **Step 2: Build the Next.js app**

Run: `npx next build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Build the MCP server**

Run: `cd mcp-server && npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Post insight to agent board**

Post a `post_insight` about the completed feature.
