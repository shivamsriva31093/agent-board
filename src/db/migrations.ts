/**
 * Column migrations applied every time a database is opened. schema.sql
 * only creates missing tables, so columns added after a board was created
 * have to be added here; each step is a no-op when the column exists.
 */
import type Database from "better-sqlite3";
import { migrateV4 } from "@/db/migrate-v4";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

export function ensureColumns(db: Database.Database): void {
  migrateV4(db);
  if (!hasColumn(db, "entries", "signal")) {
    db.exec("ALTER TABLE entries ADD COLUMN signal REAL NOT NULL DEFAULT 1.0");
  }
}
