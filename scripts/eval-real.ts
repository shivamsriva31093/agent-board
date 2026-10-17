/**
 * Scores retrieval against your real board without touching it: backs the
 * live database up to a temp file, upgrades the copy to this checkout's
 * schema and signal scores, and runs the golden queries in
 * ~/.agent-board/eval/golden.json (generated from the board on the first
 * run; edit it freely).
 *
 * Run: DB_PATH=~/.agent-board/agent-board.db pnpm eval:real
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createService } from "@/db/service";
import { ensureColumns } from "@/db/migrations";
import { backfillSignal } from "@/db/backfill-signal";
import { buildGoldenCandidates } from "@/eval/golden";
import { runEval, formatReport, type FixtureQueries } from "@/eval/harness";

const dbPath = process.env.DB_PATH ?? path.join(os.homedir(), ".agent-board", "agent-board.db");
const goldenPath = path.join(os.homedir(), ".agent-board", "eval", "golden.json");

async function main(): Promise<void> {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no board database at ${dbPath}; set DB_PATH`);
  }

  // Work on a copy so the live board is only ever read.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-board-eval-"));
  const copyPath = path.join(tmpDir, "board.db");
  const live = new Database(dbPath, { readonly: true, fileMustExist: true });
  await live.backup(copyPath);
  live.close();

  const db = new Database(copyPath);
  try {
    sqliteVec.load(db);
    ensureColumns(db);
    backfillSignal(db);
    const svc = createService(db);

    let golden: FixtureQueries;
    if (fs.existsSync(goldenPath)) {
      golden = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
    } else {
      golden = buildGoldenCandidates(db, { maxPerTool: 30, sinceDays: 180 });
      fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
      fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
      console.log(`Created ${goldenPath} (${golden.search.length} search, ${golden.context_for.length} context_for queries)\n`);
    }

    const report = await runEval(svc, new Map(), golden);
    console.log(formatReport(report));
    console.log(
      "\nThe generated golden set is leave-one-out and self-labelled: each query targets the post it was built from.",
      "\nEdit the file to add expectations you actually care about.",
    );
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
