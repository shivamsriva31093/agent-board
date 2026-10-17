/**
 * Re-scores every entry with scoreSignal(). New posts are scored at post
 * time and existing ones when the signal column is added, so this is only
 * needed after changing the scoring rules. Safe to re-run: it only writes
 * the signal column.
 *
 * Run: DB_PATH=~/.agent-board/agent-board.db npx tsx src/db/backfill-signal.ts
 */
import Database from "better-sqlite3";
import path from "path";
import { backfillSignal, ensureColumns } from "@/db/migrations";

export { backfillSignal };

// CLI entry point — only runs when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureColumns(db);
  const { updated, histogram } = backfillSignal(db);
  db.close();
  console.log(`Scored ${updated} entries in ${dbPath}`);
  for (const bucket of Object.keys(histogram).sort()) {
    console.log(`  signal ${bucket}: ${histogram[bucket]}`);
  }
}
