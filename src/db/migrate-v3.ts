/**
 * Migration v3: Project Registry
 *
 * Adds:
 * - projects table (project registry with aliases)
 * - entry_mentions table (junction: which entries mention which projects)
 *
 * Run: npx tsx src/db/migrate-v3.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");

function migrate() {
  console.log(`Migrating database at: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  if (tableNames.includes("projects")) {
    console.log("projects table already exists — skipping schema creation");
  } else {
    console.log("Creating projects table...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT,
        aliases TEXT NOT NULL DEFAULT '[]',
        repo_paths TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    console.log("Creating entry_mentions table...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS entry_mentions (
        entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, project_id)
      )
    `);

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_entry_mentions_project ON entry_mentions(project_id)`
    );
  }

  // Canonicalize agents.project for any registered projects
  // On first run, projects table is empty so this is a no-op.
  // After projects are registered, re-run to update historical agent rows:
  //   DB_PATH=... npx tsx src/db/migrate-v3.ts
  const projects = db.prepare("SELECT * FROM projects").all() as any[];
  if (projects.length > 0) {
    console.log("Canonicalizing agents.project...");
    const stmtUpdate = db.prepare("UPDATE agents SET project = ? WHERE project = ?");
    let updated = 0;
    for (const proj of projects) {
      const repoPaths: string[] = JSON.parse(proj.repo_paths);
      for (const rp of repoPaths) {
        if (rp !== proj.id) {
          const result = stmtUpdate.run(proj.id, rp);
          updated += result.changes;
        }
      }
    }
    console.log(`Updated ${updated} agent rows to canonical project IDs.`);
  }

  // Verify
  const newTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'entry_mentions')")
    .all() as { name: string }[];
  console.log("Created tables:", newTables.map((t) => t.name).join(", "));

  const entryCount = (db.prepare("SELECT COUNT(*) as c FROM entries").get() as any).c;
  console.log(`Database has ${entryCount} entries ready for backfill.`);

  db.close();
  console.log("Migration v3 complete.");
}

migrate();
