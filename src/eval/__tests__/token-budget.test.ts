/**
 * Token budgets for what agents actually receive: service output rendered by
 * the MCP server's own renderers, counted with a real tokenizer.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import { embedText } from "@/lib/embeddings";
import { loadFixtureBoard, type FixtureBoard } from "@/eval/harness";
import { countTokens } from "@/eval/tokens";
import boardJson from "@/eval/fixtures/board.json";
import { renderBrief, renderContext, renderSearch } from "../../../mcp-server/src/render";

const BUDGET = { brief_me: 300, context_for: 600, search: 400 };

describe("token budgets", { timeout: 180_000 }, () => {
  const rendered: Record<keyof typeof BUDGET, string> = { brief_me: "", context_for: "", search: "" };

  beforeAll(async () => {
    await embedText("warm up");
    const db = createTestDb();
    const svc = createService(db);
    await loadFixtureBoard(svc, db, boardJson as FixtureBoard);

    // A long-lived board: long recent posts, many projects, busy agents and claims.
    for (let i = 0; i < 10; i++) {
      await svc.postInsight({
        agentId: "acme-api/main-b7c8d9",
        project: "acme-api",
        text: `Note ${i}: the invoice export batches rows in pages of five hundred because a single query over the full year timed out on the reporting replica again.`,
      });
    }
    for (let i = 0; i < 40; i++) {
      await svc.postInsight({ agentId: `side-${i}/main-000000`, project: `side-${i}`, text: `Set up the side-${i} repo.` });
    }
    const agents = ["acme-api/main-a1b2c3", "acme-api/main-b7c8d9", "acme-web/main-d4e5f6", "acme-web/main-77aa01", "tooling/main-e1f2a3", "infra/main-c0ffee"];
    for (const a of agents) svc.broadcastStatus(a, a.split("/")[0], "active", `working on the ${a.split("/")[0]} release checklist`);
    for (const [a, scope] of [[agents[0], "src/workers/"], [agents[1], "src/billing/"], [agents[2], "src/app/checkout/"], [agents[4], "scripts/"], [agents[5], "deploy/"]]) {
      svc.createClaim(a, a.split("/")[0], scope, "module", 60);
    }

    rendered.brief_me = renderBrief(await svc.briefMe("acme-api/main-a1b2c3", "acme-api", BUDGET.brief_me), {
      project: "acme-api",
      maxTokens: BUDGET.brief_me,
    });
    rendered.context_for = renderContext(
      await svc.contextFor({
        files: ["src/workers/pool.ts", "src/db/feed.ts", "src/billing/webhooks.ts"],
        intent: "refactoring the worker pool and the feed query",
        project: "acme-api",
        maxTokens: BUDGET.context_for,
      }),
    );
    const query = "worker pool race condition";
    rendered.search = renderSearch(query, await svc.searchEntries(query, 5));
  }, 180_000);

  it("brief_me at max_tokens=300 renders within 300 tokens", () => {
    expect(countTokens(rendered.brief_me)).toBeLessThanOrEqual(BUDGET.brief_me);
  });

  it("context_for at max_tokens=600 renders within 600 tokens", () => {
    expect(countTokens(rendered.context_for)).toBeLessThanOrEqual(BUDGET.context_for);
  });

  it("search with limit 5 renders within 400 tokens", () => {
    expect(countTokens(rendered.search)).toBeLessThanOrEqual(BUDGET.search);
  });

  it("prints the budget table", () => {
    const rows = (Object.keys(BUDGET) as (keyof typeof BUDGET)[]).map(
      (tool) => `| \`${tool}\` | ${BUDGET[tool]} | ${countTokens(rendered[tool])} |`,
    );
    console.log(["| Tool | Budget | Measured (busy board) |", "|---|---|---|", ...rows].join("\n"));
  });
});
