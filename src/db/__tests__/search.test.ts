import { describe, it, expect, beforeEach, vi } from "vitest";

// Every text embeds to the same vector, so vector search can't tell posts apart.
vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  cosineSimilarity: vi.fn().mockReturnValue(0.85),
  EMBEDDING_DIM: 384,
}));

import type Database from "better-sqlite3";
import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import { embedText } from "@/lib/embeddings";

describe("searchEntries (hybrid)", () => {
  let db: Database.Database;
  let svc: ReturnType<typeof createService>;

  beforeEach(() => {
    db = createTestDb();
    svc = createService(db);
  });

  async function post(text: string) {
    const { entry_id } = await svc.postInsight({ agentId: "acme-api/main-a1", project: "acme-api", text });
    return entry_id;
  }
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it("finds a post by an exact identifier when embeddings can't separate posts", async () => {
    await post("Moved the CI cache key to the lockfile hash because branch keys always missed.");
    await post("The release script tags only after the build passes, because a failed build left a tag.");
    const target = await post("CI failed with ERR_PNPM_BAD_PM_VERSION because pnpm was pinned in the action and in packageManager.");
    await post("Pre-commit lints staged files only, because full lint made commits take forty seconds.");
    await settle();

    const results = await svc.searchEntries("ERR_PNPM_BAD_PM_VERSION", 5);

    expect(results[0].id).toBe(target);
  });

  it("finds a post whose embedding hasn't been stored yet", async () => {
    await post("Moved the CI cache key to the lockfile hash because branch keys always missed.");
    await settle();
    const fresh = db
      .prepare("INSERT INTO entries (agent_id, text, summary, created_at) VALUES ('acme-api/main-a1', ?, ?, unixepoch())")
      .run("Webhook retries are deduplicated by event id.", "Webhook retries are deduplicated by event id.").lastInsertRowid;

    const results = await svc.searchEntries("webhook retries deduplicated", 5);

    expect(results.map((r) => r.id)).toContain(Number(fresh));
  });

  it("falls back to lexical search, ranked by relevance, when the embedding model fails", async () => {
    await post("Release notes are generated from merged pull request titles every Friday afternoon.");
    const target = await post("JWT verification failed because of clock skew; we now allow thirty seconds of skew.");
    await settle();
    vi.mocked(embedText).mockRejectedValueOnce(new Error("model unavailable"));

    const results = await svc.searchEntries("clock-skew: JWT fix", 5);

    expect(results[0]?.id).toBe(target);
  });

  it("semantic mode leaves out keyword-only matches, for callers that search with long prose", async () => {
    await post("Moved the CI cache key to the lockfile hash because branch keys always missed.");
    await settle();
    const lexicalOnly = Number(
      db
        .prepare("INSERT INTO entries (agent_id, text, summary, created_at) VALUES ('acme-api/main-a1', ?, ?, unixepoch())")
        .run("Webhook retries are deduplicated by event id.", "Webhook retries are deduplicated by event id.").lastInsertRowid,
    );

    const results = await svc.searchEntries("webhook retries deduplicated", 5, undefined, undefined, { mode: "semantic" });

    expect(results.map((r) => r.id)).not.toContain(lexicalOnly);
  });

  it("still ranks a status log below the post that explains the same thing", async () => {
    const log = await post("Shipped Task 2 of the worker pool plan.");
    const why = await post("Fixed a race in the worker pool because the lock release was never awaited by callers.");
    await settle();

    const results = await svc.searchEntries("worker pool", 5);

    expect(results.map((r) => r.id).slice(0, 2)).toEqual([why, log]);
  });
});
