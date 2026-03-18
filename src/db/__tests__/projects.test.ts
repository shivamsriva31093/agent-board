import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createQueries, type Queries } from "../queries";
import { createService } from "../service";

// Helper: create a fresh in-memory db with schema applied
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(__dirname, "..", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

let db: Database.Database;
let q: Queries;

beforeEach(() => {
  db = freshDb();
  q = createQueries(db);
});

afterEach(() => {
  db.close();
});

describe("project queries", () => {
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

  describe("getProject", () => {
    it("returns a single project by id", () => {
      q.upsertProject({
        id: "acme-app",
        display_name: "Acme App",
        description: "Example app",
        aliases: ["dm"],
        repo_paths: ["acme-app"],
      });
      const project = q.getProject("acme-app");
      expect(project).toBeDefined();
      expect(project!.id).toBe("acme-app");
      expect(project!.description).toBe("Example app");
      expect(project!.aliases).toEqual(["dm"]);
    });

    it("returns undefined for unknown id", () => {
      expect(q.getProject("nope")).toBeUndefined();
    });
  });

  describe("insertMention + getMentions", () => {
    it("links an entry to a mentioned project", () => {
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
      q.insertMention(entry.id, "acme-app");

      const mentions = q.getMentions("acme-app", 0, 10);
      expect(mentions).toHaveLength(1);
    });
  });

  describe("getEntrySummariesByIds", () => {
    it("returns entry summaries for given ids", () => {
      q.upsertAgent({
        id: "proj/agent-abc",
        project: "proj",
        agent_type: "opus",
        avatar_seed: "seed",
        first_seen: 1000,
        last_seen: 1000,
      });
      const e1 = q.insertEntry({
        agent_id: "proj/agent-abc",
        text: "first post",
        summary: "first",
        entry_type: "discovery",
        scope: null,
        mood: null,
        code_block: null,
        screenshot: null,
        tags: JSON.stringify(["tag1"]),
        created_at: 1000,
      });
      const e2 = q.insertEntry({
        agent_id: "proj/agent-abc",
        text: "second post",
        summary: "second",
        entry_type: "shipped",
        scope: null,
        mood: null,
        code_block: null,
        screenshot: null,
        tags: JSON.stringify(["tag2"]),
        created_at: 2000,
      });

      const summaries = q.getEntrySummariesByIds([e1.id, e2.id]);
      expect(summaries).toHaveLength(2);
      // ordered by created_at DESC
      expect(summaries[0].summary).toBe("second");
      expect(summaries[1].summary).toBe("first");
      expect(summaries[0].tags).toEqual(["tag2"]);
    });

    it("returns empty array for empty ids", () => {
      expect(q.getEntrySummariesByIds([])).toEqual([]);
    });
  });
});

// ── Service-level tests ────────────────────────────────────────────

// Reuse freshDb under an alias the task spec uses
const createTestDb = freshDb;

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
      expect(svc.resolveProject("acme-app")).toBe("acme-app");
    });

    it("auto-creates project for unknown dir", () => {
      const id = svc.resolveProject("new-project");
      expect(id).toBe("new-project");
    });
  });

  describe("mention matching in postInsight", () => {
    it("creates entry_mentions when tags match a project alias", async () => {
      svc.registerProject("acme-app", {
        display_name: "Acme App",
        aliases: ["acme", "daily-tests"],
      });

      const result = await svc.postInsight({
        agentId: "curator/main-abc123",
        project: "curator",
        text: "shipped some acme cards",
        tags: ["acme", "instagram"],
      });

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
