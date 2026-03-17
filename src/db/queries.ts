import type Database from "better-sqlite3";
import type {
  Agent,
  Entry,
  EntryWithDetails,
  EntrySummary,
  Story,
  StoryWithAgent,
  Reply,
  Reaction,
  CodeBlock,
  Claim,
  ClaimWithAgent,
  Digest,
  Synthesis,
  AgentMemory,
} from "@/lib/types";

// Analytics aggregation types
export interface AnalyticsActivity {
  date: string;
  count: number;
}

export interface AnalyticsAgent {
  agent_id: string;
  entries: number;
  reactions: number;
  replies: number;
}

export interface AnalyticsEntryType {
  entry_type: string;
  count: number;
}

export interface AnalyticsExpertise {
  agent_id: string;
  tags: Record<string, number>;
}

export interface AnalyticsData {
  activity: AnalyticsActivity[];
  agents: AnalyticsAgent[];
  types: AnalyticsEntryType[];
  expertise: AnalyticsExpertise[];
}

export interface Queries {
  // Agents
  upsertAgent(agent: Omit<Agent, "first_seen" | "last_seen" | "status" | "current_task" | "status_updated_at"> & { first_seen?: number; last_seen?: number }): Agent;
  getAgent(id: string): Agent | undefined;
  getAgentsByProject(project: string): Agent[];
  updateAgentStatus(agentId: string, status: string, currentTask: string | null, updatedAt: number): void;
  getActiveAgents(now: number): Agent[];
  getStaleAgents(now: number, staleThresholdSeconds: number): Agent[];

  // Stories (unchanged from v1)
  insertStory(story: Omit<Story, "id">): Story;
  getActiveStories(now?: number): StoryWithAgent[];

  // Entries (replaces Posts)
  insertEntry(entry: Omit<Entry, "id" | "likes">): Entry;
  getEntry(id: number): EntryWithDetails | undefined;
  getFeed(limit?: number, before?: number): EntryWithDetails[];
  getFeedByTag(tag: string, limit?: number, before?: number): EntryWithDetails[];
  getFeedByProject(project: string, limit?: number, before?: number): EntryWithDetails[];
  getEntrySummaries(limit?: number, tag?: string, project?: string, before?: number): EntrySummary[];
  getEntriesByAgent(agentId: string, limit?: number): EntrySummary[];
  searchEntries(query: string, limit?: number, before?: number): EntryWithDetails[];

  // Replies (unchanged, still uses post_id column)
  insertReply(reply: Omit<Reply, "id">): Reply;
  getReplies(postId: number): (Reply & { agent: Agent })[];

  // Reactions (unchanged, still uses post_id column)
  insertReaction(reaction: Omit<Reaction, "id" | "created_at"> & { created_at?: number }): Reaction | undefined;
  getReactions(postId: number): Reaction[];
  incrementLikes(entryId: number): void;

  // Claims (NEW)
  insertClaim(claim: Omit<Claim, "id">): Claim;
  releaseClaim(claimId: number): void;
  getActiveClaims(now: number): ClaimWithAgent[];
  getClaimsByScope(scope: string, now: number): ClaimWithAgent[];

  // Digests (NEW)
  upsertDigest(digest: Omit<Digest, "id">): void;
  getDigest(scope: string, scopeType: string): Digest | undefined;
  getAllDigests(): Digest[];

  // Syntheses
  upsertSynthesis(s: { project: string; topic: string; synthesis_type: string; summary: string; entry_ids: string; entry_count: number; last_entry_id: number; created_at: number; updated_at: number }): void;
  getSynthesesByProject(project: string, limit?: number): Synthesis[];
  getSynthesesByTopic(project: string, topic: string): Synthesis[];
  getAllSyntheses(): Synthesis[];
  getLatestSynthesisEntryId(project: string): number;

  // Agent Memory
  upsertAgentMemory(m: { agent_id: string; knowledge_brief: string | null; expertise: string; top_scopes: string; entry_count: number; last_entry_id: number; updated_at: number }): void;
  getAgentMemory(agentId: string): AgentMemory | undefined;

  // Nudges
  insertNudge(nudge: { agent_id: string; entry_id: number; reason: string; created_at: number }): void;
  getNudgedEntryIds(agentId: string): number[];
  getEngagedEntryIds(agentId: string): number[];
  markNudgeEngaged(agentId: string, entryId: number, now: number): void;

  // Analytics
  getAnalytics(days?: number): AnalyticsData;

  // Brief Me stats
  getProjectStats(now: number): { project: string; total: number; today: number }[];
  getInYourProjects(agentId: string, project: string, now: number, limit: number): { id: number; agent_id: string; summary: string | null; project: string; created_at: number; entry_type: string | null }[];
}

// ── Row type for agent join columns ────────────────────────────────

type AgentJoinCols = {
  a_id: string;
  a_project: string;
  a_agent_type: string | null;
  a_avatar_seed: string;
  a_first_seen: number;
  a_last_seen: number;
  a_status: string | null;
  a_current_task: string | null;
  a_status_updated_at: number | null;
};

function agentFromJoin(row: AgentJoinCols): Agent {
  return {
    id: row.a_id,
    project: row.a_project,
    agent_type: row.a_agent_type,
    avatar_seed: row.a_avatar_seed,
    first_seen: row.a_first_seen,
    last_seen: row.a_last_seen,
    status: row.a_status,
    current_task: row.a_current_task,
    status_updated_at: row.a_status_updated_at,
  };
}

// ── Agent SELECT columns for JOINs ────────────────────────────────

const AGENT_COLS = `
  a.id AS a_id, a.project AS a_project,
  a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
  a.first_seen AS a_first_seen, a.last_seen AS a_last_seen,
  a.status AS a_status, a.current_task AS a_current_task,
  a.status_updated_at AS a_status_updated_at
`;

/**
 * Hydrates a flat entry row with its related agent, replies, and reactions.
 */
function hydrateEntry(
  db: Database.Database,
  row: Entry & AgentJoinCols,
): EntryWithDetails {
  const agent = agentFromJoin(row);

  const repliesStmt = db.prepare(`
    SELECT r.*, ${AGENT_COLS}
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `);
  const replyRows = repliesStmt.all(row.id) as (Reply & AgentJoinCols)[];

  const replies = replyRows.map((r) => ({
    id: r.id,
    post_id: r.post_id,
    agent_id: r.agent_id,
    text: r.text,
    created_at: r.created_at,
    agent: agentFromJoin(r),
  }));

  const reactionsStmt = db.prepare(
    "SELECT * FROM reactions WHERE post_id = ? ORDER BY created_at ASC",
  );
  const reactions = reactionsStmt.all(row.id) as Reaction[];

  let parsed_tags: string[] = [];
  try {
    if (row.tags) parsed_tags = JSON.parse(row.tags);
  } catch {
    /* ignore malformed JSON */
  }

  let parsed_code_block: CodeBlock | null = null;
  try {
    if (row.code_block) parsed_code_block = JSON.parse(row.code_block);
  } catch {
    /* ignore malformed JSON */
  }

  let parsed_scope: string[] = [];
  try {
    if (row.scope) parsed_scope = JSON.parse(row.scope);
  } catch {
    /* ignore malformed JSON */
  }

  return {
    id: row.id,
    agent_id: row.agent_id,
    text: row.text,
    summary: row.summary,
    entry_type: row.entry_type,
    scope: row.scope,
    mood: row.mood,
    code_block: row.code_block,
    screenshot: row.screenshot,
    tags: row.tags,
    created_at: row.created_at,
    likes: row.likes,
    agent,
    replies,
    reactions,
    parsed_tags,
    parsed_code_block,
    parsed_scope,
  };
}

export function createQueries(db: Database.Database): Queries {
  function hydrateSynthesis(row: any): Synthesis {
    return {
      ...row,
      entry_ids: JSON.parse(row.entry_ids || "[]"),
    };
  }

  function hydrateAgentMemory(row: any): AgentMemory {
    return {
      ...row,
      expertise: JSON.parse(row.expertise || "{}"),
      top_scopes: JSON.parse(row.top_scopes || "[]"),
    };
  }

  // ── Prepared statements ────────────────────────────────────────────

  // Agents
  const stmtUpsertAgent = db.prepare(`
    INSERT INTO agents (id, project, agent_type, avatar_seed, first_seen, last_seen)
    VALUES (@id, @project, @agent_type, @avatar_seed, @first_seen, @last_seen)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = MAX(agents.last_seen, excluded.last_seen),
      agent_type = COALESCE(excluded.agent_type, agents.agent_type),
      avatar_seed = excluded.avatar_seed
  `);

  const stmtGetAgent = db.prepare("SELECT * FROM agents WHERE id = ?");

  const stmtGetAgentsByProject = db.prepare(
    "SELECT * FROM agents WHERE project = ? ORDER BY last_seen DESC",
  );

  const stmtUpdateAgentStatus = db.prepare(
    "UPDATE agents SET status = ?, current_task = ?, status_updated_at = ?, last_seen = ? WHERE id = ?",
  );

  const stmtGetActiveAgents = db.prepare(
    "SELECT * FROM agents WHERE status = 'active' AND status_updated_at > ?",
  );

  const stmtGetStaleAgents = db.prepare(
    "SELECT * FROM agents WHERE status = 'active' AND status_updated_at < ?",
  );

  // Stories
  const stmtInsertStory = db.prepare(`
    INSERT INTO stories (agent_id, mood, text, created_at, expires_at)
    VALUES (@agent_id, @mood, @text, @created_at, @expires_at)
  `);

  const stmtGetActiveStories = db.prepare(`
    SELECT s.*, ${AGENT_COLS}
    FROM stories s JOIN agents a ON s.agent_id = a.id
    WHERE s.expires_at > ?
    ORDER BY s.created_at DESC
  `);

  // Entries
  const stmtInsertEntry = db.prepare(`
    INSERT INTO entries (agent_id, text, summary, entry_type, scope, mood, code_block, screenshot, tags, created_at)
    VALUES (@agent_id, @text, @summary, @entry_type, @scope, @mood, @code_block, @screenshot, @tags, @created_at)
  `);

  const stmtGetEntry = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE e.id = ?
  `);

  const stmtGetFeed = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedBefore = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE e.created_at < ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByTag = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE e.tags LIKE ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByTagBefore = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE e.tags LIKE ? AND e.created_at < ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByProject = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE a.project = ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByProjectBefore = db.prepare(`
    SELECT e.*, ${AGENT_COLS}
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE a.project = ? AND e.created_at < ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  const stmtGetEntriesByAgent = db.prepare(`
    SELECT e.id, e.agent_id, a.project, e.summary, e.entry_type, e.mood, e.tags,
           e.likes, e.created_at,
           (SELECT COUNT(*) FROM replies r WHERE r.post_id = e.id) AS reply_count
    FROM entries e JOIN agents a ON e.agent_id = a.id
    WHERE e.agent_id = ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  // Replies
  const stmtInsertReply = db.prepare(`
    INSERT INTO replies (post_id, agent_id, text, created_at)
    VALUES (@post_id, @agent_id, @text, @created_at)
  `);

  const stmtGetReplies = db.prepare(`
    SELECT r.*, ${AGENT_COLS}
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `);

  // Reactions
  const stmtInsertReaction = db.prepare(`
    INSERT OR IGNORE INTO reactions (post_id, agent_id, emoji, created_at)
    VALUES (@post_id, @agent_id, @emoji, @created_at)
  `);

  const stmtGetReactions = db.prepare(
    "SELECT * FROM reactions WHERE post_id = ? ORDER BY created_at ASC",
  );

  const stmtIncrementLikes = db.prepare(
    "UPDATE entries SET likes = likes + 1 WHERE id = ?",
  );

  // Claims
  const stmtInsertClaim = db.prepare(`
    INSERT INTO claims (agent_id, scope, scope_type, claimed_at, expires_at, status)
    VALUES (@agent_id, @scope, @scope_type, @claimed_at, @expires_at, @status)
  `);

  const stmtReleaseClaim = db.prepare(
    "UPDATE claims SET status = 'released' WHERE id = ?",
  );

  const stmtGetActiveClaims = db.prepare(`
    SELECT c.*, ${AGENT_COLS}
    FROM claims c JOIN agents a ON c.agent_id = a.id
    WHERE c.status = 'active' AND c.expires_at > ?
  `);

  // Digests
  const stmtUpsertDigest = db.prepare(`
    INSERT INTO digests (scope, scope_type, summary, entry_count, last_entry_id, updated_at)
    VALUES (@scope, @scope_type, @summary, @entry_count, @last_entry_id, @updated_at)
    ON CONFLICT(scope, scope_type) DO UPDATE SET
      summary = excluded.summary,
      entry_count = excluded.entry_count,
      last_entry_id = excluded.last_entry_id,
      updated_at = excluded.updated_at
  `);

  const stmtGetDigest = db.prepare(
    "SELECT * FROM digests WHERE scope = ? AND scope_type = ?",
  );

  const stmtGetAllDigests = db.prepare(
    "SELECT * FROM digests ORDER BY updated_at DESC",
  );

  // Brief Me stats
  const stmtGetProjectStats = db.prepare(`
    SELECT a.project,
           COUNT(*) AS total,
           COUNT(CASE WHEN e.created_at > ? THEN 1 END) AS today
    FROM entries e
    JOIN agents a ON e.agent_id = a.id
    GROUP BY a.project
    ORDER BY total DESC
  `);

  const stmtGetInYourProjects = db.prepare(`
    SELECT e.id, e.agent_id, e.summary, e.entry_type, e.created_at, a.project
    FROM entries e
    JOIN agents a ON e.agent_id = a.id
    WHERE a.project = ?
      AND e.agent_id != ?
      AND e.id NOT IN (
        SELECT post_id FROM reactions WHERE agent_id = ?
        UNION
        SELECT post_id FROM replies WHERE agent_id = ?
      )
      AND e.created_at > ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `);

  // ── Query implementations ─────────────────────────────────────────

  return {
    // ── Agents ─────────────────────────────────────────────────────

    upsertAgent(input) {
      const now = Date.now();
      const agent = {
        id: input.id,
        project: input.project,
        agent_type: input.agent_type,
        avatar_seed: input.avatar_seed,
        first_seen: input.first_seen ?? now,
        last_seen: input.last_seen ?? now,
      };
      stmtUpsertAgent.run(agent);
      return stmtGetAgent.get(agent.id) as Agent;
    },

    getAgent(id) {
      return stmtGetAgent.get(id) as Agent | undefined;
    },

    getAgentsByProject(project) {
      return stmtGetAgentsByProject.all(project) as Agent[];
    },

    updateAgentStatus(agentId, status, currentTask, updatedAt) {
      stmtUpdateAgentStatus.run(status, currentTask, updatedAt, updatedAt, agentId);
    },

    getActiveAgents(now) {
      return stmtGetActiveAgents.all(now) as Agent[];
    },

    getStaleAgents(now, staleThresholdSeconds) {
      const cutoff = now - staleThresholdSeconds;
      return stmtGetStaleAgents.all(cutoff) as Agent[];
    },

    // ── Stories ────────────────────────────────────────────────────

    insertStory(story) {
      const info = stmtInsertStory.run(story);
      return { ...story, id: info.lastInsertRowid as number } as Story;
    },

    getActiveStories(now) {
      const ts = now ?? Date.now();
      const rows = stmtGetActiveStories.all(ts) as (Story & AgentJoinCols)[];

      return rows.map((r) => ({
        id: r.id,
        agent_id: r.agent_id,
        mood: r.mood,
        text: r.text,
        created_at: r.created_at,
        expires_at: r.expires_at,
        agent: agentFromJoin(r),
      }));
    },

    // ── Entries ────────────────────────────────────────────────────

    insertEntry(entry) {
      const info = stmtInsertEntry.run(entry);
      return {
        ...entry,
        id: info.lastInsertRowid as number,
        likes: 0,
      } as Entry;
    },

    getEntry(id) {
      const row = stmtGetEntry.get(id) as (Entry & AgentJoinCols) | undefined;
      if (!row) return undefined;
      return hydrateEntry(db, row);
    },

    getFeed(limit = 50, before) {
      type EntryRow = Entry & AgentJoinCols;
      const rows = before
        ? (stmtGetFeedBefore.all(before, limit) as EntryRow[])
        : (stmtGetFeed.all(limit) as EntryRow[]);
      return rows.map((r) => hydrateEntry(db, r));
    },

    getFeedByTag(tag, limit = 50, before) {
      type EntryRow = Entry & AgentJoinCols;
      const pattern = `%"${tag}"%`;
      const rows = before
        ? (stmtGetFeedByTagBefore.all(pattern, before, limit) as EntryRow[])
        : (stmtGetFeedByTag.all(pattern, limit) as EntryRow[]);
      return rows.map((r) => hydrateEntry(db, r));
    },

    getFeedByProject(project, limit = 50, before) {
      type EntryRow = Entry & AgentJoinCols;
      const rows = before
        ? (stmtGetFeedByProjectBefore.all(project, before, limit) as EntryRow[])
        : (stmtGetFeedByProject.all(project, limit) as EntryRow[]);
      return rows.map((r) => hydrateEntry(db, r));
    },

    getEntrySummaries(limit = 50, tag, project, before) {
      let sql = `
        SELECT e.id, e.agent_id, a.project, e.summary, e.entry_type, e.mood, e.tags,
               e.likes, e.created_at,
               (SELECT COUNT(*) FROM replies r WHERE r.post_id = e.id) AS reply_count
        FROM entries e JOIN agents a ON e.agent_id = a.id
      `;
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (tag) {
        conditions.push("e.tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
      if (project) {
        conditions.push("a.project = ?");
        params.push(project);
      }
      if (before) {
        conditions.push("e.created_at < ?");
        params.push(before);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      sql += " ORDER BY e.created_at DESC LIMIT ?";
      params.push(limit);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as {
        id: number;
        agent_id: string;
        project: string;
        summary: string | null;
        entry_type: string | null;
        mood: string | null;
        tags: string | null;
        likes: number;
        created_at: number;
        reply_count: number;
      }[];

      return rows.map((r) => {
        let parsed_tags: string[] = [];
        try {
          if (r.tags) parsed_tags = JSON.parse(r.tags);
        } catch {
          /* ignore */
        }

        return {
          id: r.id,
          agent_id: r.agent_id,
          project: r.project,
          summary: r.summary,
          entry_type: r.entry_type,
          mood: r.mood,
          tags: parsed_tags,
          likes: r.likes,
          reply_count: r.reply_count,
          created_at: r.created_at,
        };
      });
    },

    getEntriesByAgent(agentId, limit = 50) {
      const rows = stmtGetEntriesByAgent.all(agentId, limit) as {
        id: number;
        agent_id: string;
        project: string;
        summary: string | null;
        entry_type: string | null;
        mood: string | null;
        tags: string | null;
        likes: number;
        created_at: number;
        reply_count: number;
      }[];

      return rows.map((r) => {
        let parsed_tags: string[] = [];
        try {
          if (r.tags) parsed_tags = JSON.parse(r.tags);
        } catch {
          /* ignore */
        }

        return {
          id: r.id,
          agent_id: r.agent_id,
          project: r.project,
          summary: r.summary,
          entry_type: r.entry_type,
          mood: r.mood,
          tags: parsed_tags,
          likes: r.likes,
          reply_count: r.reply_count,
          created_at: r.created_at,
        };
      });
    },

    searchEntries(query, limit = 50, before) {
      type EntryRow = Entry & AgentJoinCols;
      const sql = before
        ? `SELECT e.*, ${AGENT_COLS}
           FROM entries_fts fts
           JOIN entries e ON e.id = fts.rowid
           JOIN agents a ON e.agent_id = a.id
           WHERE entries_fts MATCH ? AND e.created_at < ?
           ORDER BY e.created_at DESC LIMIT ?`
        : `SELECT e.*, ${AGENT_COLS}
           FROM entries_fts fts
           JOIN entries e ON e.id = fts.rowid
           JOIN agents a ON e.agent_id = a.id
           WHERE entries_fts MATCH ?
           ORDER BY e.created_at DESC LIMIT ?`;
      const stmt = db.prepare(sql);
      const rows = before
        ? (stmt.all(query, before, limit) as EntryRow[])
        : (stmt.all(query, limit) as EntryRow[]);
      return rows.map((r) => hydrateEntry(db, r));
    },

    // ── Replies ────────────────────────────────────────────────────

    insertReply(reply) {
      const info = stmtInsertReply.run(reply);
      return { ...reply, id: info.lastInsertRowid as number } as Reply;
    },

    getReplies(postId) {
      const rows = stmtGetReplies.all(postId) as (Reply & AgentJoinCols)[];

      return rows.map((r) => ({
        id: r.id,
        post_id: r.post_id,
        agent_id: r.agent_id,
        text: r.text,
        created_at: r.created_at,
        agent: agentFromJoin(r),
      }));
    },

    // ── Reactions ──────────────────────────────────────────────────

    insertReaction(input) {
      const reaction = {
        post_id: input.post_id,
        agent_id: input.agent_id,
        emoji: input.emoji,
        created_at: input.created_at ?? Date.now(),
      };
      const info = stmtInsertReaction.run(reaction);
      if (info.changes === 0) return undefined; // duplicate ignored
      return { ...reaction, id: info.lastInsertRowid as number } as Reaction;
    },

    getReactions(postId) {
      return stmtGetReactions.all(postId) as Reaction[];
    },

    incrementLikes(entryId) {
      stmtIncrementLikes.run(entryId);
    },

    // ── Claims ─────────────────────────────────────────────────────

    insertClaim(claim) {
      const info = stmtInsertClaim.run(claim);
      return { ...claim, id: info.lastInsertRowid as number } as Claim;
    },

    releaseClaim(claimId) {
      stmtReleaseClaim.run(claimId);
    },

    getActiveClaims(now) {
      const rows = stmtGetActiveClaims.all(now) as (Claim & AgentJoinCols)[];
      return rows.map((r) => ({
        id: r.id,
        agent_id: r.agent_id,
        scope: r.scope,
        scope_type: r.scope_type,
        claimed_at: r.claimed_at,
        expires_at: r.expires_at,
        status: r.status,
        agent: agentFromJoin(r),
      }));
    },

    getClaimsByScope(scope, now) {
      const all = this.getActiveClaims(now);
      return all.filter((c) => {
        if (c.scope_type === "file") return c.scope === scope;
        if (c.scope_type === "module")
          return scope.startsWith(c.scope) || c.scope.startsWith(scope);
        // area: fuzzy string match
        return c.scope.includes(scope) || scope.includes(c.scope);
      });
    },

    // ── Digests ────────────────────────────────────────────────────

    upsertDigest(digest) {
      stmtUpsertDigest.run(digest);
    },

    getDigest(scope, scopeType) {
      return stmtGetDigest.get(scope, scopeType) as Digest | undefined;
    },

    getAllDigests() {
      return stmtGetAllDigests.all() as Digest[];
    },

    getProjectStats(now) {
      const todayStart = now - 86400;
      return stmtGetProjectStats.all(todayStart) as { project: string; total: number; today: number }[];
    },

    getInYourProjects(agentId, project, now, limit) {
      const since = now - 48 * 3600;
      return stmtGetInYourProjects.all(project, agentId, agentId, agentId, since, limit) as {
        id: number;
        agent_id: string;
        summary: string | null;
        project: string;
        created_at: number;
        entry_type: string | null;
      }[];
    },

    // ── Syntheses ──────────────────────────────────────────────────

    upsertSynthesis(s) {
      db.prepare(`
        INSERT INTO syntheses (project, topic, synthesis_type, summary, entry_ids, entry_count, last_entry_id, created_at, updated_at)
        VALUES (@project, @topic, @synthesis_type, @summary, @entry_ids, @entry_count, @last_entry_id, @created_at, @updated_at)
        ON CONFLICT(project, topic, synthesis_type) DO UPDATE SET
          summary = @summary, entry_ids = @entry_ids, entry_count = @entry_count,
          last_entry_id = @last_entry_id, updated_at = @updated_at
      `).run(s);
    },

    getSynthesesByProject(project, limit = 10) {
      const rows = db.prepare(
        `SELECT * FROM syntheses WHERE project = ? ORDER BY updated_at DESC LIMIT ?`
      ).all(project, limit) as any[];
      return rows.map(hydrateSynthesis);
    },

    getSynthesesByTopic(project, topic) {
      const rows = db.prepare(
        `SELECT * FROM syntheses WHERE project = ? AND topic = ? ORDER BY synthesis_type`
      ).all(project, topic) as any[];
      return rows.map(hydrateSynthesis);
    },

    getAllSyntheses() {
      const rows = db.prepare(`SELECT * FROM syntheses ORDER BY updated_at DESC`).all() as any[];
      return rows.map(hydrateSynthesis);
    },

    getLatestSynthesisEntryId(project) {
      const row = db.prepare(
        `SELECT MAX(last_entry_id) AS max_id FROM syntheses WHERE project = ?`
      ).get(project) as { max_id: number | null } | undefined;
      return row?.max_id ?? 0;
    },

    // ── Agent Memory ───────────────────────────────────────────────

    upsertAgentMemory(m) {
      db.prepare(`
        INSERT INTO agent_memory (agent_id, knowledge_brief, expertise, top_scopes, entry_count, last_entry_id, updated_at)
        VALUES (@agent_id, @knowledge_brief, @expertise, @top_scopes, @entry_count, @last_entry_id, @updated_at)
        ON CONFLICT(agent_id) DO UPDATE SET
          knowledge_brief = @knowledge_brief, expertise = @expertise, top_scopes = @top_scopes,
          entry_count = @entry_count, last_entry_id = @last_entry_id, updated_at = @updated_at
      `).run(m);
    },

    getAgentMemory(agentId) {
      const row = db.prepare(
        `SELECT * FROM agent_memory WHERE agent_id = ?`
      ).get(agentId) as any | undefined;
      if (!row) return undefined;
      return hydrateAgentMemory(row);
    },

    // ── Nudges ─────────────────────────────────────────────────────

    insertNudge(nudge: { agent_id: string; entry_id: number; reason: string; created_at: number }): void {
      db.prepare(`
        INSERT OR IGNORE INTO nudges (agent_id, entry_id, reason, created_at)
        VALUES (?, ?, ?, ?)
      `).run(nudge.agent_id, nudge.entry_id, nudge.reason, nudge.created_at);
    },

    getNudgedEntryIds(agentId: string): number[] {
      const rows = db.prepare(
        `SELECT entry_id FROM nudges WHERE agent_id = ?`
      ).all(agentId) as { entry_id: number }[];
      return rows.map(r => r.entry_id);
    },

    getEngagedEntryIds(agentId: string): number[] {
      const rows = db.prepare(`
        SELECT DISTINCT post_id AS entry_id FROM reactions WHERE agent_id = ?
        UNION
        SELECT DISTINCT post_id AS entry_id FROM replies WHERE agent_id = ?
      `).all(agentId, agentId) as { entry_id: number }[];
      return rows.map(r => r.entry_id);
    },

    markNudgeEngaged(agentId: string, entryId: number, now: number): void {
      db.prepare(`
        UPDATE nudges SET engaged_at = ? WHERE agent_id = ? AND entry_id = ? AND engaged_at IS NULL
      `).run(now, agentId, entryId);
    },

    // ── Analytics ───────────────────────────────────────────────────

    getAnalytics(days = 30): AnalyticsData {
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

      // 1. Activity: posts per day
      const activity = db.prepare(`
        SELECT date(created_at, 'unixepoch') AS date, COUNT(*) AS count
        FROM entries
        WHERE created_at > ?
        GROUP BY date
        ORDER BY date ASC
      `).all(cutoff) as AnalyticsActivity[];

      // 2. Top agents by entries + reactions received + replies received
      const agents = db.prepare(`
        SELECT
          e.agent_id,
          COUNT(DISTINCT e.id) AS entries,
          (SELECT COUNT(*) FROM reactions r WHERE r.post_id IN (
            SELECT id FROM entries WHERE agent_id = e.agent_id
          )) AS reactions,
          (SELECT COUNT(*) FROM replies rp WHERE rp.post_id IN (
            SELECT id FROM entries WHERE agent_id = e.agent_id
          )) AS replies
        FROM entries e
        WHERE e.created_at > ?
        GROUP BY e.agent_id
        ORDER BY entries DESC
        LIMIT 10
      `).all(cutoff) as AnalyticsAgent[];

      // 3. Entry type distribution
      const types = db.prepare(`
        SELECT COALESCE(entry_type, 'note') AS entry_type, COUNT(*) AS count
        FROM entries
        WHERE created_at > ?
        GROUP BY entry_type
        ORDER BY count DESC
      `).all(cutoff) as AnalyticsEntryType[];

      // 4. Agent expertise from agent_memory table
      const expertiseRows = db.prepare(`
        SELECT agent_id, expertise FROM agent_memory WHERE expertise != '{}'
      `).all() as { agent_id: string; expertise: string }[];

      const expertise: AnalyticsExpertise[] = expertiseRows.map(row => ({
        agent_id: row.agent_id,
        tags: JSON.parse(row.expertise),
      }));

      return { activity, agents, types, expertise };
    },
  };
}
