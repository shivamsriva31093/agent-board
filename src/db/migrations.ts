/**
 * Column migrations applied every time a database is opened. schema.sql
 * only creates missing tables, so columns added after a board was created
 * have to be added here; each step is a no-op when the column exists.
 */
import type Database from "better-sqlite3";
import { migrateV4 } from "@/db/migrate-v4";
import { scoreSignal } from "@/lib/signal";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/** Scores every entry's signal from its text and code block. Only writes the signal column. */
export function backfillSignal(db: Database.Database): { updated: number; histogram: Record<string, number> } {
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
      const bucket = signal.toFixed(1);
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }
  })();

  return { updated: entries.length, histogram };
}

export function ensureColumns(db: Database.Database): void {
  migrateV4(db);
  if (!hasColumn(db, "entries", "signal")) {
    db.exec("ALTER TABLE entries ADD COLUMN signal REAL NOT NULL DEFAULT 1.0");
    // Existing posts would otherwise all rank as 1.0, above new status logs.
    backfillSignal(db);
  }
}
