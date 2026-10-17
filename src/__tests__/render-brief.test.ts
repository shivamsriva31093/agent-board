import { describe, it, expect } from "vitest";
import { renderBrief, type BriefData } from "../../mcp-server/src/render";

const now = Math.floor(Date.now() / 1000);

function brief(overrides: Partial<BriefData> = {}): BriefData {
  return { stats: [], active_agents: [], active_claims: [], in_your_projects: [], mentions: [], relevant_to_you: [], ...overrides };
}

describe("renderBrief", () => {
  it("renders a small brief unchanged", () => {
    const text = renderBrief(
      brief({
        stats: [{ project: "acme-api", total: 3, today: 1 }],
        active_agents: [{ id: "acme-api/main-a1", current_task: "fixing auth" }],
        in_your_projects: [{ id: 7, agent_id: "acme-api/main-b2", summary: "Pool size is now five per pod.", project: "acme-api", created_at: now - 7200 }],
      }),
      { project: "acme-api", maxTokens: 300 },
    );
    expect(text).toBe(
      "\u{1F4CB} 3 posts | acme-api: 3 (1 today)\n" +
        '\nActive: acme-api/main-a1 — "fixing auth"\n' +
        "\n\u{1F4CC} In your projects:\n1. @acme-api/main-b2: Pool size is now five per pod. (acme-api, 2h ago) #7\n",
    );
  });

  it("puts the current project first, caps the stats line at 5 and still totals every post", () => {
    const stats = Array.from({ length: 12 }, (_, i) => ({ project: `side-${i}`, total: 2, today: 0 }));
    stats.push({ project: "acme-api", total: 10, today: 3 });
    const firstLine = renderBrief(brief({ stats }), { project: "acme-api", maxTokens: 300 }).split("\n")[0];
    expect(firstLine.startsWith("\u{1F4CB} 34 posts | acme-api: 10 (3 today) • ")).toBe(true);
    expect(firstLine.match(/ • /g)).toHaveLength(4);
    expect(firstLine.endsWith(" +8 more")).toBe(true);
  });

  it("caps active agents and claims at 3 each, current project first", () => {
    const active_agents = ["infra/a", "tooling/b", "acme-api/c", "infra/d", "acme-web/e"].map((id) => ({ id, current_task: null }));
    const active_claims = ["a/", "b/", "c/", "d/"].map((scope) => ({ agent_id: "infra/a", scope, expires_in_minutes: 30 }));
    const line = renderBrief(brief({ active_agents, active_claims }), { project: "acme-api", maxTokens: 300 })
      .split("\n")
      .find((l) => l.startsWith("Active: "))!;
    expect(line.startsWith("Active: acme-api/c | ")).toBe(true);
    expect(line).toContain("+2 more agents");
    expect(line).toContain("+1 more claims");
  });

  it("stops adding entries at the token budget and says how many were left out", () => {
    const in_your_projects = Array.from({ length: 30 }, (_, i) => ({
      id: i, agent_id: "acme-api/main-b2", summary: "x".repeat(140), project: "acme-api", created_at: now - 60,
    }));
    const text = renderBrief(brief({ stats: [{ project: "acme-api", total: 30, today: 30 }], in_your_projects }), { project: "acme-api", maxTokens: 300 });
    expect(text.length / 3).toBeLessThanOrEqual(300);
    expect(text).toMatch(/\(\+\d+ more\)/);
  });
});
