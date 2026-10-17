import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { ensureColumns } from "@/db/migrations";
import { backfillSignal } from "@/db/backfill-signal";
import { createTestDb } from "@/db/connection";
import { scoreSignal } from "@/lib/signal";

// An entries table from before v4 — the shape a long-lived board still has.
function oldBoard(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.prepare("INSERT INTO entries (agent_id, text, created_at) VALUES ('p/a', 'old post', 123)").run();
  return db;
}

const columns = (db: Database.Database) =>
  (db.prepare("PRAGMA table_info(entries)").all() as { name: string }[]).map((c) => c.name);

describe("ensureColumns", () => {
  it("adds anchors, last_seen_fresh_at and signal to an old entries table", () => {
    const db = oldBoard();
    ensureColumns(db);
    expect(columns(db)).toEqual(expect.arrayContaining(["anchors", "last_seen_fresh_at", "signal"]));
  });

  it("is idempotent and leaves existing rows intact with signal 1.0", () => {
    const db = oldBoard();
    ensureColumns(db);
    ensureColumns(db);
    expect(db.prepare("SELECT text, created_at, signal FROM entries").get()).toEqual({
      text: "old post",
      created_at: 123,
      signal: 1,
    });
  });
});

describe("backfillSignal", () => {
  const texts = [
    "WIP on the dashboard",
    "Fixed a race in the worker pool because the lock release was never awaited by the caller.",
    "Added the AnalyticsCharts client component with four Recharts charts.",
  ];

  function boardWithUnscoredPosts(): Database.Database {
    const db = createTestDb();
    db.prepare("INSERT INTO agents (id, project, avatar_seed, first_seen, last_seen) VALUES ('p/a', 'p', 'x', 1, 1)").run();
    const insert = db.prepare("INSERT INTO entries (agent_id, text, code_block, created_at) VALUES ('p/a', ?, ?, ?)");
    insert.run(texts[0], null, 100);
    insert.run(texts[1], null, 200);
    insert.run(texts[2], '{"lang":"ts","content":"x"}', 300);
    return db;
  }

  const rows = (db: Database.Database) =>
    db.prepare("SELECT text, code_block, created_at, signal FROM entries ORDER BY id").all() as {
      text: string; code_block: string | null; created_at: number; signal: number;
    }[];

  it("scores every entry from its text and code block", () => {
    const db = boardWithUnscoredPosts();
    backfillSignal(db);
    expect(rows(db).map((r) => r.signal)).toEqual([
      scoreSignal({ text: texts[0] }),
      scoreSignal({ text: texts[1] }),
      scoreSignal({ text: texts[2], hasCode: true }),
    ]);
  });

  it("is idempotent and leaves every other column untouched", () => {
    const db = boardWithUnscoredPosts();
    backfillSignal(db);
    const first = rows(db);
    backfillSignal(db);
    expect(rows(db)).toEqual(first);
    expect(first.map((r) => r.created_at)).toEqual([100, 200, 300]);
  });
});
