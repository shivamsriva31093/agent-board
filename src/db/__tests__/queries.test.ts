import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createQueries, type Queries } from "../queries";

// Helper: create a fresh in-memory db with schema applied
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(__dirname, "..", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

let db: Database.Database;
let q: Queries;

beforeEach(() => {
  db = freshDb();
  q = createQueries(db);
});

afterEach(() => {
  db.close();
});

// ── Seed helpers ──────────────────────────────────────────────────────

function seedAgent(overrides: Partial<{ id: string; project: string; agent_type: string | null; avatar_seed: string; first_seen: number; last_seen: number }> = {}) {
  return q.upsertAgent({
    id: overrides.id ?? "proj/agent-abc123",
    project: overrides.project ?? "proj",
    agent_type: overrides.agent_type ?? "opus",
    avatar_seed: overrides.avatar_seed ?? "seed1",
    first_seen: overrides.first_seen ?? 1000,
    last_seen: overrides.last_seen ?? 2000,
  });
}

function seedPost(agentId: string, overrides: Partial<{ text: string; mood: string; tags: string; code_block: string; created_at: number }> = {}) {
  return q.insertPost({
    agent_id: agentId,
    text: overrides.text ?? "Hello world",
    mood: overrides.mood ?? null,
    code_block: overrides.code_block ?? null,
    screenshot: null,
    tags: overrides.tags ?? null,
    created_at: overrides.created_at ?? Date.now(),
  });
}

// ── Agents ────────────────────────────────────────────────────────────

describe("agents", () => {
  it("upserts a new agent", () => {
    const agent = seedAgent();
    expect(agent.id).toBe("proj/agent-abc123");
    expect(agent.project).toBe("proj");
    expect(agent.agent_type).toBe("opus");
    expect(agent.avatar_seed).toBe("seed1");
    expect(agent.first_seen).toBe(1000);
    expect(agent.last_seen).toBe(2000);
  });

  it("updates last_seen on conflict (keeps higher value)", () => {
    seedAgent({ last_seen: 1000 });

    // Upsert again with a later last_seen
    const updated = q.upsertAgent({
      id: "proj/agent-abc123",
      project: "proj",
      agent_type: "opus",
      avatar_seed: "seed1",
      last_seen: 3000,
    });
    expect(updated.last_seen).toBe(3000);

    // Upsert with an earlier last_seen should keep 3000
    const stale = q.upsertAgent({
      id: "proj/agent-abc123",
      project: "proj",
      agent_type: "opus",
      avatar_seed: "seed1",
      last_seen: 500,
    });
    expect(stale.last_seen).toBe(3000);
  });

  it("retrieves agent by id", () => {
    seedAgent();
    const found = q.getAgent("proj/agent-abc123");
    expect(found).toBeDefined();
    expect(found!.id).toBe("proj/agent-abc123");
  });

  it("returns undefined for missing agent", () => {
    expect(q.getAgent("nonexistent")).toBeUndefined();
  });

  it("lists agents by project", () => {
    seedAgent({ id: "proj/a1", project: "proj", last_seen: 100 });
    seedAgent({ id: "proj/a2", project: "proj", last_seen: 200 });
    seedAgent({ id: "other/a3", project: "other", last_seen: 300 });

    const projAgents = q.getAgentsByProject("proj");
    expect(projAgents).toHaveLength(2);
    // Ordered by last_seen DESC
    expect(projAgents[0].id).toBe("proj/a2");
    expect(projAgents[1].id).toBe("proj/a1");
  });
});

// ── Stories ───────────────────────────────────────────────────────────

describe("stories", () => {
  it("inserts and retrieves active stories", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.insertStory({
      agent_id: agent.id,
      mood: "productive",
      text: "Just deployed v2!",
      created_at: now,
      expires_at: now + 86400_000, // 24h
    });

    const active = q.getActiveStories(now);
    expect(active).toHaveLength(1);
    expect(active[0].text).toBe("Just deployed v2!");
    expect(active[0].mood).toBe("productive");
    expect(active[0].agent.id).toBe(agent.id);
  });

  it("excludes expired stories", () => {
    const agent = seedAgent();
    const now = Date.now();

    // Active story
    q.insertStory({
      agent_id: agent.id,
      mood: "happy",
      text: "Still active",
      created_at: now,
      expires_at: now + 86400_000,
    });

    // Expired story
    q.insertStory({
      agent_id: agent.id,
      mood: "sad",
      text: "Already expired",
      created_at: now - 100000,
      expires_at: now - 1, // expired
    });

    const active = q.getActiveStories(now);
    expect(active).toHaveLength(1);
    expect(active[0].text).toBe("Still active");
  });

  it("returns stories ordered by created_at DESC", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.insertStory({ agent_id: agent.id, mood: null, text: "First", created_at: now - 100, expires_at: now + 86400_000 });
    q.insertStory({ agent_id: agent.id, mood: null, text: "Second", created_at: now, expires_at: now + 86400_000 });

    const active = q.getActiveStories(now - 200);
    expect(active[0].text).toBe("Second");
    expect(active[1].text).toBe("First");
  });
});

// ── Posts ─────────────────────────────────────────────────────────────

describe("posts", () => {
  it("inserts and retrieves from feed", () => {
    const agent = seedAgent();
    const post = seedPost(agent.id, { text: "My first post" });

    expect(post.id).toBe(1);
    expect(post.likes).toBe(0);

    const feed = q.getFeed(10);
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe("My first post");
    expect(feed[0].agent.id).toBe(agent.id);
    expect(feed[0].replies).toHaveLength(0);
    expect(feed[0].reactions).toHaveLength(0);
  });

  it("returns feed ordered by created_at DESC", () => {
    const agent = seedAgent();
    seedPost(agent.id, { text: "Older", created_at: 1000 });
    seedPost(agent.id, { text: "Newer", created_at: 2000 });

    const feed = q.getFeed(10);
    expect(feed[0].text).toBe("Newer");
    expect(feed[1].text).toBe("Older");
  });

  it("respects feed limit", () => {
    const agent = seedAgent();
    for (let i = 0; i < 5; i++) {
      seedPost(agent.id, { text: `Post ${i}`, created_at: i });
    }

    const feed = q.getFeed(3);
    expect(feed).toHaveLength(3);
  });

  it("filters by tag", () => {
    const agent = seedAgent();
    seedPost(agent.id, { text: "Tagged", tags: JSON.stringify(["sqlite", "db"]) });
    seedPost(agent.id, { text: "No tags" });
    seedPost(agent.id, { text: "Other tag", tags: JSON.stringify(["react"]) });

    const sqlitePosts = q.getFeedByTag("sqlite");
    expect(sqlitePosts).toHaveLength(1);
    expect(sqlitePosts[0].text).toBe("Tagged");
    expect(sqlitePosts[0].parsed_tags).toEqual(["sqlite", "db"]);
  });

  it("filters by project", () => {
    const agentA = seedAgent({ id: "alpha/a1", project: "alpha" });
    const agentB = seedAgent({ id: "beta/b1", project: "beta" });

    seedPost(agentA.id, { text: "Alpha post" });
    seedPost(agentB.id, { text: "Beta post" });

    const alphaPosts = q.getFeedByProject("alpha");
    expect(alphaPosts).toHaveLength(1);
    expect(alphaPosts[0].text).toBe("Alpha post");
    expect(alphaPosts[0].agent.project).toBe("alpha");
  });

  it("retrieves a single post with details", () => {
    const agent = seedAgent();
    const codeBlock = JSON.stringify({ lang: "ts", content: "const x = 1;", filename: "test.ts" });
    const post = seedPost(agent.id, {
      text: "Check this code",
      code_block: codeBlock,
      tags: JSON.stringify(["typescript"]),
    });

    const detail = q.getPost(post.id);
    expect(detail).toBeDefined();
    expect(detail!.parsed_code_block).toEqual({ lang: "ts", content: "const x = 1;", filename: "test.ts" });
    expect(detail!.parsed_tags).toEqual(["typescript"]);
  });

  it("returns undefined for missing post", () => {
    expect(q.getPost(999)).toBeUndefined();
  });
});

// ── Replies ───────────────────────────────────────────────────────────

describe("replies", () => {
  it("threads replies under a post", () => {
    const author = seedAgent({ id: "proj/author", project: "proj" });
    const replier = seedAgent({ id: "proj/replier", project: "proj", avatar_seed: "seed2" });

    const post = seedPost(author.id, { text: "Discussion topic" });

    q.insertReply({ post_id: post.id, agent_id: replier.id, text: "Great point!", created_at: 1000 });
    q.insertReply({ post_id: post.id, agent_id: author.id, text: "Thanks!", created_at: 2000 });

    const replies = q.getReplies(post.id);
    expect(replies).toHaveLength(2);
    expect(replies[0].text).toBe("Great point!");
    expect(replies[0].agent.id).toBe("proj/replier");
    expect(replies[1].text).toBe("Thanks!");
    expect(replies[1].agent.id).toBe("proj/author");
  });

  it("replies appear in post detail", () => {
    const agent = seedAgent();
    const post = seedPost(agent.id);
    q.insertReply({ post_id: post.id, agent_id: agent.id, text: "Self-reply", created_at: 1000 });

    const detail = q.getPost(post.id);
    expect(detail!.replies).toHaveLength(1);
    expect(detail!.replies[0].text).toBe("Self-reply");
    expect(detail!.replies[0].agent.id).toBe(agent.id);
  });
});

// ── Reactions ─────────────────────────────────────────────────────────

describe("reactions", () => {
  it("adds reactions and increments likes", () => {
    const agent = seedAgent();
    const post = seedPost(agent.id);

    const reaction = q.insertReaction({ post_id: post.id, agent_id: agent.id, emoji: "♥", created_at: 1000 });
    expect(reaction).toBeDefined();
    expect(reaction!.emoji).toBe("♥");

    q.incrementLikes(post.id);

    const detail = q.getPost(post.id);
    expect(detail!.likes).toBe(1);
    expect(detail!.reactions).toHaveLength(1);
    expect(detail!.reactions[0].emoji).toBe("♥");
  });

  it("prevents duplicate reactions (same post, agent, emoji)", () => {
    const agent = seedAgent();
    const post = seedPost(agent.id);

    const first = q.insertReaction({ post_id: post.id, agent_id: agent.id, emoji: "♥", created_at: 1000 });
    expect(first).toBeDefined();

    // Duplicate should be ignored
    const duplicate = q.insertReaction({ post_id: post.id, agent_id: agent.id, emoji: "♥", created_at: 2000 });
    expect(duplicate).toBeUndefined();

    // But different emoji is allowed
    const different = q.insertReaction({ post_id: post.id, agent_id: agent.id, emoji: "🔥", created_at: 3000 });
    expect(different).toBeDefined();

    const reactions = q.getReactions(post.id);
    expect(reactions).toHaveLength(2);
  });

  it("allows different agents to react with same emoji", () => {
    const agent1 = seedAgent({ id: "proj/a1", project: "proj" });
    const agent2 = seedAgent({ id: "proj/a2", project: "proj", avatar_seed: "seed2" });
    const post = seedPost(agent1.id);

    q.insertReaction({ post_id: post.id, agent_id: agent1.id, emoji: "♥", created_at: 1000 });
    q.insertReaction({ post_id: post.id, agent_id: agent2.id, emoji: "♥", created_at: 2000 });

    const reactions = q.getReactions(post.id);
    expect(reactions).toHaveLength(2);
  });

  it("reactions appear in post detail", () => {
    const agent = seedAgent();
    const post = seedPost(agent.id);

    q.insertReaction({ post_id: post.id, agent_id: agent.id, emoji: "🎉", created_at: 1000 });

    const detail = q.getPost(post.id);
    expect(detail!.reactions).toHaveLength(1);
    expect(detail!.reactions[0].emoji).toBe("🎉");
  });
});
