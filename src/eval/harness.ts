/**
 * Retrieval eval harness: loads a fixture board into a real service (real
 * embeddings), runs golden queries through search / context_for / brief_me,
 * and scores them with recall@k and reciprocal rank.
 */
import type Database from "better-sqlite3";
import type { createService } from "@/db/service";

type Service = ReturnType<typeof createService>;

export interface FixturePost {
  key: string;
  agent: string;
  project: string;
  text: string;
  tags?: string[];
  scope?: string[];
  days_ago: number;
}

export interface FixtureClaim {
  agent: string;
  project: string;
  scope: string;
  scope_type: "file" | "module" | "area";
  ttl_minutes: number;
}

export interface FixtureBoard {
  posts: FixturePost[];
  claims: FixtureClaim[];
}

/** `expected` holds fixture keys (resolved through the id map) or raw entry ids. */
type Expected = (string | number)[];

export interface FixtureQueries {
  search: { id: string; query: string; project: string | null; expected: Expected }[];
  context_for: { id: string; files: string[]; intent: string; project: string | null; expected: Expected }[];
  brief_me: { id: string; agent: string; project: string; must_include: Expected }[];
}

export interface EvalReport {
  search: { recall5: number; mrr: number; n: number };
  context_for: { recall5: number; mrr: number; n: number };
  brief_me: { recall: number; n: number };
  perQuery: { id: string; tool: string; recall5: number; rr: number }[];
}

export function recallAtK(ranked: number[], expected: number[], k: number): number {
  if (expected.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return expected.filter((id) => top.has(id)).length / expected.length;
}

export function reciprocalRank(ranked: number[], expected: number[]): number {
  const wanted = new Set(expected);
  const index = ranked.findIndex((id) => wanted.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export async function loadFixtureBoard(
  svc: Service,
  db: Database.Database,
  board: FixtureBoard,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const now = Math.floor(Date.now() / 1000);
  const setCreatedAt = db.prepare("UPDATE entries SET created_at = ? WHERE id = ?");

  // In real use each agent's MCP server registers its project on startup;
  // mention matching only sees registered projects.
  for (const project of new Set(board.posts.map((p) => p.project))) svc.resolveProject(project);

  for (const post of board.posts) {
    if (ids.has(post.key)) throw new Error(`duplicate fixture key: ${post.key}`);
    const { entry_id } = await svc.postInsight({
      agentId: post.agent,
      project: post.project,
      text: post.text,
      tags: post.tags,
      scope: post.scope,
    });
    setCreatedAt.run(now - post.days_ago * 86400, entry_id);
    ids.set(post.key, entry_id);
  }

  for (const c of board.claims) {
    svc.createClaim(c.agent, c.project, c.scope, c.scope_type, c.ttl_minutes);
  }

  // postInsight stores embeddings fire-and-forget; wait until all have landed.
  const countEmbeddings = db.prepare("SELECT count(*) AS n FROM entry_embeddings");
  const deadline = Date.now() + 30_000;
  while ((countEmbeddings.get() as { n: number }).n < board.posts.length) {
    if (Date.now() > deadline) throw new Error("fixture embeddings did not finish within 30s");
    await new Promise((r) => setTimeout(r, 50));
  }
  return ids;
}

export async function runEval(
  svc: Service,
  ids: Map<string, number>,
  queries: FixtureQueries,
): Promise<EvalReport> {
  const resolve = (expected: Expected): number[] =>
    expected.map((x) => {
      if (typeof x === "number") return x;
      const id = ids.get(x);
      if (id === undefined) throw new Error(`unknown fixture key in queries: ${x}`);
      return id;
    });
  const perQuery: EvalReport["perQuery"] = [];

  for (const q of queries.search) {
    const ranked = (await svc.searchEntries(q.query, 5, q.project ?? undefined)).map((e) => e.id);
    const expected = resolve(q.expected);
    perQuery.push({ id: q.id, tool: "search", recall5: recallAtK(ranked, expected, 5), rr: reciprocalRank(ranked, expected) });
  }

  for (const q of queries.context_for) {
    const result = await svc.contextFor({
      files: q.files,
      intent: q.intent,
      project: q.project ?? undefined,
      maxTokens: 600,
    });
    const ranked = result.entries.map((e) => e.id);
    const expected = resolve(q.expected);
    perQuery.push({ id: q.id, tool: "context_for", recall5: recallAtK(ranked, expected, 5), rr: reciprocalRank(ranked, expected) });
  }

  for (const q of queries.brief_me) {
    const brief = await svc.briefMe(q.agent, q.project, 500);
    const ranked = [...brief.in_your_projects, ...(brief.mentions ?? []), ...brief.relevant_to_you].map((e) => e.id);
    const expected = resolve(q.must_include);
    // A brief is read whole, so recall counts the full list rather than the top 5.
    perQuery.push({ id: q.id, tool: "brief_me", recall5: recallAtK(ranked, expected, ranked.length), rr: reciprocalRank(ranked, expected) });
  }

  const mean = (tool: string, field: "recall5" | "rr") => {
    const rows = perQuery.filter((p) => p.tool === tool);
    return rows.length === 0 ? 0 : rows.reduce((sum, p) => sum + p[field], 0) / rows.length;
  };
  return {
    search: { recall5: mean("search", "recall5"), mrr: mean("search", "rr"), n: queries.search.length },
    context_for: { recall5: mean("context_for", "recall5"), mrr: mean("context_for", "rr"), n: queries.context_for.length },
    brief_me: { recall: mean("brief_me", "recall5"), n: queries.brief_me.length },
    perQuery,
  };
}

export function formatReport(r: EvalReport): string {
  const num = (x: number, n: number) => (n === 0 ? " n/a" : x.toFixed(2));
  const lines = [
    "tool          n  recall@5   MRR",
    `search      ${String(r.search.n).padStart(3)}      ${num(r.search.recall5, r.search.n)}  ${num(r.search.mrr, r.search.n)}`,
    `context_for ${String(r.context_for.n).padStart(3)}      ${num(r.context_for.recall5, r.context_for.n)}  ${num(r.context_for.mrr, r.context_for.n)}`,
    `brief_me    ${String(r.brief_me.n).padStart(3)}      ${num(r.brief_me.recall, r.brief_me.n)}     -   (recall over the whole brief)`,
  ];
  const misses = r.perQuery.filter((p) => p.recall5 < 1 || p.rr < 1);
  if (misses.length > 0) {
    lines.push("", "not ranked first:");
    for (const m of misses) lines.push(`  ${m.id.padEnd(5)} ${m.tool.padEnd(11)} recall=${m.recall5.toFixed(2)} rr=${m.rr.toFixed(2)}`);
  }
  return lines.join("\n");
}
