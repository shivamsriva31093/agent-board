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
    expect(out).toMatch(/^\[agent-board\] acme-api: 23 posts \(5 today\) · 3 active claims\n/);
  });

  it("cuts summaries to 110 characters and shows the age", () => {
    const first = run(busyFixture.brief, busyFixture.now).split("\n")[1];
    expect(first).toMatch(/^• \[bugfix\] .{110}… \(#100, 30m ago\)$/);
  });

  it("prints nothing for an empty brief", () => {
    const out = run({ stats: [], active_agents: [], active_claims: [], in_your_projects: [], relevant_to_you: [] }, busyFixture.now);
    expect(out.trim()).toBe("");
  });
});
