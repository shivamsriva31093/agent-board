/**
 * Backfills existing entries with summaries, types, embeddings, and digests.
 * Run with: npx tsx src/db/backfill-v2.ts
 * Safe to run multiple times (skips entries that already have a summary).
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import path from "path";
import { embedText, EMBEDDING_DIM } from "../lib/embeddings.js";
import { extractSummary, classifyEntryType } from "../lib/text-processing.js";

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "agent-board.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
sqliteVec.load(db);

// Ensure vec table exists
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS entry_embeddings USING vec0(
    entry_id INTEGER PRIMARY KEY,
    embedding float[${EMBEDDING_DIM}]
  )
`);

// Get entries without summaries
const entries = db.prepare(
  "SELECT id, text FROM entries WHERE summary IS NULL"
).all() as { id: number; text: string }[];

console.log(`Backfilling ${entries.length} entries...`);

const updateStmt = db.prepare(
  "UPDATE entries SET summary = ?, entry_type = ? WHERE id = ?"
);
const insertEmbedding = db.prepare(
  "INSERT OR REPLACE INTO entry_embeddings(entry_id, embedding) VALUES (CAST(? AS INTEGER), ?)"
);

async function backfill() {
  for (const entry of entries) {
    const summary = extractSummary(entry.text);
    const entryType = classifyEntryType(entry.text);
    updateStmt.run(summary, entryType, entry.id);

    try {
      const embedding = await embedText(entry.text);
      insertEmbedding.run(entry.id, Buffer.from(embedding.buffer));
    } catch (err) {
      console.warn(`  [${entry.id}] embedding failed: ${(err as Error).message}`);
    }

    process.stdout.write(
      `  [${entry.id}] ${entryType}: ${summary.slice(0, 60)}...\n`
    );
  }

  // Build digests per project
  const projects = db.prepare(`
    SELECT DISTINCT a.project, COUNT(e.id) as cnt, MAX(e.id) as max_id
    FROM entries e JOIN agents a ON e.agent_id = a.id
    GROUP BY a.project
  `).all() as { project: string; cnt: number; max_id: number }[];

  const upsertDigest = db.prepare(`
    INSERT INTO digests (scope, scope_type, summary, entry_count, last_entry_id, updated_at)
    VALUES (?, 'project', ?, ?, ?, ?)
    ON CONFLICT(scope, scope_type) DO UPDATE SET
      summary = excluded.summary, entry_count = excluded.entry_count,
      last_entry_id = excluded.last_entry_id, updated_at = excluded.updated_at
  `);

  const now = Math.floor(Date.now() / 1000);
  for (const p of projects) {
    const recentSummaries = db.prepare(`
      SELECT summary FROM entries e JOIN agents a ON e.agent_id = a.id
      WHERE a.project = ? AND summary IS NOT NULL
      ORDER BY e.created_at DESC LIMIT 5
    `).all(p.project) as { summary: string }[];

    const digest = recentSummaries.map((s) => s.summary).join("; ");
    upsertDigest.run(p.project, digest, p.cnt, p.max_id, now);
    console.log(`  Digest for ${p.project}: ${p.cnt} entries`);
  }

  console.log("Backfill complete.");
  db.close();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
