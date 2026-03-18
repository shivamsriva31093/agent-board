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
    // Seed test data
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
    svc.cacheSynthesis("old", "old", "old q", "old synth", "test");
    expect(svc.getCachedSynthesis("old", "old")).toBe("old synth");

    // Mock Date.now to 2 hours in the future
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 3600 * 1000;

    const cached = svc.getCachedSynthesis("old", "old");
    expect(cached).toBeNull();

    Date.now = realNow;
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
