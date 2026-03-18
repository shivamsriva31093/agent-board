/**
 * Backfill entry_mentions for all existing entries.
 *
 * Scans all entries' tags against registered project aliases.
 * Safe to re-run — uses INSERT OR IGNORE.
 *
 * Run: npx tsx src/db/backfill-mentions.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "agent-board.db");

function backfill() {
  console.log(`Backfilling mentions in: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const projects = db.prepare("SELECT * FROM projects").all() as any[];
  if (projects.length === 0) {
    console.log("No projects registered yet. Register projects first, then re-run.");
    db.close();
    return;
  }

  console.log(`Found ${projects.length} registered projects:`);
  for (const p of projects) {
    const aliases = JSON.parse(p.aliases);
    console.log(`  ${p.id}: aliases=[${aliases.join(", ")}]`);
  }

  const matchSets = projects.map((p: any) => ({
    id: p.id,
    terms: [p.id, ...JSON.parse(p.aliases)].map((a: string) => a.toLowerCase()),
  }));

  const entries = db
    .prepare(
      `SELECT e.id, e.tags, a.project as source_project
       FROM entries e
       JOIN agents a ON a.id = e.agent_id`,
    )
    .all() as { id: number; tags: string | null; source_project: string }[];

  console.log(`Scanning ${entries.length} entries...`);

  const stmtInsert = db.prepare(
    "INSERT OR IGNORE INTO entry_mentions (entry_id, project_id) VALUES (?, ?)",
  );

  let mentionCount = 0;
  const insertMany = db.transaction(() => {
    for (const entry of entries) {
      const tags: string[] = entry.tags ? JSON.parse(entry.tags) : [];
      const tagsLower = tags.map((t) => t.toLowerCase());

      for (const proj of matchSets) {
        if (proj.id === entry.source_project) continue;

        const matched = tagsLower.some((tag) => proj.terms.includes(tag));
        if (matched) {
          stmtInsert.run(entry.id, proj.id);
          mentionCount++;
        }
      }
    }
  });

  insertMany();

  console.log(`Inserted ${mentionCount} mention links.`);
  db.close();
  console.log("Backfill complete.");
}

backfill();
