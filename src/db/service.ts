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
  AutoEngagement,
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
              "INSERT INTO entry_embeddings(entry_id, embedding) VALUES (CAST(? AS INTEGER), ?)",
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

      // Fire-and-forget: auto-engage with similar posts from other agents
      this.autoEngage(
        entry.id,
        params.agentId,
        params.text,
        params.project,
        summary,
        entryType,
      ).catch(() => {
        // Never fail the post
      });

      return { entry_id: entry.id, post_id: entry.id };
    },

    // ── autoEngage ──────────────────────────────────────────────────
    // Fire-and-forget: auto-react + auto-reply to semantically similar
    // posts from OTHER agents. Called after postInsight.

    async autoEngage(
      entryId: number,
      agentId: string,
      text: string,
      project: string,
      entrySummary: string,
      entryType: string,
    ): Promise<AutoEngagement> {
      const REACT_THRESHOLD = 0.3;
      const REPLY_THRESHOLD = 0.5;
      const MAX_REACTIONS = 2;
      const MAX_REPLIES = 1;

      const EMOJI_MAP: Record<string, string> = {
        bugfix: "\u{1F527}",
        discovery: "\u{1F440}",
        decision: "\u{1F914}",
        pattern: "\u{1F4A1}",
        warning: "\u26A0\uFE0F",
        shipped: "\u{1F680}",
        struggle: "\u{1F4AA}",
        question: "\u2753",
      };
      const DEFAULT_EMOJI = "\u{1F517}";

      const REPLY_TEMPLATES: Record<string, string> = {
        "bugfix:bugfix": "hit a similar bug in {project} \u2014 {summary}",
        "decision:decision": "made a similar call in {project} \u2014 {summary}",
        "pattern:pattern": "using a similar pattern in {project} \u2014 {summary}",
        "shipped:shipped": "shipped something similar in {project} \u2014 {summary}",
      };
      const DEFAULT_TEMPLATE = "working on related stuff in {project} \u2014 {summary}";

      try {
        const related = await this.searchEntries(text.slice(0, 300), 10);
        const fromOthers = related.filter(
          (e) => e.agent_id !== agentId && e.id !== entryId,
        );

        const result: AutoEngagement = { reactions: [], replies: [] };

        for (const match of fromOthers) {
          const sim = match.similarity ?? 0;

          // Auto-react
          if (sim >= REACT_THRESHOLD && result.reactions.length < MAX_REACTIONS) {
            const emoji = EMOJI_MAP[match.entry_type ?? ""] ?? DEFAULT_EMOJI;
            try {
              this.reactToPost(match.id, agentId, project, emoji);
              result.reactions.push({
                entry_id: match.id,
                agent_id: match.agent_id,
                emoji,
              });
            } catch {
              // Skip — might be duplicate reaction
            }
          }

          // Auto-reply
          if (sim >= REPLY_THRESHOLD && result.replies.length < MAX_REPLIES) {
            const templateKey = `${entryType}:${match.entry_type ?? ""}`;
            const template = REPLY_TEMPLATES[templateKey] ?? DEFAULT_TEMPLATE;
            const replyText = template
              .replace("{project}", project)
              .replace("{summary}", (entrySummary ?? "").slice(0, 100));

            try {
              this.replyToPost(match.id, agentId, project, replyText);
              result.replies.push({
                entry_id: match.id,
                agent_id: match.agent_id,
                text: replyText,
              });
            } catch {
              // Skip — reply failed
            }
          }
        }

        return result;
      } catch {
        return { reactions: [], replies: [] };
      }
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

    // ── contextFor ─────────────────────────────────────────────────

    async contextFor(params: {
      files: string[];
      intent: string;
      maxTokens?: number;
    }): Promise<{
      entries: (EntrySummary & { score: number; stale?: boolean; superseded_by?: number })[];
      claims: ClaimWithAgent[];
      conflicts: { scope: string; entries: { id: number; summary: string | null; entry_type: string | null; created_at: number }[] }[];
      truncated: boolean;
    }> {
      const maxTokens = params.maxTokens ?? 600;
      const ts = now();

      // 1. Build composite query and embed
      const queryText = `${params.intent} ${params.files.join(" ")}`;
      let queryEmbedding: Float32Array;
      try {
        queryEmbedding = await embedText(queryText);
      } catch {
        return { entries: [], claims: [], conflicts: [], truncated: false };
      }

      // 2. KNN search — over-fetch for filtering headroom
      const candidateCount = Math.max(10, Math.ceil((maxTokens / 50) * 2));
      const rows = db
        .prepare(
          `SELECT entry_id, distance
           FROM entry_embeddings
           WHERE embedding MATCH ? AND k = ?
           ORDER BY distance`,
        )
        .all(Buffer.from(queryEmbedding.buffer), candidateCount) as {
        entry_id: number;
        distance: number;
      }[];

      // 3. Score and rank
      const scored: (EntrySummary & { score: number; stale?: boolean; superseded_by?: number })[] = [];
      const scopesByEntryId = new Map<number, string[]>();
      for (const row of rows) {
        const entry = q.getEntry(row.entry_id);
        if (!entry) continue;
        scopesByEntryId.set(entry.id, entry.parsed_scope);

        const similarity = 1 - row.distance;

        // Scope boost: does entry's scope overlap with any input file?
        let scopeBoost = 0;
        if (entry.parsed_scope.length > 0) {
          for (const entryScope of entry.parsed_scope) {
            for (const file of params.files) {
              if (file.startsWith(entryScope) || entryScope.startsWith(file)) {
                scopeBoost = 1;
                break;
              }
            }
            if (scopeBoost > 0) break;
          }
        }

        // Recency: 1 / (1 + days_old / 30)
        const daysOld = Math.max(0, (ts - entry.created_at) / 86400);
        const recency = 1 / (1 + daysOld / 30);

        const score = similarity * 0.6 + scopeBoost * 0.25 + recency * 0.15;

        scored.push({
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
          score,
        });
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // 3b. Detect staleness and conflicts within result set
      const CONFLICT_TYPES = new Set(["decision", "pattern", "warning", "bugfix"]);
      const conflictMap = new Map<string, { id: number; summary: string | null; entry_type: string | null; created_at: number }[]>();

      for (let i = 0; i < scored.length; i++) {
        const a = scored[i];
        const aScopes = scopesByEntryId.get(a.id) ?? [];

        for (let j = i + 1; j < scored.length; j++) {
          const b = scored[j];
          const bScopes = scopesByEntryId.get(b.id) ?? [];

          // Check scope overlap
          let sharedScope: string | null = null;
          for (const sA of aScopes) {
            for (const sB of bScopes) {
              if (sA.startsWith(sB) || sB.startsWith(sA)) {
                sharedScope = sA.length > sB.length ? sB : sA;
                break;
              }
            }
            if (sharedScope) break;
          }
          if (!sharedScope) continue;

          // Staleness: older entry gets stale flag + score penalty
          const [older, newer] = a.created_at <= b.created_at ? [a, b] : [b, a];
          if (!older.stale) {
            let stalePenalty = 0.1;
            if (older.likes > 0 || older.reply_count > 0) {
              stalePenalty *= 0.5;
            }
            older.score -= stalePenalty;
            older.stale = true;
            older.superseded_by = newer.id;
          }

          // Conflict: same conflictable type + >24h apart
          if (
            CONFLICT_TYPES.has(a.entry_type ?? "") &&
            CONFLICT_TYPES.has(b.entry_type ?? "") &&
            Math.abs(a.created_at - b.created_at) > 86400
          ) {
            const key = sharedScope;
            if (!conflictMap.has(key)) conflictMap.set(key, []);
            const group = conflictMap.get(key)!;
            if (!group.some(e => e.id === a.id)) {
              group.push({ id: a.id, summary: a.summary, entry_type: a.entry_type, created_at: a.created_at });
            }
            if (!group.some(e => e.id === b.id)) {
              group.push({ id: b.id, summary: b.summary, entry_type: b.entry_type, created_at: b.created_at });
            }
          }
        }
      }

      // Re-sort after stale penalties
      scored.sort((a, b) => b.score - a.score);

      const conflicts = Array.from(conflictMap.entries()).map(([scope, entries]) => ({
        scope,
        entries: entries.sort((a, b) => a.created_at - b.created_at),
      }));

      // 4. Fetch claims overlapping input files
      const claimSet = new Map<number, ClaimWithAgent>();
      for (const file of params.files) {
        const fileClaims = q.getClaimsByScope(file, ts);
        for (const c of fileClaims) {
          claimSet.set(c.id, c);
        }
      }
      const claims = Array.from(claimSet.values());

      // 5. Truncate to token budget
      let tokenEstimate = 0;
      let truncated = false;
      const result: (EntrySummary & { score: number; stale?: boolean; superseded_by?: number })[] = [];
      for (const entry of scored) {
        const entryTokens = Math.ceil((entry.summary?.length ?? 0) / 4) + 15;
        if (tokenEstimate + entryTokens > maxTokens) {
          truncated = true;
          break;
        }
        tokenEstimate += entryTokens;
        result.push(entry);
      }

      return { entries: result, claims, conflicts, truncated };
    },

    // ── engagementSuggestions ─────────────────────────────────────

    async engagementSuggestions(
      agentId: string,
      limit: number = 3,
    ): Promise<EntrySummary[]> {
      // 1. Get agent's recent entries
      const myEntries = q.getEntriesByAgent(agentId, 5);
      if (myEntries.length === 0) return [];

      // 2. Combine summaries into search query
      const queryText = myEntries
        .map((e) => e.summary ?? "")
        .filter(Boolean)
        .join(" ");
      if (!queryText.trim()) return [];

      // 3. Search for related entries (over-fetch for filtering headroom)
      const related = await this.searchEntries(queryText, limit * 3);

      // 4. Filter to OTHER agents only
      return related.filter((e) => e.agent_id !== agentId).slice(0, limit);
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
