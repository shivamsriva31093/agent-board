import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  cosineSimilarity: vi.fn().mockReturnValue(0.85),
  EMBEDDING_DIM: 384,
}));

import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";

describe("v2 integration", () => {
  let svc: ReturnType<typeof createService>;

  beforeEach(() => {
    svc = createService(createTestDb());
  });

  it("full lifecycle: post → enrich → brief → claim → conflict → release", () => {
    // 1. Post insight
    const { entry_id } = svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Fixed a race condition in the worker pool. Two jobs sharing one page.",
      tags: ["concurrency", "bugfix"],
      scope: ["src/workers/pool.ts"],
    });
    expect(entry_id).toBeGreaterThan(0);

    // 2. Verify auto-enrichment (summary, entry_type, scope)
    const entry = svc.getEntryWithDetails(entry_id);
    expect(entry).not.toBeNull();
    expect(entry!.summary).toContain("race condition");
    expect(entry!.entry_type).toBe("bugfix");
    expect(entry!.parsed_scope).toContain("src/workers/pool.ts");

    // 3. Brief should include project digest
    const brief = svc.briefMe("proj");
    expect(brief.digests.length).toBeGreaterThan(0);
    expect(brief.digests[0].project).toBe("proj");
    expect(brief.digests[0].entry_count).toBe(1);

    // 4. Claim a scope
    const claim = svc.createClaim(
      "proj/main-abc",
      "proj",
      "src/workers/",
      "module",
      60,
    );
    expect(claim.claim_id).toBeGreaterThan(0);
    expect(claim.conflicts).toHaveLength(0);

    // 5. Brief should show claim
    const brief2 = svc.briefMe();
    expect(brief2.active_claims.length).toBe(1);
    expect(brief2.active_claims[0].scope).toBe("src/workers/");

    // 6. Another agent sees conflict on overlapping scope
    const claim2 = svc.createClaim(
      "proj/other-def",
      "proj",
      "src/workers/pool.ts",
      "file",
      60,
    );
    expect(claim2.conflicts.length).toBe(1);
    expect(claim2.conflicts[0].agent_id).toBe("proj/main-abc");

    // 7. Release first claim — only second remains
    svc.releaseClaim(claim.claim_id);
    const brief3 = svc.briefMe();
    expect(brief3.active_claims.length).toBe(1);
    expect(brief3.active_claims[0].agent_id).toBe("proj/other-def");
  });

  it("broadcast status appears in brief and who_is_working_on", () => {
    // Agent broadcasts status
    svc.broadcastStatus("proj/main-abc", "proj", "active", "refactoring auth");

    // Should appear in brief
    const brief = svc.briefMe();
    expect(brief.active_agents.length).toBe(1);
    expect(brief.active_agents[0].current_task).toBe("refactoring auth");

    // Should appear in who_is_working_on
    const who = svc.whoIsWorkingOn();
    expect(who.agents.length).toBe(1);
    expect(who.agents[0].status).toBe("active");
  });

  it("multiple posts build up project digest", () => {
    svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Discovered a memory leak in the connection pool.",
    });
    svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Decided to use Redis for caching instead of in-memory.",
    });
    svc.postInsight({
      agentId: "proj/other-def",
      project: "proj",
      text: "Shipped the new dashboard feature.",
    });

    const brief = svc.briefMe("proj");
    expect(brief.digests[0].entry_count).toBe(3);
    expect(brief.digests[0].summary).toContain("memory leak");
    expect(brief.digests[0].summary).toContain("Redis");
  });

  it("stories still work after v2 migration", () => {
    const { story_id } = svc.postStory("proj/main-abc", "proj", "focused", "deep in the code");
    expect(story_id).toBeGreaterThan(0);

    const stories = svc.getActiveStories();
    expect(stories.length).toBe(1);
    expect(stories[0].mood).toBe("focused");
  });

  it("replies and reactions still work", () => {
    const { entry_id } = svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Found a pattern for error boundaries.",
    });

    const { reply_id } = svc.replyToPost(entry_id, "proj/other-def", "proj", "nice find!");
    expect(reply_id).toBeGreaterThan(0);

    svc.reactToPost(entry_id, "proj/other-def", "proj", "\u2764");

    const entry = svc.getEntryWithDetails(entry_id);
    expect(entry!.replies.length).toBe(1);
    expect(entry!.likes).toBe(1);
  });

  it("contextFor returns relevant entries, claims, and conflicts", async () => {
    // Seed data
    svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Fixed a race condition in queries.ts — two concurrent writes deadlocking on WAL.",
      scope: ["src/db/queries.ts"],
      tags: ["bugfix", "sqlite"],
    });
    svc.postInsight({
      agentId: "proj/main-abc",
      project: "proj",
      text: "Decided to use cursor-based pagination over offset for the feed.",
      scope: ["src/db/queries.ts"],
      tags: ["decision"],
    });
    svc.postInsight({
      agentId: "proj/other-def",
      project: "proj",
      text: "Shipped the new dashboard feature with charts.",
      scope: ["src/app/dashboard/"],
      tags: ["shipped"],
    });

    // Claim on the scope we're about to query
    svc.createClaim("proj/other-def", "proj", "src/db/", "module", 60);

    // Let fire-and-forget embedding inserts settle
    await new Promise((r) => setTimeout(r, 10));

    const result = await svc.contextFor({
      files: ["src/db/queries.ts"],
      intent: "refactoring the query layer",
      maxTokens: 600,
    });

    // Should find the two entries scoped to src/db/queries.ts
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    // Entries should be scored (have a score property)
    expect(result.entries[0].score).toBeGreaterThan(0);
    // Should find the claim on src/db/
    expect(result.claims.length).toBe(1);
    expect(result.claims[0].agent_id).toBe("proj/other-def");
  });

  it("contextFor respects max_tokens budget", async () => {
    // Seed many entries
    for (let i = 0; i < 20; i++) {
      svc.postInsight({
        agentId: "proj/main-abc",
        project: "proj",
        text: `Entry ${i}: some knowledge about the system that is moderately relevant to utility functions and helpers.`,
        scope: ["src/lib/"],
      });
    }

    // Let fire-and-forget embedding inserts settle
    await new Promise((r) => setTimeout(r, 10));

    const result = await svc.contextFor({
      files: ["src/lib/utils.ts"],
      intent: "adding a utility function",
      maxTokens: 200,
    });

    // Should truncate — not return all 20
    expect(result.entries.length).toBeLessThan(20);
    expect(result.truncated).toBe(true);
  });
});
