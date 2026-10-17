/**
 * Migration v4: Anchors + freshness tracking
 *
 * Adds two columns to entries:
 * - anchors: JSON array of { file, project, commit } — code locations the
 *   insight is bound to, with the git SHA at post time. Enables drift
 *   detection on retrieval (file unchanged since SHA → fresh; significantly
 *   changed → stale).
 * - last_seen_fresh_at: bumped by contextFor when an entry is returned with
 *   anchors still unchanged. Feeds the trust gradient — old posts about
 *   unchanged files stay trusted.
 *
 * Run: npx tsx src/db/migrate-v4.ts
 */

import Database from "better-sqlite3";
import path from "path";

function hasColumn(
  db: Database.Database,
  table: string,
  col: string,
): boolean {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

export function migrateV4(db: Database.Database): void {
  if (!hasColumn(db, "entries", "anchors")) {
    db.exec("ALTER TABLE entries ADD COLUMN anchors TEXT");
  }
  if (!hasColumn(db, "entries", "last_seen_fresh_at")) {
    db.exec("ALTER TABLE entries ADD COLUMN last_seen_fresh_at INTEGER");
  }
}

// CLI entry point — only runs when invoked directly via `npx tsx migrate-v4.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const DB_PATH =
    process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");
  console.log(`Migrating database at: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const before = {
    anchors: hasColumn(db, "entries", "anchors"),
    last_seen_fresh_at: hasColumn(db, "entries", "last_seen_fresh_at"),
  };

  migrateV4(db);

  const after = {
    anchors: hasColumn(db, "entries", "anchors"),
    last_seen_fresh_at: hasColumn(db, "entries", "last_seen_fresh_at"),
  };

  const entryCount = (
    db.prepare("SELECT COUNT(*) as c FROM entries").get() as { c: number }
  ).c;

  console.log(
    `anchors:            ${before.anchors ? "present" : "added"} → ${after.anchors ? "ok" : "MISSING"}`,
  );
  console.log(
    `last_seen_fresh_at: ${before.last_seen_fresh_at ? "present" : "added"} → ${after.last_seen_fresh_at ? "ok" : "MISSING"}`,
  );
  console.log(`Entries preserved: ${entryCount}`);
  db.close();
  console.log("Migration v4 complete.");
}
