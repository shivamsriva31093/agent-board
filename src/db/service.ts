import crypto from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/db/connection";
import { createQueries, type Queries } from "@/db/queries";
import { extractSummary, classifyEntryType } from "@/lib/text-processing";
import { embedText, EMBEDDING_DIM } from "@/lib/embeddings";
import type {
  Agent,
  EntryWithDetails,
  EntrySummary,
  StoryWithAgent,
  ClaimWithAgent,
  BriefResponse,
} from "@/lib/types";

// ── Helpers ────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Ensures the vec0 virtual table exists for semantic search.
 * Must be called after sqlite-vec extension is loaded.
 */
function ensureVecTable(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entry_embeddings USING vec0(
      entry_id INTEGER PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    )
  `);
}

/**
 * Auto-registers an agent on first interaction.
 * avatar_seed = md5(agentId).slice(0, 8)
 */
function ensureAgent(
  q: Queries,
  agentId: string,
  project: string,
  agentType?: string,
): void {
  const avatarSeed = crypto
    .createHash("md5")
    .update(agentId)
    .digest("hex")
    .slice(0, 8);
  const ts = now();
  q.upsertAgent({
    id: agentId,
    project,
    agent_type: agentType ?? null,
    avatar_seed: avatarSeed,
    first_seen: ts,
    last_seen: ts,
  });
}

/**
 * Updates the project digest with a new summary.
 * Increments entry_count and updates the summary text.
 */
function updateProjectDigest(
  q: Queries,
  project: string,
  entryId: number,
  summary: string,
): void {
  const existing = q.getDigest(project, "project");
  const entryCount = (existing?.entry_count ?? 0) + 1;

  // Build a rolling summary: keep the last summary and append the new one
  const prevSummary = existing?.summary ?? "";
  const newSummary = prevSummary
    ? `${prevSummary}\n- ${summary}`
    : `- ${summary}`;

  // Truncate to keep digest manageable (last ~2000 chars)
  const maxLen = 2000;
  const truncated =
    newSummary.length > maxLen
      ? "..." + newSummary.slice(newSummary.length - maxLen + 3)
      : newSummary;

  q.upsertDigest({
    scope: project,
    scope_type: "project",
    summary: truncated,
    entry_count: entryCount,
    last_entry_id: entryId,
    updated_at: now(),
  });
}

// ── Service factory ────────────────────────────────────────────────

export function createService(db: Database.Database) {
  const q = createQueries(db);

  // Ensure vec0 table exists
  ensureVecTable(db);

  return {
    // ── postInsight ────────────────────────────────────────────────

    postInsight(params: {
      agentId: string;
      project: string;
      agentType?: string;
      text: string;
      mood?: string;
      codeBlock?: { lang: string; content: string; filename?: string };
      screenshotPath?: string;
      tags?: string[];
      scope?: string[];
    }): { entry_id: number; post_id: number } {
      ensureAgent(q, params.agentId, params.project, params.agentType);

      const summary = extractSummary(params.text);
      const entryType = classifyEntryType(params.text);

      const entry = q.insertEntry({
        agent_id: params.agentId,
        text: params.text,
        summary,
        entry_type: entryType,
        scope: params.scope ? JSON.stringify(params.scope) : null,
        mood: params.mood ?? null,
        code_block: params.codeBlock
          ? JSON.stringify(params.codeBlock)
          : null,
        screenshot: params.screenshotPath ?? null,
        tags: params.tags ? JSON.stringify(params.tags) : null,
        created_at: now(),
      });

      // Fire-and-forget: embed and store in vec0
      embedText(params.text)
        .then((embedding) => {
          try {
            db.prepare(
              "INSERT INTO entry_embeddings(entry_id, embedding) VALUES (?, ?)",
            ).run(entry.id, Buffer.from(embedding.buffer));
          } catch {
            // Don't fail if embedding storage fails
          }
        })
        .catch(() => {
          // Don't fail if embedding fails
        });

      // Update project digest
      updateProjectDigest(q, params.project, entry.id, summary);

      return { entry_id: entry.id, post_id: entry.id };
    },

    // ── postStory ──────────────────────────────────────────────────

    postStory(
      agentId: string,
      project: string,
      mood?: string | null,
      text?: string | null,
    ): { story_id: number } {
      ensureAgent(q, agentId, project);
      const ts = now();
      const story = q.insertStory({
        agent_id: agentId,
        mood: mood ?? null,
        text: text ?? null,
        created_at: ts,
        expires_at: ts + 86400,
      });
      return { story_id: story.id };
    },

    // ── getActiveStories ───────────────────────────────────────────

    getActiveStories(): StoryWithAgent[] {
      return q.getActiveStories(now());
    },

    // ── getEntryWithDetails ────────────────────────────────────────

    getEntryWithDetails(id: number): EntryWithDetails | null {
      return q.getEntry(id) ?? null;
    },

    // ── getFeed ────────────────────────────────────────────────────

    getFeed(
      limit: number = 20,
      tag?: string,
      project?: string,
      before?: number,
    ): EntryWithDetails[] {
      if (tag) return q.getFeedByTag(tag, limit, before);
      if (project) return q.getFeedByProject(project, limit, before);
      return q.getFeed(limit, before);
    },

    // ── briefMe ────────────────────────────────────────────────────

    briefMe(project?: string, sinceHours?: number): BriefResponse {
      const ts = now();
      const sinceSeconds = (sinceHours ?? 24) * 3600;
      const since = ts - sinceSeconds;

      // Clean up expired claims while we're here
      // (pragmatic -- no separate cron)

      // 1. Get project digests
      const digests = project
        ? [q.getDigest(project, "project")].filter(
            (d): d is NonNullable<typeof d> => d != null,
          )
        : q
            .getAllDigests()
            .filter((d) => d.scope_type === "project");

      // 2. Get active agents (active since `since`)
      const activeAgents = q.getActiveAgents(since);

      // 3. Get active claims
      const activeClaims = q.getActiveClaims(ts);

      // 4. Get stale agents (active > 2 hours ago)
      const staleAgents = q.getStaleAgents(ts, 7200);

      return {
        digests: digests.map((d) => ({
          project: d.scope,
          summary: d.summary,
          entry_count: d.entry_count,
        })),
        active_agents: activeAgents.map((a) => ({
          id: a.id,
          project: a.project,
          current_task: a.current_task,
          status_updated_at: a.status_updated_at,
        })),
        active_claims: activeClaims.map((c) => ({
          agent_id: c.agent_id,
          scope: c.scope,
          scope_type: c.scope_type,
          expires_in_minutes: Math.max(
            0,
            Math.round((c.expires_at - ts) / 60),
          ),
        })),
        stale_agents: staleAgents.map((a) => ({
          id: a.id,
          project: a.project,
          last_seen_hours_ago: Math.round(
            (ts - (a.status_updated_at ?? a.last_seen)) / 3600,
          ),
        })),
      };
    },

    // ── searchEntries (semantic) ───────────────────────────────────

    async searchEntries(
      query: string,
      limit: number = 5,
      project?: string,
    ): Promise<EntrySummary[]> {
      let queryEmbedding: Float32Array;
      try {
        queryEmbedding = await embedText(query);
      } catch {
        // If embedding fails, fall back to empty results
        return [];
      }

      // Search sqlite-vec for similar entries
      const rows = db
        .prepare(
          `SELECT entry_id, distance
           FROM entry_embeddings
           WHERE embedding MATCH ? AND k = ?
           ORDER BY distance`,
        )
        .all(Buffer.from(queryEmbedding.buffer), limit * 2) as {
        entry_id: number;
        distance: number;
      }[];

      // Fetch entry summaries and optionally filter by project
      const summaries: EntrySummary[] = [];
      for (const row of rows) {
        if (summaries.length >= limit) break;

        const entry = q.getEntry(row.entry_id);
        if (!entry) continue;
        if (project && entry.agent.project !== project) continue;

        summaries.push({
          id: entry.id,
          agent_id: entry.agent_id,
          project: entry.agent.project,
          summary: entry.summary,
          entry_type: entry.entry_type,
          mood: entry.mood,
          tags: entry.parsed_tags,
          likes: entry.likes,
          reply_count: entry.replies.length,
          created_at: entry.created_at,
          similarity: 1 - row.distance,
        });
      }

      return summaries;
    },

    // ── createClaim ────────────────────────────────────────────────

    createClaim(
      agentId: string,
      project: string,
      scope: string,
      scopeType: string = "area",
      ttlMinutes: number = 60,
    ): { claim_id: number; conflicts: ClaimWithAgent[] } {
      ensureAgent(q, agentId, project);
      const ts = now();

      // Check for conflicts BEFORE inserting
      const conflicts = q.getClaimsByScope(scope, ts);

      // Insert the claim regardless (soft lock -- inform, don't block)
      const claim = q.insertClaim({
        agent_id: agentId,
        scope,
        scope_type: scopeType,
        claimed_at: ts,
        expires_at: ts + ttlMinutes * 60,
        status: "active",
      });

      return {
        claim_id: claim.id,
        conflicts: conflicts.filter((c) => c.agent_id !== agentId),
      };
    },

    // ── releaseClaim ───────────────────────────────────────────────

    releaseClaim(claimId: number): void {
      q.releaseClaim(claimId);
    },

    // ── broadcastStatus ────────────────────────────────────────────

    broadcastStatus(
      agentId: string,
      project: string,
      status: string,
      currentTask?: string,
    ): void {
      ensureAgent(q, agentId, project);
      q.updateAgentStatus(
        agentId,
        status,
        currentTask ?? null,
        now(),
      );
    },

    // ── whoIsWorkingOn ─────────────────────────────────────────────

    whoIsWorkingOn(
      scope?: string,
    ): { agents: Agent[]; claims: ClaimWithAgent[] } {
      const ts = now();
      const since = ts - 24 * 3600; // active in last 24 hours
      let agents = q.getActiveAgents(since);
      let claims = q.getActiveClaims(ts);

      if (scope) {
        claims = claims.filter(
          (c) => c.scope.includes(scope) || scope.includes(c.scope),
        );
        const claimAgentIds = new Set(claims.map((c) => c.agent_id));
        agents = agents.filter((a) => claimAgentIds.has(a.id));
      }

      return { agents, claims };
    },

    // ── getActiveClaims ────────────────────────────────────────────

    getActiveClaims(): ClaimWithAgent[] {
      return q.getActiveClaims(now());
    },

    // ── Backward compat functions ──────────────────────────────────

    getTotalPostCount(): number {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM entries")
        .get() as { count: number };
      return row.count;
    },

    getAgent(agentId: string): Agent | undefined {
      return q.getAgent(agentId);
    },

    replyToPost(
      postId: number,
      agentId: string,
      project: string,
      text: string,
    ): { reply_id: number } {
      ensureAgent(q, agentId, project);
      const reply = q.insertReply({
        post_id: postId,
        agent_id: agentId,
        text,
        created_at: now(),
      });
      return { reply_id: reply.id };
    },

    reactToPost(
      postId: number,
      agentId: string,
      project: string,
      emoji: string = "\u2665",
    ): { ok: true } {
      ensureAgent(q, agentId, project);
      const reaction = q.insertReaction({
        post_id: postId,
        agent_id: agentId,
        emoji,
      });
      if (reaction) {
        q.incrementLikes(postId);
      }
      return { ok: true };
    },

    getFeedAfter(after: number, limit: number = 50): EntryWithDetails[] {
      // Entries newer than a timestamp (for polling)
      const rows = db
        .prepare(
          `SELECT e.id FROM entries e
           WHERE e.created_at > ?
           ORDER BY e.created_at DESC
           LIMIT ?`,
        )
        .all(after, limit) as { id: number }[];

      return rows
        .map((r) => q.getEntry(r.id))
        .filter((e): e is EntryWithDetails => e != null);
    },

    searchPosts(
      query: string,
      limit: number = 20,
      before?: number,
    ): EntryWithDetails[] {
      return q.searchEntries(query, limit, before);
    },

    getPostsByIds(ids: number[]): EntryWithDetails[] {
      return ids
        .map((id) => q.getEntry(id))
        .filter((e): e is EntryWithDetails => e != null);
    },
  };
}

// ── Singleton for API routes ───────────────────────────────────────

let svc: ReturnType<typeof createService> | null = null;
export function getService() {
  if (!svc) svc = createService(getDb());
  return svc;
}

// ── Re-export standalone functions for backward compat ─────────────
// Existing API routes and frontend pages import bare functions.
// These delegate to the singleton service.

export function postStory(
  agentId: string,
  project: string,
  mood?: string | null,
  text?: string | null,
): { story_id: number } {
  return getService().postStory(agentId, project, mood, text);
}

export function getActiveStories(): StoryWithAgent[] {
  return getService().getActiveStories();
}

export function postInsight(params: {
  agentId: string;
  project: string;
  agentType?: string;
  text: string;
  mood?: string;
  codeBlock?: { lang: string; content: string; filename?: string };
  screenshotPath?: string;
  tags?: string[];
  scope?: string[];
}): { post_id: number } {
  const { post_id } = getService().postInsight(params);
  return { post_id };
}

export function getFeed(
  limit: number = 20,
  tag?: string,
  project?: string,
  before?: number,
): EntryWithDetails[] {
  return getService().getFeed(limit, tag, project, before);
}

export function getPostWithDetails(postId: number): EntryWithDetails | null {
  return getService().getEntryWithDetails(postId);
}

export function replyToPost(
  postId: number,
  agentId: string,
  project: string,
  text: string,
): { reply_id: number } {
  return getService().replyToPost(postId, agentId, project, text);
}

export function reactToPost(
  postId: number,
  agentId: string,
  project: string,
  emoji: string = "\u2665",
): { ok: true } {
  return getService().reactToPost(postId, agentId, project, emoji);
}

export function getFeedAfter(
  after: number,
  limit: number = 50,
): EntryWithDetails[] {
  return getService().getFeedAfter(after, limit);
}

export function searchPosts(
  query: string,
  limit: number = 20,
  before?: number,
): EntryWithDetails[] {
  return getService().searchPosts(query, limit, before);
}

export function getPostsByIds(ids: number[]): EntryWithDetails[] {
  return getService().getPostsByIds(ids);
}

export function getTotalPostCount(): number {
  return getService().getTotalPostCount();
}

export function getAgent(agentId: string): Agent | undefined {
  return getService().getAgent(agentId);
}
