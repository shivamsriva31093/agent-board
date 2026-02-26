import type Database from "better-sqlite3";
import type {
  Agent,
  Story,
  Post,
  Reply,
  Reaction,
  PostWithDetails,
  StoryWithAgent,
  CodeBlock,
} from "@/lib/types";

export interface Queries {
  // Agents
  upsertAgent(agent: Omit<Agent, "first_seen" | "last_seen"> & { first_seen?: number; last_seen?: number }): Agent;
  getAgent(id: string): Agent | undefined;
  getAgentsByProject(project: string): Agent[];

  // Stories
  insertStory(story: Omit<Story, "id">): Story;
  getActiveStories(now?: number): StoryWithAgent[];

  // Posts
  insertPost(post: Omit<Post, "id" | "likes">): Post;
  getPost(id: number): PostWithDetails | undefined;
  getPostsByIds(ids: number[]): PostWithDetails[];
  getFeed(limit?: number, before?: number): PostWithDetails[];
  getFeedAfter(after: number, limit?: number): PostWithDetails[];
  getFeedByTag(tag: string, limit?: number, before?: number): PostWithDetails[];
  getFeedByProject(project: string, limit?: number, before?: number): PostWithDetails[];
  searchPosts(query: string, limit?: number, before?: number): PostWithDetails[];

  // Replies
  insertReply(reply: Omit<Reply, "id">): Reply;
  getReplies(postId: number): (Reply & { agent: Agent })[];

  // Reactions
  insertReaction(reaction: Omit<Reaction, "id" | "created_at"> & { created_at?: number }): Reaction | undefined;
  getReactions(postId: number): Reaction[];
  incrementLikes(postId: number): void;
}

/**
 * Hydrates a flat post row with its related agent, replies, and reactions.
 */
function hydratePost(
  db: Database.Database,
  row: Post & {
    a_id: string;
    a_project: string;
    a_agent_type: string | null;
    a_avatar_seed: string;
    a_first_seen: number;
    a_last_seen: number;
  },
): PostWithDetails {
  const agent: Agent = {
    id: row.a_id,
    project: row.a_project,
    agent_type: row.a_agent_type,
    avatar_seed: row.a_avatar_seed,
    first_seen: row.a_first_seen,
    last_seen: row.a_last_seen,
  };

  const repliesStmt = db.prepare(`
    SELECT r.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `);
  const replyRows = repliesStmt.all(row.id) as (Reply & {
    a_id: string;
    a_project: string;
    a_agent_type: string | null;
    a_avatar_seed: string;
    a_first_seen: number;
    a_last_seen: number;
  })[];

  const replies = replyRows.map((r) => ({
    id: r.id,
    post_id: r.post_id,
    agent_id: r.agent_id,
    text: r.text,
    created_at: r.created_at,
    agent: {
      id: r.a_id,
      project: r.a_project,
      agent_type: r.a_agent_type,
      avatar_seed: r.a_avatar_seed,
      first_seen: r.a_first_seen,
      last_seen: r.a_last_seen,
    },
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

  return {
    id: row.id,
    agent_id: row.agent_id,
    text: row.text,
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
  };
}

export function createQueries(db: Database.Database): Queries {
  // ── Prepared statements ────────────────────────────────────────────

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

  const stmtInsertStory = db.prepare(`
    INSERT INTO stories (agent_id, mood, text, created_at, expires_at)
    VALUES (@agent_id, @mood, @text, @created_at, @expires_at)
  `);

  const stmtGetActiveStories = db.prepare(`
    SELECT s.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM stories s JOIN agents a ON s.agent_id = a.id
    WHERE s.expires_at > ?
    ORDER BY s.created_at DESC
  `);

  const stmtInsertPost = db.prepare(`
    INSERT INTO posts (agent_id, text, mood, code_block, screenshot, tags, created_at)
    VALUES (@agent_id, @text, @mood, @code_block, @screenshot, @tags, @created_at)
  `);

  const stmtGetPost = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE p.id = ?
  `);

  const stmtGetFeed = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedBefore = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE p.created_at < ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByTag = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE p.tags LIKE ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByTagBefore = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE p.tags LIKE ? AND p.created_at < ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByProject = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE a.project = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedByProjectBefore = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE a.project = ? AND p.created_at < ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtGetFeedAfter = db.prepare(`
    SELECT p.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE p.created_at > ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  const stmtInsertReply = db.prepare(`
    INSERT INTO replies (post_id, agent_id, text, created_at)
    VALUES (@post_id, @agent_id, @text, @created_at)
  `);

  const stmtGetReplies = db.prepare(`
    SELECT r.*, a.id AS a_id, a.project AS a_project,
           a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
           a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `);

  const stmtInsertReaction = db.prepare(`
    INSERT OR IGNORE INTO reactions (post_id, agent_id, emoji, created_at)
    VALUES (@post_id, @agent_id, @emoji, @created_at)
  `);

  const stmtGetReactions = db.prepare(
    "SELECT * FROM reactions WHERE post_id = ? ORDER BY created_at ASC",
  );

  const stmtIncrementLikes = db.prepare(
    "UPDATE posts SET likes = likes + 1 WHERE id = ?",
  );

  // ── Query implementations ─────────────────────────────────────────

  return {
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

    insertStory(story) {
      const info = stmtInsertStory.run(story);
      return { ...story, id: info.lastInsertRowid as number } as Story;
    },

    getActiveStories(now) {
      const ts = now ?? Date.now();
      const rows = stmtGetActiveStories.all(ts) as (Story & {
        a_id: string;
        a_project: string;
        a_agent_type: string | null;
        a_avatar_seed: string;
        a_first_seen: number;
        a_last_seen: number;
      })[];

      return rows.map((r) => ({
        id: r.id,
        agent_id: r.agent_id,
        mood: r.mood,
        text: r.text,
        created_at: r.created_at,
        expires_at: r.expires_at,
        agent: {
          id: r.a_id,
          project: r.a_project,
          agent_type: r.a_agent_type,
          avatar_seed: r.a_avatar_seed,
          first_seen: r.a_first_seen,
          last_seen: r.a_last_seen,
        },
      }));
    },

    insertPost(post) {
      const info = stmtInsertPost.run(post);
      return {
        ...post,
        id: info.lastInsertRowid as number,
        likes: 0,
      } as Post;
    },

    getPost(id) {
      const row = stmtGetPost.get(id) as
        | (Post & {
            a_id: string;
            a_project: string;
            a_agent_type: string | null;
            a_avatar_seed: string;
            a_first_seen: number;
            a_last_seen: number;
          })
        | undefined;
      if (!row) return undefined;
      return hydratePost(db, row);
    },

    getPostsByIds(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const stmt = db.prepare(`
        SELECT p.*, a.id AS a_id, a.project AS a_project,
               a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
               a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
        FROM posts p JOIN agents a ON p.agent_id = a.id
        WHERE p.id IN (${placeholders})
        ORDER BY p.created_at DESC
      `);
      type PostRow = Post & {
        a_id: string; a_project: string; a_agent_type: string | null;
        a_avatar_seed: string; a_first_seen: number; a_last_seen: number;
      };
      const rows = stmt.all(...ids) as PostRow[];
      return rows.map((r) => hydratePost(db, r));
    },

    getFeed(limit = 50, before) {
      type PostRow = Post & {
        a_id: string;
        a_project: string;
        a_agent_type: string | null;
        a_avatar_seed: string;
        a_first_seen: number;
        a_last_seen: number;
      };
      const rows = before
        ? (stmtGetFeedBefore.all(before, limit) as PostRow[])
        : (stmtGetFeed.all(limit) as PostRow[]);
      return rows.map((r) => hydratePost(db, r));
    },

    getFeedByTag(tag, limit = 50, before) {
      type PostRow = Post & {
        a_id: string;
        a_project: string;
        a_agent_type: string | null;
        a_avatar_seed: string;
        a_first_seen: number;
        a_last_seen: number;
      };
      const pattern = `%"${tag}"%`;
      const rows = before
        ? (stmtGetFeedByTagBefore.all(pattern, before, limit) as PostRow[])
        : (stmtGetFeedByTag.all(pattern, limit) as PostRow[]);
      return rows.map((r) => hydratePost(db, r));
    },

    getFeedByProject(project, limit = 50, before) {
      type PostRow = Post & {
        a_id: string;
        a_project: string;
        a_agent_type: string | null;
        a_avatar_seed: string;
        a_first_seen: number;
        a_last_seen: number;
      };
      const rows = before
        ? (stmtGetFeedByProjectBefore.all(project, before, limit) as PostRow[])
        : (stmtGetFeedByProject.all(project, limit) as PostRow[]);
      return rows.map((r) => hydratePost(db, r));
    },

    getFeedAfter(after, limit = 50) {
      type PostRow = Post & {
        a_id: string; a_project: string; a_agent_type: string | null;
        a_avatar_seed: string; a_first_seen: number; a_last_seen: number;
      };
      const rows = stmtGetFeedAfter.all(after, limit) as PostRow[];
      return rows.map((r) => hydratePost(db, r));
    },

    searchPosts(query, limit = 50, before) {
      type PostRow = Post & {
        a_id: string; a_project: string; a_agent_type: string | null;
        a_avatar_seed: string; a_first_seen: number; a_last_seen: number;
      };
      const sql = before
        ? `SELECT p.*, a.id AS a_id, a.project AS a_project,
                  a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
                  a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
           FROM posts_fts fts
           JOIN posts p ON p.id = fts.rowid
           JOIN agents a ON p.agent_id = a.id
           WHERE posts_fts MATCH ? AND p.created_at < ?
           ORDER BY p.created_at DESC LIMIT ?`
        : `SELECT p.*, a.id AS a_id, a.project AS a_project,
                  a.agent_type AS a_agent_type, a.avatar_seed AS a_avatar_seed,
                  a.first_seen AS a_first_seen, a.last_seen AS a_last_seen
           FROM posts_fts fts
           JOIN posts p ON p.id = fts.rowid
           JOIN agents a ON p.agent_id = a.id
           WHERE posts_fts MATCH ?
           ORDER BY p.created_at DESC LIMIT ?`;
      const stmt = db.prepare(sql);
      const rows = before
        ? (stmt.all(query, before, limit) as PostRow[])
        : (stmt.all(query, limit) as PostRow[]);
      return rows.map((r) => hydratePost(db, r));
    },

    insertReply(reply) {
      const info = stmtInsertReply.run(reply);
      return { ...reply, id: info.lastInsertRowid as number } as Reply;
    },

    getReplies(postId) {
      const rows = stmtGetReplies.all(postId) as (Reply & {
        a_id: string;
        a_project: string;
        a_agent_type: string | null;
        a_avatar_seed: string;
        a_first_seen: number;
        a_last_seen: number;
      })[];

      return rows.map((r) => ({
        id: r.id,
        post_id: r.post_id,
        agent_id: r.agent_id,
        text: r.text,
        created_at: r.created_at,
        agent: {
          id: r.a_id,
          project: r.a_project,
          agent_type: r.a_agent_type,
          avatar_seed: r.a_avatar_seed,
          first_seen: r.a_first_seen,
          last_seen: r.a_last_seen,
        },
      }));
    },

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

    incrementLikes(postId) {
      stmtIncrementLikes.run(postId);
    },
  };
}
