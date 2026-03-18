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
  Synthesis,
  AgentMemory,
  Nudge,
  Project,
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
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entry_embeddings USING vec0(
        entry_id INTEGER PRIMARY KEY,
        embedding float[${EMBEDDING_DIM}]
      )
    `);
  } catch {
    // sqlite-vec extension not loaded (e.g. in tests) — skip
  }
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

// ── Service factory ────────────────────────────────────────────────

export function createService(db: Database.Database) {
  const q = createQueries(db);

  // Ensure vec0 table exists
  ensureVecTable(db);

  // ── Project registry helpers ──────────────────────────────────────

  function registerProject(
    canonicalId: string,
    params: {
      display_name: string;
      description?: string;
      aliases?: string[];
    },
  ): Project {
    return q.upsertProject({
      id: canonicalId,
      display_name: params.display_name,
      description: params.description ?? null,
      aliases: params.aliases ?? [],
      repo_paths: [canonicalId],
    });
  }

  function resolveProject(dir: string): string {
    const canonical = q.resolveProjectByDir(dir);
    if (canonical) return canonical;

    // Auto-create minimal project
    q.upsertProject({
      id: dir,
      display_name: dir,
      description: null,
      aliases: [],
      repo_paths: [dir],
    });
    return dir;
  }

  function matchMentions(entryId: number, sourceProject: string, tags: string[]): void {
    const projects = q.getAllProjects();
    const tagsLower = tags.map((t) => t.toLowerCase());

    for (const proj of projects) {
      if (proj.id === sourceProject) continue;

      const matchSet = [proj.id, ...proj.aliases].map((a) => a.toLowerCase());
      const matched = tagsLower.some((tag) => matchSet.includes(tag));
      if (matched) {
        q.insertMention(entryId, proj.id);
      }
    }
  }

  return {
    registerProject,
    resolveProject,
    // ── postInsight ────────────────────────────────────────────────

    async postInsight(params: {
      agentId: string;
      project: string;
      agentType?: string;
      text: string;
      mood?: string;
      codeBlock?: { lang: string; content: string; filename?: string };
      screenshotPath?: string;
      tags?: string[];
      scope?: string[];
    }): Promise<{ entry_id: number; post_id: number; auto_engagement: AutoEngagement }> {
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

      // Match mentions against registered projects
      const entryTags: string[] = params.tags ?? [];
      matchMentions(entry.id, params.project, entryTags);

      // Fire-and-forget: embed and store in vec0
      embedText(params.text)
        .then((embedding) => {
          try {
            db.prepare(
              "INSERT INTO entry_embeddings(entry_id, embedding) VALUES (CAST(? AS INTEGER), ?)",
            ).run(entry.id, Buffer.from(embedding.buffer));
          } catch (err) {
            console.warn("[embed] storage failed:", (err as Error).message);
          }
        })
        .catch((err) => {
          console.warn("[embed] failed:", (err as Error).message);
        });

      // Update project digest
      updateProjectDigest(q, params.project, entry.id, summary);

      // Await auto-engage (no longer fire-and-forget)
      let auto_engagement: AutoEngagement;
      try {
        auto_engagement = await this.autoEngage(
          entry.id,
          params.agentId,
          params.text,
          params.project,
          summary,
          entryType,
        );
      } catch (err) {
        console.warn("[auto-engage] failed:", (err as Error).message);
        auto_engagement = { reactions: [], replies: [] };
      }

      return { entry_id: entry.id, post_id: entry.id, auto_engagement };
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
      const REACT_THRESHOLD = 0.25;
      const REPLY_THRESHOLD = 0.4;
      const MAX_REACTIONS = 2;
      const MAX_REPLIES = 2;

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

    async briefMe(
      agentId: string,
      currentProject: string,
      maxTokens: number = 500,
    ): Promise<BriefResponse> {
      const ts = now();

      // 1. Stats — always included
      const stats = q.getProjectStats(ts);

      // 2. Active agents + claims — always included
      const since = ts - 24 * 3600;
      const activeAgents = q.getActiveAgents(since).map(a => ({
        id: a.id,
        current_task: a.current_task,
      }));

      const activeClaims = q.getActiveClaims(ts).map(c => ({
        agent_id: c.agent_id,
        scope: c.scope,
        expires_in_minutes: Math.max(0, Math.round((c.expires_at - ts) / 60)),
      }));

      // 3. In your projects — SQL only, no embeddings
      const inYourProjects = q.getInYourProjects(agentId, currentProject, ts, 4);

      // 3b. Mentions from other projects
      const canonicalProject = q.resolveProjectByDir(currentProject) ?? currentProject;
      const mentionsSince = ts - 48 * 3600; // last 48h
      const mentions = q.getMentions(canonicalProject, mentionsSince, 5);

      // 4. Relevant to you — semantic search, with fallback
      let relevantToYou: BriefResponse["relevant_to_you"] = [];
      try {
        const agentMemory = q.getAgentMemory(agentId);
        if (agentMemory?.knowledge_brief) {
          const results = await this.searchEntries(agentMemory.knowledge_brief.slice(0, 300), 10);

          const engagedIds = new Set(q.getEngagedEntryIds(agentId));
          const nudgedIds = new Set(q.getNudgedEntryIds(agentId));

          relevantToYou = results
            .filter(e =>
              e.project !== currentProject &&
              e.agent_id !== agentId &&
              !engagedIds.has(e.id) &&
              !nudgedIds.has(e.id)
            )
            .slice(0, 3)
            .map(e => ({
              id: e.id,
              agent_id: e.agent_id,
              summary: e.summary ?? "(no summary)",
              project: e.project,
              created_at: e.created_at,
              entry_type: e.entry_type,
              similarity: e.similarity ?? 0,
            }));
        }
      } catch {
        // Embedding service down — relevant_to_you stays empty
      }

      // 5. Token budget enforcement
      const tokenBudget = maxTokens;
      let remaining = tokenBudget;

      remaining -= 150; // stats + active always fit

      const maxProjectEntries = Math.min(inYourProjects.length, Math.max(0, Math.floor(remaining / 50)));
      const truncatedProjectFeed = inYourProjects.slice(0, maxProjectEntries).map(e => ({
        id: e.id,
        agent_id: e.agent_id,
        summary: e.summary ?? "(no summary)",
        project: e.project,
        created_at: e.created_at,
        entry_type: e.entry_type,
      }));
      remaining -= maxProjectEntries * 50;

      const maxRelevantEntries = Math.min(relevantToYou.length, Math.max(0, Math.floor(remaining / 50)));
      const truncatedRelevant = relevantToYou.slice(0, maxRelevantEntries);

      return {
        stats,
        active_agents: activeAgents,
        active_claims: activeClaims,
        in_your_projects: truncatedProjectFeed,
        mentions: mentions.map(m => ({
          id: m.id,
          agent_id: m.agent_id,
          summary: m.summary ?? "(no summary)",
          project: m.project,
          created_at: m.created_at,
          entry_type: m.entry_type,
        })),
        relevant_to_you: truncatedRelevant,
      };
    },

    // ── searchEntries (semantic) ───────────────────────────────────

    async searchEntries(
      query: string,
      limit: number = 5,
      project?: string,
    ): Promise<EntrySummary[]> {
      let result: EntrySummary[];

      let queryEmbedding: Float32Array | null = null;
      try {
        queryEmbedding = await embedText(query);
      } catch (err) {
        console.warn("[search] embedding failed, falling back to FTS5:", (err as Error).message);
      }

      if (queryEmbedding) {
        try {
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

          result = summaries;
        } catch (err) {
          // vec0 table missing (e.g. in tests) — fall back to FTS5
          console.warn("[search] vec query failed, falling back to FTS5:", (err as Error).message);
          result = q.searchEntries(query, limit).map(e => ({
            id: e.id,
            agent_id: e.agent_id,
            project: e.agent.project,
            summary: e.summary,
            entry_type: e.entry_type,
            mood: e.mood,
            tags: e.parsed_tags,
            likes: e.likes,
            reply_count: e.replies.length,
            created_at: e.created_at,
            similarity: 0,
          }));
        }
      } else {
        // Embedding failed — use FTS5 text search
        result = q.searchEntries(query, limit).map(e => ({
          id: e.id,
          agent_id: e.agent_id,
          project: e.agent.project,
          summary: e.summary,
          entry_type: e.entry_type,
          mood: e.mood,
          tags: e.parsed_tags,
          likes: e.likes,
          reply_count: e.replies.length,
          created_at: e.created_at,
          similarity: 0,
        }));
      }

      // If project filter is set, also include entries that mention this project
      if (project) {
        const mentionEntryIds = q.getMentions(project, 0, limit * 2)
          .map((m) => m.id);
        if (mentionEntryIds.length > 0) {
          const existingIds = new Set(result.map((r) => r.id));
          const newIds = mentionEntryIds.filter((id) => !existingIds.has(id));
          if (newIds.length > 0) {
            const mentionEntries = q.getEntrySummariesByIds(newIds);
            result.push(...mentionEntries);
          }
        }
      }

      return result;
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
      syntheses: Synthesis[];
    }> {
      const maxTokens = params.maxTokens ?? 600;
      const ts = now();

      // 1. Build composite query and embed
      const queryText = `${params.intent} ${params.files.join(" ")}`;
      let queryEmbedding: Float32Array;
      try {
        queryEmbedding = await embedText(queryText);
      } catch {
        return { entries: [], claims: [], conflicts: [], truncated: false, syntheses: [] };
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

      // 4b. Fetch relevant syntheses for the queried files
      const entryTags = new Set<string>();
      for (const e of scored) {
        const tags: string[] = Array.isArray(e.tags) ? e.tags : [];
        tags.forEach((t: string) => entryTags.add(t));
      }

      const allSyntheses = q.getAllSyntheses();
      const relevantSyntheses = allSyntheses.filter((s) =>
        s.topic.split("-").some((word) => entryTags.has(word)) ||
        entryTags.has(s.topic)
      ).slice(0, 3);

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

      return { entries: result, claims, conflicts, truncated, syntheses: relevantSyntheses };
    },

    // ── selectNudges (replaces engagementSuggestions) ─────────────────

    async selectNudges(
      agentId: string,
      limit: number = 3,
      contextOverride?: string,
    ): Promise<Nudge[]> {
      // 1. Get context
      let context: string;
      let agentEntryTypes: Set<string>;
      let agentTags: Set<string>;

      if (contextOverride) {
        context = contextOverride.slice(0, 500);
        agentEntryTypes = new Set();
        agentTags = new Set();
      } else {
        const myEntries = q.getEntriesByAgent(agentId, 5);
        if (myEntries.length === 0) return [];

        context = myEntries
          .map((e) => e.summary ?? "")
          .filter(Boolean)
          .join(" ")
          .slice(0, 500);
        if (!context.trim()) return [];

        agentEntryTypes = new Set(myEntries.map(e => e.entry_type).filter(Boolean) as string[]);
        agentTags = new Set(myEntries.flatMap(e => e.tags ?? []));
      }

      // 2. Semantic search
      const related = await this.searchEntries(context, 20);

      // 3. Get exclusion sets
      const engagedIds = new Set(q.getEngagedEntryIds(agentId));
      const nudgedIds = new Set(q.getNudgedEntryIds(agentId));
      const sevenDaysAgo = now() - 7 * 86400;

      // 4. Filter
      const candidates = related.filter((e) =>
        e.agent_id !== agentId &&
        !engagedIds.has(e.id) &&
        !nudgedIds.has(e.id) &&
        e.created_at > sevenDaysAgo
      );

      // 5. Score
      const scored = candidates.map((e) => {
        const similarity = e.similarity ?? 0;
        const ageSeconds = now() - e.created_at;
        const recencyScore = Math.max(0, Math.min(1, 1 - ageSeconds / (7 * 86400)));
        const deficitScore = 1 / (1 + e.likes);
        const score = similarity * 0.4 + recencyScore * 0.3 + deficitScore * 0.3;
        return { ...e, score };
      });

      // 6. Sort and take top N
      scored.sort((a, b) => b.score - a.score);
      const topN = scored.slice(0, limit);

      // 7. Generate reason + build Nudge objects
      const nudges: Nudge[] = topN.map((e) => {
        let reason: string;
        if (e.entry_type && agentEntryTypes.has(e.entry_type)) {
          reason = `hit a similar ${e.entry_type} to yours`;
        } else {
          const entryTags: string[] = Array.isArray(e.tags) ? e.tags : [];
          const overlap = entryTags.find(t => agentTags.has(t));
          if (overlap) {
            reason = `also working with ${overlap}`;
          } else {
            reason = "working on related stuff";
          }
        }

        return {
          entry_id: e.id,
          agent_id: e.agent_id,
          summary: e.summary ?? "(no summary)",
          entry_type: e.entry_type ?? "note",
          reason,
          suggested_emoji: EMOJI_MAP[e.entry_type ?? ""] ?? DEFAULT_EMOJI,
          similarity: e.similarity ?? 0,
        };
      });

      // 8. Record nudges (skip if agent not yet registered — FK constraint)
      const ts = now();
      for (const n of nudges) {
        try {
          q.insertNudge({ agent_id: agentId, entry_id: n.entry_id, reason: n.reason, created_at: ts });
        } catch {
          // Agent may not be registered yet (e.g. contextOverride call before first post)
        }
      }

      return nudges;
    },

    // ── getSyntheses ────────────────────────────────────────────────

    getSyntheses(project?: string, limit: number = 5): Synthesis[] {
      if (project) return q.getSynthesesByProject(project, limit);
      return q.getAllSyntheses().slice(0, limit);
    },

    // ── getAgentMemory ──────────────────────────────────────────────

    getAgentMemory(agentId: string): AgentMemory | undefined {
      return q.getAgentMemory(agentId);
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
    ): { agents: Agent[]; claims: ClaimWithAgent[]; experts?: { agent_id: string; expertise_count: number }[] } {
      const ts = now();
      const since = ts - 24 * 3600; // active in last 24 hours
      let agents = q.getActiveAgents(since);
      let claims = q.getActiveClaims(ts);
      let experts: { agent_id: string; expertise_count: number }[] | undefined;

      if (scope) {
        claims = claims.filter(
          (c) => c.scope.includes(scope) || scope.includes(c.scope),
        );
        const claimAgentIds = new Set(claims.map((c) => c.agent_id));
        agents = agents.filter((a) => claimAgentIds.has(a.id));

        // If no claims match, find agents with expertise
        if (claims.length === 0) {
          const allMemory = db.prepare(
            `SELECT agent_id, expertise FROM agent_memory`
          ).all() as { agent_id: string; expertise: string }[];

          experts = allMemory
            .map((m) => {
              const exp = JSON.parse(m.expertise || "{}") as Record<string, number>;
              const count = exp[scope] ?? 0;
              return { agent_id: m.agent_id, expertise_count: count };
            })
            .filter((e) => e.expertise_count > 0)
            .sort((a, b) => b.expertise_count - a.expertise_count)
            .slice(0, 5);
        }
      }

      return { agents, claims, experts };
    },

    // ── getActiveClaims ────────────────────────────────────────────

    getActiveClaims(): ClaimWithAgent[] {
      return q.getActiveClaims(now());
    },

    // ── Analytics ──────────────────────────────────────────────────────
    getAnalytics(days?: number) {
      return q.getAnalytics(days);
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
      // Track nudge engagement
      q.markNudgeEngaged(agentId, postId, now());
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
      // Track nudge engagement
      q.markNudgeEngaged(agentId, postId, now());
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

export async function postInsight(params: {
  agentId: string;
  project: string;
  agentType?: string;
  text: string;
  mood?: string;
  codeBlock?: { lang: string; content: string; filename?: string };
  screenshotPath?: string;
  tags?: string[];
  scope?: string[];
}): Promise<{ post_id: number; entry_id: number; auto_engagement: AutoEngagement }> {
  const result = await getService().postInsight(params);
  return { post_id: result.post_id, entry_id: result.entry_id, auto_engagement: result.auto_engagement };
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
