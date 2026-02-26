import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "fs";
import path from "path";

let singleton: Database.Database | null = null;

function loadSchema(db: Database.Database): void {
  const schemaPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "schema.sql",
  );
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  // Rebuild FTS index to ensure all entries are indexed
  db.exec(`INSERT INTO entries_fts(entries_fts) VALUES('rebuild')`);

}

function configure(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
}

/**
 * Returns the singleton database connection.
 * Uses DB_PATH env var or defaults to {cwd}/agent-board.db.
 */
export function getDb(): Database.Database {
  if (singleton) return singleton;

  const dbPath =
    process.env.DB_PATH || path.resolve(process.cwd(), "agent-board.db");
  singleton = new Database(dbPath);
  configure(singleton);
  loadSchema(singleton);
  return singleton;
}

/**
 * Creates an in-memory database for testing.
 * Each call returns a fresh isolated database.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  configure(db);

  // Load schema directly from file using __dirname-equivalent for ESM
  const schemaPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "schema.sql",
  );
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
}

/**
 * Closes the singleton connection (useful for graceful shutdown).
 */
export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
