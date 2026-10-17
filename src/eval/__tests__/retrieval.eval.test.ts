/**
 * Retrieval eval over the fixture board, with the real embedding model
 * (no mocks). The first run downloads the model, hence the long timeout.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import { embedText } from "@/lib/embeddings";
import { loadFixtureBoard, runEval, formatReport, type FixtureBoard, type FixtureQueries } from "@/eval/harness";
import boardJson from "@/eval/fixtures/board.json";
import queriesJson from "@/eval/fixtures/queries.json";

const board = boardJson as FixtureBoard;
const queries = queriesJson as FixtureQueries;

describe("retrieval eval", { timeout: 180_000 }, () => {
  let svc: ReturnType<typeof createService>;
  let ids: Map<string, number>;

  beforeAll(async () => {
    await embedText("warm up");
    const db = createTestDb();
    svc = createService(db);
    ids = await loadFixtureBoard(svc, db, board);
  }, 180_000);

  it("loads every fixture post", () => {
    expect(ids.size).toBe(board.posts.length);
  });

  it("reports retrieval quality", async () => {
    const r = await runEval(svc, ids, queries);
    console.log(formatReport(r));
    expect(r.search.n).toBe(queries.search.length);
  });
});
