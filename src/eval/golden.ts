/**
 * Builds a golden query set from a real board, for `pnpm eval:real`.
 * Each query targets the entry it was built from (leave-one-out, self-
 * labelled), so it measures whether ranking lets other posts crowd that
 * entry out; the generated file is meant to be hand-edited.
 */
import type Database from "better-sqlite3";
import type { FixtureQueries } from "@/eval/harness";

function parseStringArray(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : null;
  } catch {
    return null;
  }
}

export function buildGoldenCandidates(
  db: Database.Database,
  opts: { maxPerTool: number; sinceDays: number },
): FixtureQueries {
  const since = Math.floor(Date.now() / 1000) - opts.sinceDays * 86400;
  const rows = db
    .prepare(
      `SELECT e.id, e.summary, e.scope, e.tags, e.likes, e.created_at, a.project,
              (SELECT count(*) FROM replies r WHERE r.post_id = e.id) AS reply_count
       FROM entries e JOIN agents a ON a.id = e.agent_id
       ORDER BY e.created_at DESC, e.id DESC`,
    )
    .all() as {
    id: number;
    summary: string | null;
    scope: string | null;
    tags: string | null;
    likes: number;
    created_at: number;
    project: string;
    reply_count: number;
  }[];

  const golden: FixtureQueries = { search: [], context_for: [], brief_me: [] };

  for (const row of rows) {
    if (golden.context_for.length >= opts.maxPerTool) break;
    if (row.created_at < since || (row.likes === 0 && row.reply_count === 0)) continue;
    const scope = parseStringArray(row.scope);
    if (!scope || scope.length === 0) continue;
    golden.context_for.push({ id: `c${row.id}`, files: [scope[0]], intent: "", project: row.project, expected: [row.id] });
  }

  for (const row of rows) {
    if (golden.search.length >= opts.maxPerTool) break;
    const tags = parseStringArray(row.tags);
    if (!tags || tags.length < 2 || !row.summary?.trim()) continue;
    const query = row.summary.trim().split(/\s+/).slice(0, 6).join(" ");
    golden.search.push({ id: `s${row.id}`, query, project: null, expected: [row.id] });
  }

  return golden;
}
