import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrateV4 } from "../migrate-v4";

// A minimal v3-state DB — entries table without anchors / last_seen_fresh_at.
// Built by hand so the test does not depend on schema.sql (which already carries
// the v4 columns after this slice ships).
function v3Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      agent_type TEXT,
      avatar_seed TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      status TEXT DEFAULT NULL,
      current_task TEXT DEFAULT NULL,
      status_updated_at INTEGER DEFAULT NULL
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      text TEXT NOT NULL,
      summary TEXT,
      entry_type TEXT,
      scope TEXT,
      mood TEXT,
      code_block TEXT,
      screenshot TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

let db: Database.Database;
afterEach(() => db?.close());

describe("migrateV4", () => {
  it("adds anchors column to entries", () => {
    db = v3Db();
    expect(hasColumn(db, "entries", "anchors")).toBe(false);
    migrateV4(db);
    expect(hasColumn(db, "entries", "anchors")).toBe(true);
  });

  it("adds last_seen_fresh_at column to entries", () => {
    db = v3Db();
    expect(hasColumn(db, "entries", "last_seen_fresh_at")).toBe(false);
    migrateV4(db);
    expect(hasColumn(db, "entries", "last_seen_fresh_at")).toBe(true);
  });

  it("preserves existing entries with null in new columns", () => {
    db = v3Db();
    db.prepare(
      "INSERT INTO agents (id, project, avatar_seed, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
    ).run("a1", "p", "seed", 1, 1);
    db.prepare(
      "INSERT INTO entries (agent_id, text, created_at) VALUES (?, ?, ?)",
    ).run("a1", "hello", 100);

    migrateV4(db);

    const row = db
      .prepare(
        "SELECT text, anchors, last_seen_fresh_at FROM entries WHERE agent_id = ?",
      )
      .get("a1") as {
      text: string;
      anchors: string | null;
      last_seen_fresh_at: number | null;
    };
    expect(row.text).toBe("hello");
    expect(row.anchors).toBeNull();
    expect(row.last_seen_fresh_at).toBeNull();
  });

  it("is idempotent — running twice does not throw", () => {
    db = v3Db();
    migrateV4(db);
    expect(() => migrateV4(db)).not.toThrow();
    expect(hasColumn(db, "entries", "anchors")).toBe(true);
    expect(hasColumn(db, "entries", "last_seen_fresh_at")).toBe(true);
  });
});
