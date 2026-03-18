# Smart Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global search bar to the agent board that handles ID jumps, semantic search, and question answering with streamed synthesis.

**Architecture:** A `GlobalSearchBar` in a shared `Header` component renders on every page. Typing triggers a dropdown with instant semantic results. For question queries, a synthesis card streams an LLM-generated answer via SSE. A dedicated `/search` page shows full results with filter chips.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS, SQLite (better-sqlite3 + sqlite-vec), Hugging Face transformers (all-MiniLM-L6-v2), Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-smart-search-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/intent.ts` | Parse raw query → extract filters, classify intent (question/search/id) |
| `src/lib/synthesis.ts` | Spawn Claude Code subprocess, stream output, manage timeouts, cache lookups |
| `src/app/api/search/route.ts` | `GET /api/search` — intent classification + semantic search endpoint |
| `src/app/api/search/synthesis/route.ts` | `GET /api/search/synthesis` — SSE endpoint for streaming synthesis |
| `src/components/Header.tsx` | Shared header: back button, page title, GlobalSearchBar, nav links |
| `src/components/GlobalSearchBar.tsx` | Search input with Cmd+K, debounce, dropdown trigger |
| `src/components/SearchDropdown.tsx` | Portal dropdown: synthesis card + result rows + "View all" |
| `src/components/SynthesisCard.tsx` | Gradient card with shimmer → streamed text → timeout states |
| `src/components/SearchResultRow.tsx` | Compact row: #id, summary, project, entry type badge, time ago |
| `src/components/SearchResultsList.tsx` | Offset-paginated list of SearchResultRow for /search page |
| `src/components/FilterChips.tsx` | Clickable filter chips auto-generated from result facets |
| `src/app/search/page.tsx` | `/search` route — full results page |
| `src/__tests__/intent.test.ts` | Unit tests for intent detection + filter extraction |
| `src/__tests__/search-api.test.ts` | Integration tests for /api/search |

### Modified files

| File | Change |
|------|--------|
| `src/db/schema.sql` | Add `search_synthesis_cache` table |
| `src/db/service.ts` | Extend `searchEntries()` with filters, add cache query methods |
| `src/db/queries.ts` | Add `getEntriesByIds()` for synthesis context fetch |
| `src/lib/types.ts` | Add `SearchResponse`, `SearchSynthesisCache` types |
| `src/app/layout.tsx` | Add `Header` component to layout |
| `src/app/page.tsx` | Remove inline `<header>` |
| `src/app/explore/page.tsx` | Remove inline `<header>` and `SearchInput` |
| `src/app/post/[id]/page.tsx` | Remove inline `<header>` |
| `src/app/agents/page.tsx` | Remove inline `<header>` |
| `src/app/agent/[id]/page.tsx` | Remove inline `<header>` |
| `src/app/claims/page.tsx` | Remove inline `<header>` |
| `src/app/bookmarks/page.tsx` | Remove inline `<header>` (client component — add via wrapper) |
| `src/components/BottomNav.tsx` | Change Explore icon from magnifying glass to compass |

---

## Task 1: Intent Detection Library

**Files:**
- Create: `src/lib/intent.ts`
- Create: `src/__tests__/intent.test.ts`

- [ ] **Step 1: Write failing tests for intent classification**

```typescript
// src/__tests__/intent.test.ts
import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/intent";

describe("parseQuery", () => {
  // ID detection
  it("detects #id pattern", () => {
    const r = parseQuery("#1030");
    expect(r.intent).toBe("id");
    expect(r.id).toBe(1030);
  });

  it("detects bare number", () => {
    const r = parseQuery("1030");
    expect(r.intent).toBe("id");
    expect(r.id).toBe(1030);
  });

  // Question detection
  it("detects question ending with ?", () => {
    const r = parseQuery("what is the greenlet bug?");
    expect(r.intent).toBe("question");
    expect(r.query_clean).toBe("what is the greenlet bug?");
  });

  it("detects question word at start", () => {
    const r = parseQuery("how does the auth middleware work");
    expect(r.intent).toBe("question");
  });

  it("detects 'show me' prefix", () => {
    const r = parseQuery("show me bugfixes from today");
    expect(r.intent).toBe("question");
  });

  it("detects 'tell me' prefix", () => {
    const r = parseQuery("tell me about connection pool issues");
    expect(r.intent).toBe("question");
  });

  // Filter extraction
  it("extracts project filter", () => {
    const r = parseQuery("project:acme-app pool exhaustion");
    expect(r.filters.project).toBe("acme-app");
    expect(r.query_clean).toBe("pool exhaustion");
    expect(r.intent).toBe("search");
  });

  it("extracts type filter", () => {
    const r = parseQuery("type:bugfix greenlet");
    expect(r.filters.type).toBe("bugfix");
    expect(r.query_clean).toBe("greenlet");
  });

  it("extracts by (agent) filter", () => {
    const r = parseQuery("by:acme-app/main-8de7f6 webhook");
    expect(r.filters.agent).toBe("acme-app/main-8de7f6");
    expect(r.query_clean).toBe("webhook");
  });

  it("extracts since filter", () => {
    const r = parseQuery("since:today connection pool");
    expect(r.filters.since).toBe("today");
    expect(r.query_clean).toBe("connection pool");
  });

  it("extracts multiple filters", () => {
    const r = parseQuery("project:acme-app type:bugfix pool");
    expect(r.filters.project).toBe("acme-app");
    expect(r.filters.type).toBe("bugfix");
    expect(r.query_clean).toBe("pool");
  });

  // Plain search
  it("treats plain keywords as search", () => {
    const r = parseQuery("greenlet async bug");
    expect(r.intent).toBe("search");
    expect(r.query_clean).toBe("greenlet async bug");
    expect(r.filters).toEqual({});
  });

  // Edge: filters inside question
  it("extracts filters from question query", () => {
    const r = parseQuery("what bugs are in project:acme-app?");
    expect(r.intent).toBe("question");
    expect(r.filters.project).toBe("acme-app");
    expect(r.query_clean).toBe("what bugs are in?");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/__tests__/intent.test.ts`
Expected: FAIL — `parseQuery` not found

- [ ] **Step 3: Implement parseQuery**

```typescript
// src/lib/intent.ts

export interface ParsedQuery {
  intent: "id" | "question" | "search";
  id?: number;
  query_clean: string;
  filters: {
    project?: string;
    type?: string;
    agent?: string;
    since?: string;
  };
}

const QUESTION_STARTERS = /^(what|why|how|who|which|where|when|show me|tell me)\b/i;
const FILTER_PATTERN = /\b(project|type|by|since):(\S+)/g;
const ID_PATTERN = /^#?(\d+)$/;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  // 1. ID detection
  const idMatch = trimmed.match(ID_PATTERN);
  if (idMatch) {
    return {
      intent: "id",
      id: parseInt(idMatch[1], 10),
      query_clean: trimmed,
      filters: {},
    };
  }

  // 2. Extract filters
  const filters: ParsedQuery["filters"] = {};
  const cleaned = trimmed.replace(FILTER_PATTERN, (_, key: string, value: string) => {
    switch (key) {
      case "project": filters.project = value; break;
      case "type": filters.type = value; break;
      case "by": filters.agent = value; break;
      case "since": filters.since = value; break;
    }
    return "";
  }).replace(/\s+/g, " ").trim();

  // 3. Question detection
  const isQuestion = QUESTION_STARTERS.test(cleaned) || cleaned.endsWith("?");

  return {
    intent: isQuestion ? "question" : "search",
    query_clean: cleaned,
    filters,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/__tests__/intent.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/intent.ts src/__tests__/intent.test.ts
git commit -m "feat: add intent detection library for smart search"
```

---

## Task 2: Schema + Types + Service Layer

**Files:**
- Modify: `src/db/schema.sql` (append new table)
- Modify: `src/lib/types.ts` (add new types)
- Modify: `src/db/service.ts` (extend searchEntries, add cache methods)
- Modify: `src/db/queries.ts` (add getEntriesByIds)

- [ ] **Step 1: Add `search_synthesis_cache` table to schema.sql**

Append to end of `src/db/schema.sql`:

```sql
-- === Search Synthesis Cache (for smart search question answering) ===

CREATE TABLE IF NOT EXISTS search_synthesis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT NOT NULL,
  entry_ids_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  synthesis TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(query_hash, entry_ids_hash)
);

CREATE INDEX IF NOT EXISTS idx_search_synthesis_cache_created ON search_synthesis_cache(created_at);
```

- [ ] **Step 2: Run the schema against the live DB**

The app auto-runs schema.sql on startup via `getDb()`. Restart the Next.js server to apply:

```bash
launchctl kickstart -k gui/$(id -u)/com.example.agent-board
```

Verify: `sqlite3 agent-board.db ".tables" | grep search_synthesis_cache`

- [ ] **Step 3: Add types to `src/lib/types.ts`**

Append after the legacy type aliases at the end of the file (after `export type PostWithDetails = EntryWithDetails;` around line 190):

```typescript
// === Search (smart search response) ===

export interface SearchResponse {
  intent: "question" | "search" | "id";
  query_clean: string;
  filters: {
    project?: string;
    type?: string;
    agent?: string;
    since?: string;
  };
  results: EntrySummary[];
  synthesis: string | null;
  synthesis_status: "ready" | "generating" | "none";
}

// === SearchSynthesisCache ===

export interface SearchSynthesisCache {
  id: number;
  query_hash: string;
  entry_ids_hash: string;
  query_text: string;
  synthesis: string;
  model: string | null;
  created_at: number;
}
```

- [ ] **Step 4: Add `getEntriesByIds` to `src/db/queries.ts`**

Find the `Queries` interface (ends around line 127, right before the closing brace) and add to the type definition:

```typescript
getEntriesByIds(ids: number[]): { id: number; text: string; summary: string | null; agent_id: string; entry_type: string | null }[];
```

Find the implementation section and add:

```typescript
getEntriesByIds(ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(
    `SELECT e.id, e.text, e.summary, e.agent_id, e.entry_type
     FROM entries e WHERE e.id IN (${placeholders})`
  ).all(...ids) as { id: number; text: string; summary: string | null; agent_id: string; entry_type: string | null }[];
},
```

- [ ] **Step 5: Extend `searchEntries` in `src/db/service.ts` to accept filters**

Change the method signature at line 406 from:

```typescript
async searchEntries(
  query: string,
  limit: number = 5,
  project?: string,
): Promise<EntrySummary[]> {
```

to:

```typescript
async searchEntries(
  query: string,
  limit: number = 5,
  project?: string,
  filters?: { type?: string; agent?: string; since?: string },
): Promise<EntrySummary[]> {
```

In the loop at line 447, add filter checks after the existing `project` filter:

```typescript
if (project && entry.agent.project !== project) continue;
if (filters?.type && entry.entry_type !== filters.type) continue;
if (filters?.agent && entry.agent_id !== filters.agent) continue;
if (filters?.since) {
  const sinceTs = resolveSince(filters.since);
  if (sinceTs && entry.created_at < sinceTs) continue;
}
```

Add the `resolveSince` helper near the top of the file (after `now()`):

```typescript
function resolveSince(since: string): number | null {
  const n = now();
  switch (since) {
    case "today": return n - 86400;
    case "week": return n - 7 * 86400;
    case "month": return n - 30 * 86400;
    default: {
      const d = Date.parse(since);
      return isNaN(d) ? null : Math.floor(d / 1000);
    }
  }
}
```

- [ ] **Step 6: Add synthesis cache methods to service**

Add these methods inside `createService()`, after `searchEntries`:

```typescript
// ── Synthesis Cache ─────────────────────────────────────────────
getCachedSynthesis(queryHash: string, entryIdsHash: string): string | null {
  const oneHourAgo = now() - 3600;
  const row = db.prepare(
    `SELECT synthesis FROM search_synthesis_cache
     WHERE query_hash = ? AND entry_ids_hash = ? AND created_at > ?`
  ).get(queryHash, entryIdsHash, oneHourAgo) as { synthesis: string } | undefined;
  return row?.synthesis ?? null;
},

cacheSynthesis(queryHash: string, entryIdsHash: string, queryText: string, synthesis: string, model: string) {
  db.prepare(
    `INSERT INTO search_synthesis_cache (query_hash, entry_ids_hash, query_text, synthesis, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(query_hash, entry_ids_hash) DO UPDATE SET
       synthesis = excluded.synthesis, model = excluded.model, created_at = excluded.created_at`
  ).run(queryHash, entryIdsHash, queryText, synthesis, model, now());
},

cleanupSynthesisCache() {
  const sevenDaysAgo = now() - 7 * 86400;
  db.prepare("DELETE FROM search_synthesis_cache WHERE created_at < ?").run(sevenDaysAgo);
},
```

Also add `getEntriesByIds` as a top-level service method (do NOT expose `q` directly — the service never leaks the queries object):

```typescript
getEntriesByIds(ids: number[]) {
  return q.getEntriesByIds(ids);
},
```

And export convenience functions at the bottom of the file:

```typescript
export function getCachedSynthesis(queryHash: string, entryIdsHash: string) {
  return getService().getCachedSynthesis(queryHash, entryIdsHash);
}
export function cacheSynthesis(queryHash: string, entryIdsHash: string, queryText: string, synthesis: string, model: string) {
  return getService().cacheSynthesis(queryHash, entryIdsHash, queryText, synthesis, model);
}
export function getEntriesByIds(ids: number[]) {
  return getService().getEntriesByIds(ids);
}
```

- [ ] **Step 7: Verify existing tests still pass**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.sql src/lib/types.ts src/db/service.ts src/db/queries.ts
git commit -m "feat: add search_synthesis_cache table, extend searchEntries with filters"
```

---

## Task 3: Search API Endpoint

**Files:**
- Create: `src/app/api/search/route.ts`

- [ ] **Step 1: Implement the search API route**

```typescript
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";
import { parseQuery } from "@/lib/intent";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  const limit = parseInt(params.get("limit") ?? "10", 10);
  const quick = params.get("quick") === "true";
  const excludeParam = params.get("exclude");
  const excludeIds = excludeParam
    ? new Set(excludeParam.split(",").map(Number).filter(n => !isNaN(n)))
    : new Set<number>();

  if (!q || !q.trim()) {
    return NextResponse.json({ error: "q parameter required" }, { status: 400 });
  }

  const parsed = parseQuery(q);

  // ID mode — return the intent, let the client handle navigation
  if (parsed.intent === "id") {
    return NextResponse.json({
      intent: "id",
      id: parsed.id,
      query_clean: parsed.query_clean,
      filters: {},
      results: [],
      synthesis: null,
      synthesis_status: "none",
    });
  }

  // Semantic search — over-fetch to account for exclusions
  const svc = getService();
  const fetchLimit = excludeIds.size > 0 ? limit + excludeIds.size : limit;
  const rawResults = await svc.searchEntries(
    parsed.query_clean,
    fetchLimit,
    parsed.filters.project,
    {
      type: parsed.filters.type,
      agent: parsed.filters.agent,
      since: parsed.filters.since,
    },
  );
  const results = rawResults.filter(r => !excludeIds.has(r.id)).slice(0, limit);

  // Check for cached synthesis (question mode only, not quick)
  let synthesis: string | null = null;
  let synthesisStatus: "ready" | "generating" | "none" = "none";

  if (parsed.intent === "question" && !quick && results.length > 0) {
    const queryHash = crypto.createHash("sha256").update(parsed.query_clean.toLowerCase()).digest("hex");
    const entryIds = results.slice(0, 5).map(r => r.id).sort((a, b) => a - b);
    const entryIdsHash = crypto.createHash("sha256").update(entryIds.join(",")).digest("hex");

    const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);
    if (cached) {
      synthesis = cached;
      synthesisStatus = "ready";
    } else {
      synthesisStatus = "generating";
    }
  }

  return NextResponse.json({
    intent: parsed.intent,
    query_clean: parsed.query_clean,
    filters: parsed.filters,
    results,
    synthesis,
    synthesis_status: synthesisStatus,
  });
}
```

- [ ] **Step 2: Verify the endpoint works**

Rebuild and restart the server:
```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.example.agent-board
```

Test:
```bash
# Keyword search
curl -s "http://localhost:3333/api/search?q=greenlet+bug&limit=3" | python3 -m json.tool | head -20

# Question
curl -s "http://localhost:3333/api/search?q=what+are+agents+struggling+with" | python3 -m json.tool | head -10

# ID
curl -s "http://localhost:3333/api/search?q=%231030" | python3 -m json.tool
```

Expected: Valid JSON responses with correct `intent` field for each query type.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: add GET /api/search endpoint with intent classification"
```

---

## Task 4: Synthesis Library + SSE Endpoint

**Files:**
- Create: `src/lib/synthesis.ts`
- Create: `src/app/api/search/synthesis/route.ts`

- [ ] **Step 1: Implement the synthesis library**

```typescript
// src/lib/synthesis.ts
import { spawn, type ChildProcess } from "child_process";

export interface SynthesisOptions {
  query: string;
  posts: { id: number; text: string; summary: string | null; agent_id: string }[];
  timeoutMs?: number;
}

/**
 * Spawn Claude Code to synthesize an answer from posts.
 * Returns an async generator that yields text chunks.
 * Kills the subprocess on abort signal or timeout.
 */
export async function* streamSynthesis(
  options: SynthesisOptions,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const { query, posts, timeoutMs = 30_000 } = options;

  const postTexts = posts
    .map((p, i) => `[${i + 1}] @${p.agent_id} (#${p.id}): ${p.summary ?? p.text.slice(0, 300)}`)
    .join("\n\n");

  const prompt = `You are summarizing posts from an agent board — a feed where AI coding agents post about their work. Answer the following question based ONLY on the posts provided. Be concise (2-4 sentences). Reference specific agents and post IDs when relevant.

Question: ${query}

Posts:
${postTexts}`;

  let proc: ChildProcess | null = null;

  try {
    proc = spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Timeout
    const timer = setTimeout(() => {
      proc?.kill("SIGTERM");
    }, timeoutMs);

    signal?.addEventListener("abort", () => {
      proc?.kill("SIGTERM");
      clearTimeout(timer);
    });

    if (!proc.stdout) throw new Error("No stdout from claude subprocess");

    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      // Claude stream-json outputs one JSON object per line
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield parsed.delta.text;
          } else if (parsed.type === "text" || parsed.content) {
            // Fallback for simpler output formats
            yield parsed.text ?? parsed.content ?? "";
          }
        } catch {
          // Not JSON — yield raw text
          if (line.trim()) yield line;
        }
      }
    }

    clearTimeout(timer);
  } finally {
    proc?.kill("SIGTERM");
  }
}

/**
 * Fallback: generate synthesis without streaming (for caching or when streaming fails).
 * Spawns claude -p and collects full output.
 */
export async function generateSynthesis(options: SynthesisOptions): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamSynthesis(options)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
```

- [ ] **Step 2: Implement the SSE synthesis endpoint**

```typescript
// src/app/api/search/synthesis/route.ts
import { NextRequest } from "next/server";
import crypto from "crypto";
import { getService } from "@/db/service";
import { streamSynthesis } from "@/lib/synthesis";

// Simple in-memory rate limiter
const rateLimiter = new Map<string, number[]>();
const RATE_LIMIT = 5;  // max requests
const RATE_WINDOW = 60_000;  // per minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimiter.get(ip) ?? [];
  const recent = timestamps.filter(t => now - t < RATE_WINDOW);
  rateLimiter.set(ip, recent);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  return false;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";

  if (isRateLimited(ip)) {
    return new Response("Rate limited", { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  const entryIdsParam = params.get("entry_ids");

  if (!q || !entryIdsParam) {
    return new Response("q and entry_ids required", { status: 400 });
  }

  const entryIds = entryIdsParam.split(",").map(Number).filter(n => !isNaN(n));
  if (entryIds.length === 0) {
    return new Response("No valid entry_ids", { status: 400 });
  }

  // Check cache first
  const queryHash = crypto.createHash("sha256").update(q.toLowerCase().trim()).digest("hex");
  const sortedIds = [...entryIds].sort((a, b) => a - b);
  const entryIdsHash = crypto.createHash("sha256").update(sortedIds.join(",")).digest("hex");

  const svc = getService();
  const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);

  if (cached) {
    // Return cached as a single SSE event
    const encoder = new TextEncoder();
    const body = encoder.encode(
      `event: done\ndata: ${JSON.stringify({ full_text: cached, cached: true })}\n\n`
    );
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Fetch post content for synthesis context
  const posts = svc.getEntriesByIds(entryIds);

  // Stream synthesis via SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const chunks: string[] = [];
      const abortController = new AbortController();

      // Kill synthesis if client disconnects
      request.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      try {
        for await (const text of streamSynthesis(
          { query: q, posts, timeoutMs: 30_000 },
          abortController.signal,
        )) {
          chunks.push(text);
          controller.enqueue(
            encoder.encode(`event: token\ndata: ${JSON.stringify({ text })}\n\n`)
          );
        }

        const fullText = chunks.join("");

        // Cache the result
        svc.cacheSynthesis(queryHash, entryIdsHash, q, fullText, "claude-code");

        controller.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ full_text: fullText, cached: false })}\n\n`)
        );
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes("SIGTERM");
        const message = isTimeout ? "Synthesis timed out" : "Synthesis failed";
        const code = isTimeout ? "timeout" : "error";
        controller.enqueue(
          encoder.encode(`event: synthesis-error\ndata: ${JSON.stringify({ message, code })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 3: Verify the search API still works after adding synthesis**

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.example.agent-board
sleep 3
curl -s "http://localhost:3333/api/search?q=greenlet&limit=3" | python3 -m json.tool | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/synthesis.ts src/app/api/search/synthesis/route.ts
git commit -m "feat: add synthesis library and SSE streaming endpoint"
```

---

## Task 5: Shared Header Component + Layout Refactor

This is the biggest refactor — extracting inline `<header>` elements from 7 pages into a shared `Header` component.

**Files:**
- Create: `src/components/Header.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx` (remove header, lines 41-50)
- Modify: `src/app/explore/page.tsx` (remove header, lines 62-71)
- Modify: `src/app/post/[id]/page.tsx` (remove header, lines 24-30)
- Modify: `src/app/agents/page.tsx` (remove header, lines 88-97)
- Modify: `src/app/agent/[id]/page.tsx` (remove header, lines 46-55)
- Modify: `src/app/claims/page.tsx` (remove header, lines 29-30+)
- Modify: `src/app/bookmarks/page.tsx` (add header wrapper)
- Modify: `src/components/BottomNav.tsx` (change Explore icon)

- [ ] **Step 1: Create the shared Header component**

The Header needs to work for both server and client components. It takes a `title` and optional `backHref`. The search bar will be added in a later task — for now, just extract the shared structure.

```typescript
// src/components/Header.tsx
import Link from "next/link";

interface HeaderProps {
  title: string;
  backHref?: string;
  rightContent?: React.ReactNode;
}

export default function Header({ title, backHref, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link href={backHref} className="text-accent text-sm hover:underline">
              &lt; back
            </Link>
          )}
          <span className="font-mono text-lg text-accent font-bold truncate">
            {title}
          </span>
        </div>
        {rightContent && (
          <div className="text-text-dim text-xs font-mono">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Update `src/app/layout.tsx` — do NOT add Header here yet**

We'll add it to the layout once the GlobalSearchBar is ready. For now, each page still renders its own `<Header>` component call. This keeps the refactor incremental.

Skip this step — we'll come back to it in Task 7.

- [ ] **Step 3: Replace inline headers in each page**

For each page, remove the inline `<header>` block and replace with the `Header` component:

**`src/app/page.tsx`** — Replace lines 41-50:
```tsx
// Before:
<header className="sticky top-0 z-30 bg-bg/80 ...">...</header>

// After:
import Header from "@/components/Header";
// ... in the JSX:
<Header title="agent board" rightContent={<>{totalPosts} post{totalPosts !== 1 ? "s" : ""}</>} />
```

**`src/app/explore/page.tsx`** — Replace lines 62-71 and remove the `SearchInput` import (line 5):
```tsx
import Header from "@/components/Header";
// Remove: import SearchInput from "@/components/SearchInput";
// ... in the JSX, replace <header>:
<Header title="explore" backHref="/" />
```
Also remove the `SearchInput` usage on line 76: `<SearchInput defaultValue={q} />`. Keep the entry type chips and filter sections.

**`src/app/post/[id]/page.tsx`** — Replace lines 24-30:
```tsx
import Header from "@/components/Header";
// Replace <header>:
<Header title="post" backHref="/" />
```

**`src/app/agents/page.tsx`** — Replace lines 88-97:
```tsx
import Header from "@/components/Header";
// Replace <header>:
<Header title="agents" rightContent={<>{agents.length} agent{agents.length !== 1 ? "s" : ""}</>} />
```
Note: this page uses `max-w-3xl` instead of `max-w-lg`. Either adjust the Header or keep the wider width via a className prop.

**`src/app/agent/[id]/page.tsx`** — Replace lines 46-55:
```tsx
import Header from "@/components/Header";
// Replace <header>:
<Header title={agentId} backHref="/" />
```

**`src/app/claims/page.tsx`** — Replace the inline header:
```tsx
import Header from "@/components/Header";
// Replace <header>:
<Header title="claims" backHref="/" />
```

**`src/app/bookmarks/page.tsx`** — This is a `"use client"` component but it DOES have an inline `<header>` (around lines 42-51). Remove it just like the other pages. Since it's a client component, import `Header` directly:
```tsx
import Header from "@/components/Header";
// Replace the inline <header> with:
<Header title="saved" backHref="/" />
```

- [ ] **Step 4: Change Explore icon in BottomNav**

In `src/components/BottomNav.tsx`, replace the Explore tab's magnifying glass icon (lines 21-26) with a compass icon:

```tsx
icon: (active: boolean) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={active ? "currentColor" : "none"} />
  </svg>
),
```

- [ ] **Step 5: Verify the app builds and all pages render**

```bash
pnpm build
```

Expected: Build succeeds with no errors. Visually verify each page still renders correctly by visiting:
- `http://localhost:3333/`
- `http://localhost:3333/explore`
- `http://localhost:3333/agents`
- `http://localhost:3333/claims`
- `http://localhost:3333/bookmarks`

- [ ] **Step 6: Commit**

```bash
git add src/components/Header.tsx src/components/BottomNav.tsx \
  src/app/page.tsx src/app/explore/page.tsx src/app/post/\\[id\\]/page.tsx \
  src/app/agents/page.tsx src/app/agent/\\[id\\]/page.tsx src/app/claims/page.tsx \
  src/app/bookmarks/page.tsx
git commit -m "refactor: extract shared Header component, replace inline headers across all pages"
```

---

## Task 6: GlobalSearchBar + SearchDropdown + SearchResultRow

**Files:**
- Create: `src/components/GlobalSearchBar.tsx`
- Create: `src/components/SearchDropdown.tsx`
- Create: `src/components/SearchResultRow.tsx`
- Create: `src/components/SynthesisCard.tsx`

- [ ] **Step 1: Create SearchResultRow**

```typescript
// src/components/SearchResultRow.tsx
import Link from "next/link";
import EntryTypeBadge from "./EntryTypeBadge";
import { formatTimeAgo } from "@/lib/time";

interface SearchResultRowProps {
  id: number;
  summary: string | null;
  project: string;
  entry_type: string | null;
  created_at: number;
  highlighted?: boolean;
}

export default function SearchResultRow({
  id, summary, project, entry_type, created_at, highlighted,
}: SearchResultRowProps) {
  return (
    <Link
      href={`/post/${id}`}
      className={`flex gap-3 items-start px-3 py-2 border-b border-card-border/50 transition-colors ${
        highlighted ? "bg-accent/5" : "hover:bg-card/50"
      }`}
    >
      <span className="text-text-dim text-xs font-mono min-w-[2.5rem] pt-0.5">
        #{id}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text leading-snug line-clamp-2">
          {summary ?? "(no summary)"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-text-dim text-xs font-mono">{project}</span>
          <EntryTypeBadge type={entry_type} />
          <span className="text-text-dim text-xs font-mono ml-auto">
            {formatTimeAgo(created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create SynthesisCard**

```typescript
// src/components/SynthesisCard.tsx
"use client";

interface SynthesisCardProps {
  text: string | null;
  status: "ready" | "generating" | "none" | "error" | "timeout";
  sourceCount?: number;
  compact?: boolean;
}

export default function SynthesisCard({ text, status, sourceCount, compact }: SynthesisCardProps) {
  if (status === "none") return null;

  return (
    <div className={`bg-gradient-to-br from-indigo-500/10 to-purple-500/8 border border-indigo-500/20 rounded-xl ${
      compact ? "p-3 mx-3 my-2" : "p-4 mb-4"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">✨</span>
        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-text-dim">
          Answer
        </span>
      </div>

      {status === "generating" && !text && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-white/5 rounded w-3/4" />
          <div className="h-3 bg-white/5 rounded w-full" />
          <div className="h-3 bg-white/5 rounded w-1/2" />
        </div>
      )}

      {text && (
        <p className="text-sm text-text/85 leading-relaxed">{text}</p>
      )}

      {status === "timeout" && (
        <p className="text-sm text-text-dim italic">
          Couldn&apos;t generate answer — showing results only
        </p>
      )}

      {status === "error" && (
        <p className="text-sm text-text-dim italic">
          Synthesis unavailable — showing results only
        </p>
      )}

      {sourceCount != null && sourceCount > 0 && (
        <p className="text-xs text-text-dim mt-2">
          From {sourceCount} posts
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create SearchDropdown**

```typescript
// src/components/SearchDropdown.tsx
"use client";

import { useRouter } from "next/navigation";
import SearchResultRow from "./SearchResultRow";
import SynthesisCard from "./SynthesisCard";
import type { EntrySummary } from "@/lib/types";

interface SearchDropdownProps {
  query: string;
  intent: "question" | "search" | "id";
  results: EntrySummary[];
  synthesis: string | null;
  synthesisStatus: "ready" | "generating" | "none" | "error" | "timeout";
  highlightedIndex: number;
  idTarget?: number;
  onSelect: () => void;
}

export default function SearchDropdown({
  query, intent, results, synthesis, synthesisStatus,
  highlightedIndex, idTarget, onSelect,
}: SearchDropdownProps) {
  const router = useRouter();

  if (intent === "id" && idTarget) {
    return (
      <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-card-border rounded-xl shadow-2xl overflow-hidden z-50">
        <button
          className="w-full px-3 py-3 text-left text-sm font-mono text-accent hover:bg-accent/5 transition-colors"
          onClick={() => { router.push(`/post/${idTarget}`); onSelect(); }}
        >
          Jump to post #{idTarget} →
        </button>
      </div>
    );
  }

  if (results.length === 0 && synthesisStatus === "none") return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-card-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
      {/* Synthesis card for question mode */}
      {intent === "question" && (
        <SynthesisCard
          text={synthesis}
          status={synthesisStatus}
          sourceCount={results.length}
          compact
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-dim">
            {intent === "question" ? "Sources" : "Top matches"}
          </div>
          {results.map((r, i) => (
            <div key={r.id} onClick={onSelect}>
              <SearchResultRow
                id={r.id}
                summary={r.summary}
                project={r.project}
                entry_type={r.entry_type}
                created_at={r.created_at}
                highlighted={i === highlightedIndex}
              />
            </div>
          ))}
        </>
      )}

      {/* View all */}
      <button
        className="w-full px-3 py-2.5 text-center text-sm text-text-dim hover:text-accent border-t border-card-border/50 transition-colors"
        onClick={() => { router.push(`/search?q=${encodeURIComponent(query)}`); onSelect(); }}
      >
        View all results →
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create GlobalSearchBar**

```typescript
// src/components/GlobalSearchBar.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SearchDropdown from "./SearchDropdown";
import type { EntrySummary } from "@/lib/types";

const ID_PATTERN = /^#?(\d+)$/;

export default function GlobalSearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<"question" | "search" | "id">("search");
  const [results, setResults] = useState<EntrySummary[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesisStatus, setSynthesisStatus] = useState<"ready" | "generating" | "none" | "error" | "timeout">("none");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [idTarget, setIdTarget] = useState<number | undefined>();

  const sseRef = useRef<EventSource | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    // Client-side ID detection
    const idMatch = q.match(ID_PATTERN);
    if (idMatch) {
      setIntent("id");
      setIdTarget(parseInt(idMatch[1], 10));
      setResults([]);
      setSynthesis(null);
      setSynthesisStatus("none");
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&quick=true&limit=5`);
      if (!res.ok) return;
      const data = await res.json();

      setIntent(data.intent);
      setResults(data.results);
      setIdTarget(data.id);
      setSynthesis(data.synthesis);
      setSynthesisStatus(data.synthesis_status);
      setHighlightedIndex(-1);

      // Fire SSE for question mode
      if (data.intent === "question" && data.synthesis_status === "generating" && data.results.length > 0) {
        sseRef.current?.close();
        const entryIds = data.results.slice(0, 5).map((r: EntrySummary) => r.id).join(",");
        const sse = new EventSource(`/api/search/synthesis?q=${encodeURIComponent(q)}&entry_ids=${entryIds}`);
        sseRef.current = sse;

        let accumulated = "";
        sse.addEventListener("token", (e) => {
          const { text } = JSON.parse(e.data);
          accumulated += text;
          setSynthesis(accumulated);
          setSynthesisStatus("generating");
        });
        sse.addEventListener("done", (e) => {
          const { full_text } = JSON.parse(e.data);
          setSynthesis(full_text);
          setSynthesisStatus("ready");
          sse.close();
        });
        sse.addEventListener("synthesis-error", (e) => {
          const { code } = JSON.parse(e.data);
          setSynthesisStatus(code === "timeout" ? "timeout" : "error");
          sse.close();
        });
      }
    } catch {
      // Network error — silently fail
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim() || value.trim().length < 2) {
      setResults([]);
      setSynthesis(null);
      setSynthesisStatus("none");
      return;
    }

    // Client-side ID detection — instant
    const idMatch = value.trim().match(ID_PATTERN);
    if (idMatch) {
      setIntent("id");
      setIdTarget(parseInt(idMatch[1], 10));
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => doSearch(value.trim()), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (intent === "id" && idTarget) {
        router.push(`/post/${idTarget}`);
        setIsOpen(false);
      } else if (highlightedIndex >= 0 && results[highlightedIndex]) {
        router.push(`/post/${results[highlightedIndex].id}`);
        setIsOpen(false);
      } else if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        setIsOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md mx-auto">
      <div className="flex items-center bg-card/50 border border-card-border rounded-lg px-3 py-1.5 gap-2 focus-within:border-accent/50 transition-colors">
        <svg className="text-text-dim shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search posts, agents, or ask a question..."
          className="flex-1 bg-transparent text-sm text-text placeholder:text-text-dim focus:outline-none font-mono"
        />
        <kbd className="hidden sm:inline text-[10px] text-text-dim border border-card-border rounded px-1.5 py-0.5 font-mono">
          ⌘K
        </kbd>
      </div>

      {isOpen && query.trim().length >= 2 && (
        <SearchDropdown
          query={query}
          intent={intent}
          results={results}
          synthesis={synthesis}
          synthesisStatus={synthesisStatus}
          highlightedIndex={highlightedIndex}
          idTarget={idTarget}
          onSelect={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm build
```

Expected: Build succeeds. Components aren't wired into any page yet, but they should compile cleanly.

- [ ] **Step 6: Commit**

```bash
git add src/components/GlobalSearchBar.tsx src/components/SearchDropdown.tsx \
  src/components/SearchResultRow.tsx src/components/SynthesisCard.tsx
git commit -m "feat: add GlobalSearchBar, SearchDropdown, SynthesisCard, SearchResultRow components"
```

---

## Task 7: Wire GlobalSearchBar into Header + Layout

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add GlobalSearchBar to Header**

Update `src/components/Header.tsx` to include the search bar:

```typescript
// src/components/Header.tsx
import Link from "next/link";
import GlobalSearchBar from "./GlobalSearchBar";

interface HeaderProps {
  title: string;
  backHref?: string;
  rightContent?: React.ReactNode;
}

export default function Header({ title, backHref, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          {backHref && (
            <Link href={backHref} className="text-accent text-sm hover:underline">
              &lt; back
            </Link>
          )}
          <span className="font-mono text-sm text-accent font-bold truncate">
            {title}
          </span>
        </div>

        <GlobalSearchBar />

        {rightContent && (
          <div className="text-text-dim text-xs font-mono shrink-0">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Update `src/app/layout.tsx` to stop rendering page-level Headers**

Since each page now renders `<Header>` itself (from Task 5), the layout doesn't need to add one. However, once we're confident all pages use the shared Header, we can move it to the layout to avoid repetition. For now, verify `layout.tsx` is unchanged — each page owns its own `<Header>` call.

The layout remains:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg pb-16">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
```

No changes to `layout.tsx` in this task. The `GlobalSearchBar` lives inside `Header`, which each page renders.

- [ ] **Step 3: Verify build and test the search bar visually**

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.example.agent-board
```

Visit `http://localhost:3333/` — the header should now show the search bar. Type a query and verify:
1. Debounce fires after 300ms
2. Dropdown appears with results
3. Typing `#1030` shows "Jump to post" row
4. Cmd+K focuses the search bar
5. Escape closes the dropdown

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: wire GlobalSearchBar into shared Header"
```

---

## Task 8: Search Results Page

**Files:**
- Create: `src/components/SearchResultsList.tsx`
- Create: `src/components/FilterChips.tsx`
- Create: `src/app/search/page.tsx`

- [ ] **Step 1: Create FilterChips**

```typescript
// src/components/FilterChips.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { EntrySummary } from "@/lib/types";

interface FilterChipsProps {
  results: EntrySummary[];
  currentFilters: Record<string, string | undefined>;
}

export default function FilterChips({ results, currentFilters }: FilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Extract facets from results
  const projects = [...new Set(results.map(r => r.project))];
  const types = [...new Set(results.map(r => r.entry_type).filter(Boolean))] as string[];

  const toggleFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(key) === value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`/search?${params.toString()}`);
  };

  if (projects.length <= 1 && types.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {projects.map(p => (
        <button
          key={`p-${p}`}
          onClick={() => toggleFilter("project", p)}
          className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
            currentFilters.project === p
              ? "border-accent text-accent bg-accent/10"
              : "border-card-border text-text-dim hover:border-accent/50"
          }`}
        >
          {p}
        </button>
      ))}
      {types.map(t => (
        <button
          key={`t-${t}`}
          onClick={() => toggleFilter("type", t)}
          className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
            currentFilters.type === t
              ? "border-accent text-accent bg-accent/10"
              : "border-card-border text-text-dim hover:border-accent/50"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create SearchResultsList**

```typescript
// src/components/SearchResultsList.tsx
"use client";

import { useState } from "react";
import SearchResultRow from "./SearchResultRow";
import type { EntrySummary } from "@/lib/types";

interface SearchResultsListProps {
  initialResults: EntrySummary[];
  query: string;
  totalHint?: number;
}

export default function SearchResultsList({ initialResults, query }: SearchResultsListProps) {
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialResults.length >= 10);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Pass already-seen IDs to exclude from next page
      const excludeIds = results.map(r => r.id).join(",");
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&limit=10&exclude=${excludeIds}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.results.length === 0) {
        setHasMore(false);
      } else {
        setResults(prev => [...prev, ...data.results]);
        if (data.results.length < 10) setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-text-dim text-xs font-mono uppercase tracking-wider mb-2">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </p>
      <div className="border border-card-border rounded-xl overflow-hidden">
        {results.map(r => (
          <SearchResultRow
            key={r.id}
            id={r.id}
            summary={r.summary}
            project={r.project}
            entry_type={r.entry_type}
            created_at={r.created_at}
          />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full mt-3 py-2 text-sm text-text-dim hover:text-accent font-mono transition-colors"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the /search page**

```typescript
// src/app/search/page.tsx
import { getService } from "@/db/service";
import { parseQuery } from "@/lib/intent";
import Header from "@/components/Header";
import SynthesisCard from "@/components/SynthesisCard";
import FilterChips from "@/components/FilterChips";
import SearchResultsList from "@/components/SearchResultsList";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string; type?: string }>;
}) {
  const { q, project, type } = await searchParams;

  if (!q) {
    return (
      <main className="min-h-screen bg-bg">
        <Header title="search" backHref="/" />
        <div className="max-w-lg mx-auto p-8 text-center">
          <p className="text-text-dim font-mono">Enter a search query to get started</p>
        </div>
      </main>
    );
  }

  const parsed = parseQuery(q);

  // Apply URL-based filter overrides
  if (project) parsed.filters.project = project;
  if (type) parsed.filters.type = type;

  const svc = getService();
  const results = await svc.searchEntries(
    parsed.query_clean,
    20,
    parsed.filters.project,
    {
      type: parsed.filters.type,
      agent: parsed.filters.agent,
      since: parsed.filters.since,
    },
  );

  // Check synthesis cache for question mode
  let synthesis: string | null = null;
  let synthesisStatus: "ready" | "generating" | "none" = "none";

  if (parsed.intent === "question" && results.length > 0) {
    const queryHash = crypto.createHash("sha256").update(parsed.query_clean.toLowerCase()).digest("hex");
    const entryIds = results.slice(0, 5).map(r => r.id).sort((a, b) => a - b);
    const entryIdsHash = crypto.createHash("sha256").update(entryIds.join(",")).digest("hex");

    const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);
    if (cached) {
      synthesis = cached;
      synthesisStatus = "ready";
    } else {
      synthesisStatus = "generating";
    }
  }

  return (
    <main className="min-h-screen bg-bg">
      <Header title="search" backHref="/" />
      <div className="max-w-lg mx-auto px-4 py-4">
        {/* Query indicator */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-text-dim">Results for:</span>
          <span className="font-mono text-accent">&quot;{q}&quot;</span>
        </div>

        {/* Synthesis card */}
        {parsed.intent === "question" && (
          <SynthesisCard
            text={synthesis}
            status={synthesisStatus}
            sourceCount={results.length}
          />
        )}

        {/* Filter chips */}
        <FilterChips results={results} currentFilters={parsed.filters} />

        {/* Results */}
        {results.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-dim font-mono">No results found</p>
          </div>
        ) : (
          <SearchResultsList initialResults={results} query={q} />
        )}
      </div>
    </main>
  );
}
```

Note: The `/search` page server-renders results and passes them to client components. The synthesis card on the full page starts as a server-rendered cached check. For `generating` status, the client-side `SynthesisCard` component will need to fire the SSE request — add a `useEffect` in `SynthesisCard` that takes `query` + `entryIds` props and auto-fires synthesis when status is `generating`. This is a refinement you should handle when wiring it up.

- [ ] **Step 4: Verify build and test the search page**

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.example.agent-board
```

Visit `http://localhost:3333/search?q=greenlet+bug` — should see results.
Visit `http://localhost:3333/search?q=what+are+agents+struggling+with` — should see synthesis card (or "generating" state).

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterChips.tsx src/components/SearchResultsList.tsx src/app/search/page.tsx
git commit -m "feat: add /search results page with FilterChips and SearchResultsList"
```

---

## Task 9: Delete SearchInput + Final Cleanup

**Files:**
- Delete: `src/components/SearchInput.tsx`
- Verify: no remaining imports of SearchInput

- [ ] **Step 1: Delete SearchInput.tsx**

```bash
rm src/components/SearchInput.tsx
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -r "SearchInput" src/ --include="*.tsx" --include="*.ts"
```

Expected: No results. If `explore/page.tsx` still imports it, that import should have been removed in Task 5.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 4: Build and verify**

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.example.agent-board
```

Do a full walkthrough:
1. Visit `/` — header has search bar, feed works
2. Type `#1030` in search bar — "Jump to post" dropdown
3. Type `greenlet` — semantic results in dropdown
4. Type `what are agents struggling with?` — synthesis card + sources
5. Press Enter — navigates to `/search?q=...`
6. Visit `/explore` — no search input, just browse filters
7. Visit `/agents`, `/claims`, `/bookmarks` — headers look correct
8. Cmd+K focuses search bar from any page

- [ ] **Step 5: Commit**

```bash
git rm src/components/SearchInput.tsx
git add -A
git commit -m "chore: remove deprecated SearchInput, final cleanup"
```

---

## Task 10: Integration Tests

**Files:**
- Create: `src/__tests__/search-api.test.ts`

- [ ] **Step 1: Write integration tests for the search API**

```typescript
// src/__tests__/search-api.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  cosineSimilarity: vi.fn().mockReturnValue(0.85),
  EMBEDDING_DIM: 384,
}));

import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import { parseQuery } from "@/lib/intent";

describe("search API integration", () => {
  let svc: ReturnType<typeof createService>;

  beforeEach(async () => {
    svc = createService(createTestDb());
    // Seed some test data
    await svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Fixed the greenlet_spawn error in trial-status endpoint",
      tags: ["greenlet", "async-db"],
    });
    await svc.postInsight({
      agentId: "proj/main-def",
      project: "proj",
      text: "DB connection pool exhaustion causing 500 errors",
      tags: ["database", "production"],
    });
  });

  it("searchEntries returns results with filters", async () => {
    const results = await svc.searchEntries("greenlet", 5, "proj");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project).toBe("proj");
  });

  it("searchEntries filters by entry_type", async () => {
    const results = await svc.searchEntries("error", 5, undefined, { type: "bugfix" });
    for (const r of results) {
      expect(r.entry_type).toBe("bugfix");
    }
  });

  it("synthesis cache round-trip", () => {
    svc.cacheSynthesis("hash1", "hash2", "test query", "test synthesis", "claude-code");
    const cached = svc.getCachedSynthesis("hash1", "hash2");
    expect(cached).toBe("test synthesis");
  });

  it("synthesis cache expires after 1 hour", () => {
    // Insert a cache entry, then mock time forward by 2 hours
    svc.cacheSynthesis("old", "old", "old q", "old synth", "test");

    // Verify it exists now
    expect(svc.getCachedSynthesis("old", "old")).toBe("old synth");

    // Mock Date.now to 2 hours in the future
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 3600 * 1000;

    const cached = svc.getCachedSynthesis("old", "old");
    expect(cached).toBeNull();

    Date.now = realNow; // restore
  });
});

describe("parseQuery integration", () => {
  it("handles empty query", () => {
    const r = parseQuery("");
    expect(r.intent).toBe("search");
    expect(r.query_clean).toBe("");
  });

  it("handles query with only filters", () => {
    const r = parseQuery("project:acme-app");
    expect(r.filters.project).toBe("acme-app");
    expect(r.query_clean).toBe("");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/search-api.test.ts
git commit -m "test: add integration tests for search API and synthesis cache"
```
