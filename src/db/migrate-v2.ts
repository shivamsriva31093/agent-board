/**
 * One-time migration script: v1 (posts) → v2 (entries + claims + digests)
 *
 * Run with: npx tsx src/db/migrate-v2.ts
 *
 * Idempotent — safe to run multiple times.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import path from "path";

const dbPath =
  process.env.DB_PATH ||
  path.resolve(process.cwd(), "agent-board.db");

console.log(`Migrating database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // OFF during migration to allow ALTER TABLE / renames
sqliteVec.load(db);

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { 1: number } | undefined;
  return !!row;
}

function columnExists(table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function triggerExists(name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(name) as { 1: number } | undefined;
  return !!row;
}

function vtableExists(name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? AND sql LIKE '%virtual%'")
    .get(name) as { 1: number } | undefined;
  // FTS5 tables show up as regular tables in sqlite_master but their SQL contains "virtual"
  // Let's just check if the table exists at all
  if (row) return true;
  // Also check by trying to query — fts5 tables might not have "virtual" in their sql
  const row2 = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { 1: number } | undefined;
  return !!row2;
}

// ── Step 1: Add new columns to agents ────────────────────────────────
console.log("Step 1: Adding new columns to agents...");

if (!columnExists("agents", "status")) {
  db.exec("ALTER TABLE agents ADD COLUMN status TEXT DEFAULT NULL");
  console.log("  Added agents.status");
} else {
  console.log("  agents.status already exists");
}

if (!columnExists("agents", "current_task")) {
  db.exec("ALTER TABLE agents ADD COLUMN current_task TEXT DEFAULT NULL");
  console.log("  Added agents.current_task");
} else {
  console.log("  agents.current_task already exists");
}

if (!columnExists("agents", "status_updated_at")) {
  db.exec("ALTER TABLE agents ADD COLUMN status_updated_at INTEGER DEFAULT NULL");
  console.log("  Added agents.status_updated_at");
} else {
  console.log("  agents.status_updated_at already exists");
}

// ── Step 2: Rename posts → entries ───────────────────────────────────
console.log("Step 2: Renaming posts → entries...");

if (tableExists("posts") && !tableExists("entries")) {
  // Drop old FTS and trigger first (they reference "posts")
  if (triggerExists("posts_fts_insert")) {
    db.exec("DROP TRIGGER posts_fts_insert");
    console.log("  Dropped trigger posts_fts_insert");
  }

  // Drop old FTS virtual table
  if (vtableExists("posts_fts")) {
    db.exec("DROP TABLE posts_fts");
    console.log("  Dropped posts_fts");
  }

  // Drop old indexes that reference posts
  db.exec("DROP INDEX IF EXISTS idx_posts_created");
  db.exec("DROP INDEX IF EXISTS idx_posts_agent");
  console.log("  Dropped old posts indexes");

  // Rename the table
  db.exec("ALTER TABLE posts RENAME TO entries");
  console.log("  Renamed posts → entries");
} else if (tableExists("entries")) {
  console.log("  entries table already exists");

  // Still clean up old FTS if it lingers
  if (triggerExists("posts_fts_insert")) {
    db.exec("DROP TRIGGER posts_fts_insert");
    console.log("  Dropped lingering trigger posts_fts_insert");
  }
  if (vtableExists("posts_fts")) {
    db.exec("DROP TABLE posts_fts");
    console.log("  Dropped lingering posts_fts");
  }
} else {
  console.log("  WARNING: neither posts nor entries table found!");
}

// ── Step 3: Add new columns to entries ───────────────────────────────
console.log("Step 3: Adding new columns to entries...");

if (tableExists("entries")) {
  if (!columnExists("entries", "summary")) {
    db.exec("ALTER TABLE entries ADD COLUMN summary TEXT");
    console.log("  Added entries.summary");
  } else {
    console.log("  entries.summary already exists");
  }

  if (!columnExists("entries", "entry_type")) {
    db.exec("ALTER TABLE entries ADD COLUMN entry_type TEXT");
    console.log("  Added entries.entry_type");
  } else {
    console.log("  entries.entry_type already exists");
  }

  if (!columnExists("entries", "scope")) {
    db.exec("ALTER TABLE entries ADD COLUMN scope TEXT");
    console.log("  Added entries.scope");
  } else {
    console.log("  entries.scope already exists");
  }
}

// ── Step 4: Create new FTS and indexes on entries ────────────────────
console.log("Step 4: Creating new FTS + indexes on entries...");

// Create indexes (IF NOT EXISTS is safe)
db.exec("CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_entries_agent ON entries(agent_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type)");
console.log("  Created entries indexes");

// Create FTS5 virtual table
if (!vtableExists("entries_fts")) {
  db.exec(`
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      text, tags, content=entries, content_rowid=id
    )
  `);
  console.log("  Created entries_fts");
} else {
  console.log("  entries_fts already exists");
}

// Create trigger
if (!triggerExists("entries_ai")) {
  db.exec(`
    CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
    END
  `);
  console.log("  Created entries_ai trigger");
} else {
  console.log("  entries_ai trigger already exists");
}

// Rebuild FTS index to pick up existing data
db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");
console.log("  Rebuilt entries_fts index");

// ── Step 5: Create claims table ──────────────────────────────────────
console.log("Step 5: Creating claims table...");

db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    scope TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'area',
    claimed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status, expires_at)");
console.log("  Done");

// ── Step 6: Create digests table ─────────────────────────────────────
console.log("Step 6: Creating digests table...");

db.exec(`
  CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'project',
    summary TEXT NOT NULL,
    entry_count INTEGER NOT NULL DEFAULT 0,
    last_entry_id INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    UNIQUE(scope, scope_type)
  )
`);
console.log("  Done");

// ── Re-enable foreign keys ───────────────────────────────────────────
db.pragma("foreign_keys = ON");

// ── Verify ───────────────────────────────────────────────────────────
console.log("\n=== Verification ===");

const entryCount = (db.prepare("SELECT COUNT(*) as c FROM entries").get() as { c: number }).c;
console.log(`entries: ${entryCount} rows`);

const agentCols = (db.pragma("table_info(agents)") as Array<{ name: string }>).map((c) => c.name);
console.log(`agents columns: ${agentCols.join(", ")}`);

const tables = (
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
).map((r) => r.name);
console.log(`tables: ${tables.join(", ")}`);

console.log("\nMigration complete!");

db.close();
