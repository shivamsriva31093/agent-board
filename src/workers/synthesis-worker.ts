import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { cosineSimilarity, embedText, EMBEDDING_DIM } from "@/lib/embeddings";

// ── Config ──────────────────────────────────────────────────────────

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const CLUSTER_THRESHOLD = 0.4;       // cosine similarity for clustering
const MIN_CLUSTER_SIZE = 3;          // minimum entries to synthesize
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// ── DB setup ────────────────────────────────────────────────────────

function openDb(): Database.Database {
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "agent-board.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  // Ensure new tables exist
  const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  // Ensure vec0 table
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS entry_embeddings USING vec0(entry_id INTEGER PRIMARY KEY, embedding float[${EMBEDDING_DIM}])`);

  return db;
}

// ── LLM ─────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
const useCLI = !apiKey;

let anthropic: Anthropic | null = null;
if (apiKey) {
  anthropic = new Anthropic({ apiKey });
}

async function llmCall(prompt: string): Promise<string> {
  if (anthropic) {
    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "";
  }

  // Fallback: Claude Code CLI
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const result = execSync(
      `echo '${escaped}' | claude -p --model haiku --max-turns 1`,
      { encoding: "utf-8", timeout: 30000 },
    );
    return result.trim();
  } catch (e) {
    console.error("[synthesis] CLI fallback failed:", (e as Error).message);
    return "";
  }
}

// ── Clustering ──────────────────────────────────────────────────────

interface EntryForClustering {
  id: number;
  agent_id: string;
  summary: string | null;
  entry_type: string | null;
  tags: string;
  created_at: number;
  likes: number;
  embedding: Buffer;
}

function clusterEntries(entries: EntryForClustering[]): Map<string, EntryForClustering[]> {
  const clusters = new Map<string, EntryForClustering[]>();
  const assigned = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (assigned.has(entries[i].id)) continue;

    const cluster: EntryForClustering[] = [entries[i]];
    assigned.add(entries[i].id);
    const embA = new Float32Array(entries[i].embedding.buffer, entries[i].embedding.byteOffset, EMBEDDING_DIM);

    for (let j = i + 1; j < entries.length; j++) {
      if (assigned.has(entries[j].id)) continue;
      const embB = new Float32Array(entries[j].embedding.buffer, entries[j].embedding.byteOffset, EMBEDDING_DIM);
      if (cosineSimilarity(embA, embB) >= CLUSTER_THRESHOLD) {
        cluster.push(entries[j]);
        assigned.add(entries[j].id);
      }
    }

    // Derive topic label from most common tag
    const tagCounts = new Map<string, number>();
    for (const e of cluster) {
      const tags: string[] = JSON.parse(e.tags || "[]");
      for (const t of tags) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    let topic = "general";
    let maxCount = 0;
    for (const [tag, count] of tagCounts) {
      if (count > maxCount) { topic = tag; maxCount = count; }
    }

    if (cluster.length >= MIN_CLUSTER_SIZE) {
      const existing = clusters.get(topic);
      if (existing) {
        existing.push(...cluster);
      } else {
        clusters.set(topic, cluster);
      }
    }
  }

  return clusters;
}

// ── Synthesis loop ──────────────────────────────────────────────────

async function synthesizeProject(db: Database.Database, project: string): Promise<void> {
  // 1. Get watermark
  const watermarkRow = db.prepare(
    `SELECT MAX(last_entry_id) AS max_id FROM syntheses WHERE project = ?`
  ).get(project) as { max_id: number | null } | undefined;
  const watermark = watermarkRow?.max_id ?? 0;

  // Check for new entries
  const newCount = db.prepare(
    `SELECT COUNT(*) AS c FROM entries e JOIN agents a ON e.agent_id = a.id WHERE a.project = ? AND e.id > ?`
  ).get(project, watermark) as { c: number };
  if (newCount.c === 0) return;

  console.log(`[synthesis] ${project}: ${newCount.c} new entries since #${watermark}`);

  // 2. Fetch all project entries with embeddings
  const entries = db.prepare(`
    SELECT e.id, e.agent_id, e.summary, e.entry_type, e.tags, e.created_at, e.likes,
           ee.embedding
    FROM entries e
    JOIN agents a ON e.agent_id = a.id
    JOIN entry_embeddings ee ON ee.entry_id = e.id
    WHERE a.project = ?
    ORDER BY e.created_at DESC
  `).all(project) as EntryForClustering[];

  if (entries.length < MIN_CLUSTER_SIZE) return;

  // 3. Cluster
  const clusters = clusterEntries(entries);
  const ts = Math.floor(Date.now() / 1000);

  // 4. Synthesize each cluster
  for (const [topic, cluster] of clusters) {
    const entrySummaries = cluster
      .sort((a, b) => a.created_at - b.created_at)
      .map((e) => `- [${e.entry_type ?? "note"}, ${e.agent_id}] ${e.summary ?? "(no summary)"}`)
      .join("\n");

    const prompt = `Synthesize these ${cluster.length} knowledge entries into a concise summary (2-3 sentences max). Focus on: what was learned, what was decided, what consensus emerged. Be specific and factual.\n\nEntries:\n${entrySummaries}`;

    const summary = await llmCall(prompt);
    if (!summary) continue;

    const entryIds = cluster.map((e) => e.id);
    const maxEntryId = Math.max(...entryIds);

    db.prepare(`
      INSERT INTO syntheses (project, topic, synthesis_type, summary, entry_ids, entry_count, last_entry_id, created_at, updated_at)
      VALUES (?, ?, 'topic', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, topic, synthesis_type) DO UPDATE SET
        summary = ?, entry_ids = ?, entry_count = ?, last_entry_id = ?, updated_at = ?
    `).run(
      project, topic, summary, JSON.stringify(entryIds), cluster.length, maxEntryId, ts, ts,
      summary, JSON.stringify(entryIds), cluster.length, maxEntryId, ts,
    );

    console.log(`[synthesis] ${project}/${topic}: synthesized ${cluster.length} entries`);
  }

  // 5. Decision logs — entries of type decision/pattern grouped by common tags
  const decisions = entries.filter((e) => e.entry_type === "decision" || e.entry_type === "pattern");
  if (decisions.length >= 2) {
    const decisionsByTag = new Map<string, EntryForClustering[]>();
    for (const e of decisions) {
      const tags: string[] = JSON.parse(e.tags || "[]");
      for (const t of tags) {
        const group = decisionsByTag.get(t) ?? [];
        group.push(e);
        decisionsByTag.set(t, group);
      }
    }

    for (const [tag, group] of decisionsByTag) {
      if (group.length < 2) continue;
      const sorted = group.sort((a, b) => a.created_at - b.created_at);
      const timeline = sorted.map((e) => {
        const date = new Date(e.created_at * 1000).toISOString().slice(0, 10);
        return `- [${date}] ${e.summary ?? "(no summary)"} (${e.agent_id})`;
      }).join("\n");

      const prompt = `These entries track how a decision evolved over time. Summarize the progression in 2-3 sentences. What was the final state?\n\n${timeline}`;
      const summary = await llmCall(prompt);
      if (!summary) continue;

      const entryIds = sorted.map((e) => e.id);
      const maxEntryId = Math.max(...entryIds);

      db.prepare(`
        INSERT INTO syntheses (project, topic, synthesis_type, summary, entry_ids, entry_count, last_entry_id, created_at, updated_at)
        VALUES (?, ?, 'decision', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project, topic, synthesis_type) DO UPDATE SET
          summary = ?, entry_ids = ?, entry_count = ?, last_entry_id = ?, updated_at = ?
      `).run(
        project, tag, summary, JSON.stringify(entryIds), sorted.length, maxEntryId, ts, ts,
        summary, JSON.stringify(entryIds), sorted.length, maxEntryId, ts,
      );

      console.log(`[synthesis] ${project}/${tag}: decision log from ${sorted.length} entries`);
    }
  }
}

async function buildAgentMemory(db: Database.Database, agentId: string): Promise<void> {
  // Get watermark
  const mem = db.prepare(`SELECT last_entry_id FROM agent_memory WHERE agent_id = ?`).get(agentId) as { last_entry_id: number } | undefined;
  const watermark = mem?.last_entry_id ?? 0;

  // Check for new entries
  const newCount = db.prepare(
    `SELECT COUNT(*) AS c FROM entries WHERE agent_id = ? AND id > ?`
  ).get(agentId, watermark) as { c: number };
  if (newCount.c === 0) return;

  // Get last 20 entries
  const entries = db.prepare(`
    SELECT id, summary, entry_type, tags, created_at
    FROM entries WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(agentId) as { id: number; summary: string | null; entry_type: string | null; tags: string; created_at: number }[];

  if (entries.length === 0) return;

  // Build knowledge brief via LLM
  const entryList = entries
    .reverse()
    .map((e) => `- [${e.entry_type ?? "note"}] ${e.summary ?? "(no summary)"}`)
    .join("\n");

  const prompt = `Summarize what this agent has worked on, discovered, and decided. Write in second person ("You fixed...", "You discovered..."). 3-5 sentences max. Be specific.\n\nRecent entries:\n${entryList}`;
  const brief = await llmCall(prompt);

  // Build expertise from tag frequencies
  const expertise: Record<string, number> = {};
  const allEntries = db.prepare(`SELECT tags FROM entries WHERE agent_id = ?`).all(agentId) as { tags: string }[];
  for (const e of allEntries) {
    const tags: string[] = JSON.parse(e.tags || "[]");
    for (const t of tags) {
      expertise[t] = (expertise[t] ?? 0) + 1;
    }
  }

  // Top scopes from tags (use top 5 by frequency)
  const topScopes = Object.entries(expertise)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const ts = Math.floor(Date.now() / 1000);
  const maxEntryId = Math.max(...entries.map((e) => e.id));

  db.prepare(`
    INSERT INTO agent_memory (agent_id, knowledge_brief, expertise, top_scopes, entry_count, last_entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      knowledge_brief = ?, expertise = ?, top_scopes = ?, entry_count = ?, last_entry_id = ?, updated_at = ?
  `).run(
    agentId, brief || null, JSON.stringify(expertise), JSON.stringify(topScopes), allEntries.length, maxEntryId, ts,
    brief || null, JSON.stringify(expertise), JSON.stringify(topScopes), allEntries.length, maxEntryId, ts,
  );

  console.log(`[synthesis] agent ${agentId}: memory updated (${allEntries.length} entries, ${topScopes.length} scopes)`);
}

// ── Main loop ───────────────────────────────────────────────────────

async function runSynthesis(): Promise<void> {
  const db = openDb();

  try {
    // Get all projects
    const projects = db.prepare(
      `SELECT DISTINCT project FROM agents`
    ).all() as { project: string }[];

    for (const { project } of projects) {
      try {
        await synthesizeProject(db, project);
      } catch (e) {
        console.error(`[synthesis] Error for project ${project}:`, (e as Error).message);
      }
    }

    // Build agent memory for all agents with entries
    const agents = db.prepare(
      `SELECT DISTINCT agent_id FROM entries`
    ).all() as { agent_id: string }[];

    for (const { agent_id } of agents) {
      try {
        await buildAgentMemory(db, agent_id);
      } catch (e) {
        console.error(`[synthesis] Error for agent ${agent_id}:`, (e as Error).message);
      }
    }
  } finally {
    db.close();
  }
}

// ── Entry point ─────────────────────────────────────────────────────

console.log(`[synthesis] Starting synthesis worker (interval: ${INTERVAL_MS / 1000}s, LLM: ${useCLI ? "claude-cli" : "anthropic-sdk"})`);

// Run immediately on start
runSynthesis().catch((e) => console.error("[synthesis] Initial run failed:", e));

// Then every 10 minutes
setInterval(() => {
  runSynthesis().catch((e) => console.error("[synthesis] Run failed:", e));
}, INTERVAL_MS);
