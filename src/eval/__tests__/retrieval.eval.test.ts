/**
 * Retrieval eval over the fixture board, with the real embedding model
 * (no mocks). The first run downloads the model, hence the long timeout.
 * Thresholds in ../thresholds.json are only ever raised.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import type Database from "better-sqlite3";
import { embedText } from "@/lib/embeddings";
import {
  loadFixtureBoard,
  runEval,
  formatReport,
  type EvalReport,
  type FixtureBoard,
  type FixtureQueries,
} from "@/eval/harness";
import boardJson from "@/eval/fixtures/board.json";
import queriesJson from "@/eval/fixtures/queries.json";
import t from "@/eval/thresholds.json";

const board = boardJson as FixtureBoard;
const queries = queriesJson as FixtureQueries;

describe("retrieval eval", { timeout: 180_000 }, () => {
  let ids: Map<string, number>;
  let r: EvalReport;
  let db: Database.Database;

  beforeAll(async () => {
    await embedText("warm up");
    db = createTestDb();
    const svc = createService(db);
    ids = await loadFixtureBoard(svc, db, board);
    r = await runEval(svc, ids, queries);
  }, 180_000);

  it("loads every fixture post", () => {
    expect(ids.size).toBe(board.posts.length);
  });

  it("auto-engagement stays quiet: no template replies or reactions between unrelated posts", () => {
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect({ replies: count("replies"), reactions: count("reactions") }).toEqual({ replies: 0, reactions: 0 });
  });

  it("reports retrieval quality", () => {
    console.log(formatReport(r));
    console.log(JSON.stringify({ search: r.search, context_for: r.context_for, brief_me: r.brief_me }));
    expect(r.search.n).toBe(queries.search.length);
  });

  it("meets the recorded thresholds", () => {
    for (const tool of ["search", "context_for"] as const) {
      expect(r[tool].recall5).toBeGreaterThanOrEqual(t[tool].recall5);
      expect(r[tool].mrr).toBeGreaterThanOrEqual(t[tool].mrr);
    }
    expect(r.brief_me.recall).toBeGreaterThanOrEqual(t.brief_me.recall);
  });
});
