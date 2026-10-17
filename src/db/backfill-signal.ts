/**
 * Scores every existing entry with scoreSignal(). New posts are scored at
 * post time; run this once after upgrading a board that predates signal.
 * Safe to re-run: it only writes the signal column.
 *
 * Run: DB_PATH=~/.agent-board/agent-board.db npx tsx src/db/backfill-signal.ts
 */
import Database from "better-sqlite3";
import path from "path";
import { ensureColumns } from "@/db/migrations";
import { scoreSignal } from "@/lib/signal";

export function backfillSignal(db: Database.Database): { updated: number; histogram: Record<string, number> } {
  ensureColumns(db);
  const entries = db.prepare("SELECT id, text, code_block FROM entries").all() as {
    id: number;
    text: string;
    code_block: string | null;
  }[];
  const update = db.prepare("UPDATE entries SET signal = ? WHERE id = ?");
  const histogram: Record<string, number> = {};

  db.transaction(() => {
    for (const e of entries) {
      const signal = scoreSignal({ text: e.text, hasCode: e.code_block !== null });
      update.run(signal, e.id);
      const bucket = (Math.floor(signal * 10) / 10).toFixed(1);
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }
  })();

  return { updated: entries.length, histogram };
}

// CLI entry point — only runs when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const { updated, histogram } = backfillSignal(db);
  db.close();
  console.log(`Scored ${updated} entries in ${dbPath}`);
  for (const bucket of Object.keys(histogram).sort()) {
    console.log(`  signal ${bucket}: ${histogram[bucket]}`);
  }
}
