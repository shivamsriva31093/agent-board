/**
 * hooks/lib/brief.jq turns /api/brief JSON into the short brief the
 * SessionStart hook prints into Claude's context.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { countTokens } from "@/eval/tokens";
import busyFixture from "@/eval/fixtures/brief-busy.json";

const hasJq = (() => {
  try {
    execFileSync("jq", ["--version"]);
    return true;
  } catch {
    console.warn("jq not on PATH; skipping hook brief tests");
    return false;
  }
})();

const run = (brief: object, now: number) =>
  execFileSync("jq", ["-r", "--arg", "project", "acme-api", "--argjson", "now", String(now), "-f", "hooks/lib/brief.jq"], {
    input: JSON.stringify(brief),
  }).toString();

describe.skipIf(!hasJq)("hook brief (brief.jq)", () => {
  it("renders a busy brief under 150 tokens with at most 3 bullets", () => {
    const out = run(busyFixture.brief, busyFixture.now);
    expect(countTokens(out)).toBeLessThanOrEqual(150);
    expect(out.split("\n").filter((l) => l.startsWith("•")).length).toBe(3);
    // Only acme-api's own claim counts; the fixture also has acme-web and infra claims.
    expect(out).toMatch(/^\[agent-board\] acme-api: 23 posts \(5 today\) · 1 active claim\n/);
  });

  it("cuts summaries to 90 characters and shows the age", () => {
    const first = run(busyFixture.brief, busyFixture.now).split("\n")[1];
    expect(first).toMatch(/^• \[bugfix\] .{90}… \(#100, 30m ago\)$/);
  });

  const withSummaries = (summaries: string[]) => ({
    ...busyFixture.brief,
    in_your_projects: summaries.map((summary, i) => ({ ...busyFixture.brief.in_your_projects[i], summary })),
  });

  it("keeps each post on one line when its summary contains newlines", () => {
    const out = run(withSummaries(["Fixed the pool\n- awaited release()\n- added a test", "Second post", "Third post"]), busyFixture.now);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(5); // header, 3 bullets, pointer
    expect(lines.slice(1, 4).every((l) => l.startsWith("• "))).toBe(true);
  });

  it("stays within 150 tokens when summaries are dense with paths and identifiers", () => {
    const dense = [
      "src/db/__tests__/context-for.test.ts + src/lib/scope-match.ts: scopeMatchDepth() vs /Users/dev/code/acme-api/src/workers/pool.ts returns 3; isRelevantScopeMatch(depth, sameProject) gates it",
      "mcp-server/src/render.ts renderBrief(brief, { project, maxTokens }) caps MAX_STATS=5, MAX_ACTIVE_AGENTS=3; estimateTokens(text) = Math.ceil(text.length / 3); NOTE_RESERVE=8 for (+N more)",
      "hooks/lib/brief.jq + hooks/session-start.sh: curl -s --max-time 2 -G $BOARD_API/api/brief --data-urlencode agent_id=$PROJECT/hook-${SESSION_ID:0:6} then jq -f",
    ];
    const out = run(withSummaries(dense), busyFixture.now);
    expect(countTokens(out)).toBeLessThanOrEqual(150);
  });

  it("prints nothing for an idle project even when other projects hold claims", () => {
    const others = busyFixture.brief.active_claims.filter((c) => !c.agent_id.startsWith("acme-api/"));
    const idle = { ...busyFixture.brief, stats: [], in_your_projects: [], active_claims: others };
    expect(run(idle, busyFixture.now).trim()).toBe("");
  });

  it("prints nothing for an empty brief", () => {
    const out = run({ stats: [], active_agents: [], active_claims: [], in_your_projects: [], relevant_to_you: [] }, busyFixture.now);
    expect(out.trim()).toBe("");
  });
});
