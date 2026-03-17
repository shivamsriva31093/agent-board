import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createQueries, type Queries } from "../queries";

// Helper: create a fresh in-memory db with v2 schema applied
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

function seedAgent(
  overrides: Partial<{
    id: string;
    project: string;
    agent_type: string | null;
    avatar_seed: string;
    first_seen: number;
    last_seen: number;
  }> = {},
) {
  return q.upsertAgent({
    id: overrides.id ?? "proj/agent-abc123",
    project: overrides.project ?? "proj",
    agent_type: overrides.agent_type ?? "opus",
    avatar_seed: overrides.avatar_seed ?? "seed1",
    first_seen: overrides.first_seen ?? 1000,
    last_seen: overrides.last_seen ?? 2000,
  });
}

function seedEntry(
  agentId: string,
  overrides: Partial<{
    text: string;
    summary: string | null;
    entry_type: string | null;
    scope: string | null;
    mood: string | null;
    tags: string | null;
    code_block: string | null;
    screenshot: string | null;
    created_at: number;
  }> = {},
) {
  return q.insertEntry({
    agent_id: agentId,
    text: overrides.text ?? "Hello world",
    summary: overrides.summary ?? null,
    entry_type: overrides.entry_type ?? null,
    scope: overrides.scope ?? null,
    mood: overrides.mood ?? null,
    code_block: overrides.code_block ?? null,
    screenshot: overrides.screenshot ?? null,
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
    // New v2 fields default to null
    expect(agent.status).toBeNull();
    expect(agent.current_task).toBeNull();
    expect(agent.status_updated_at).toBeNull();
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

  it("updates agent status", () => {
    seedAgent();
    const now = Date.now();

    q.updateAgentStatus("proj/agent-abc123", "active", "fixing bugs", now);

    const agent = q.getAgent("proj/agent-abc123");
    expect(agent!.status).toBe("active");
    expect(agent!.current_task).toBe("fixing bugs");
    expect(agent!.status_updated_at).toBe(now);
    // last_seen also updated
    expect(agent!.last_seen).toBe(now);
  });

  it("gets active agents (status=active and status_updated_at recent)", () => {
    const now = Date.now();

    seedAgent({ id: "proj/a1", project: "proj" });
    seedAgent({ id: "proj/a2", project: "proj" });
    seedAgent({ id: "proj/a3", project: "proj" });

    // a1: active and recently updated
    q.updateAgentStatus("proj/a1", "active", "task1", now);
    // a2: active but updated long ago
    q.updateAgentStatus("proj/a2", "active", "task2", now - 999999);
    // a3: idle status
    q.updateAgentStatus("proj/a3", "idle", null, now);

    // getActiveAgents: status='active' AND status_updated_at > threshold
    const threshold = now - 60000; // 60 seconds ago
    const active = q.getActiveAgents(threshold);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("proj/a1");
  });

  it("gets stale agents (status=active but status_updated_at is old)", () => {
    const now = Date.now();

    seedAgent({ id: "proj/a1", project: "proj" });
    seedAgent({ id: "proj/a2", project: "proj" });

    // a1: active and recently updated
    q.updateAgentStatus("proj/a1", "active", "task1", now);
    // a2: active but updated 2 hours ago
    q.updateAgentStatus("proj/a2", "active", "task2", now - 7200_000);

    // Stale threshold: 1 hour (3600 seconds)
    const stale = q.getStaleAgents(now, 3600);
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe("proj/a2");
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

    q.insertStory({
      agent_id: agent.id,
      mood: null,
      text: "First",
      created_at: now - 100,
      expires_at: now + 86400_000,
    });
    q.insertStory({
      agent_id: agent.id,
      mood: null,
      text: "Second",
      created_at: now,
      expires_at: now + 86400_000,
    });

    const active = q.getActiveStories(now - 200);
    expect(active[0].text).toBe("Second");
    expect(active[1].text).toBe("First");
  });

  it("includes v2 agent fields in story agent", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.updateAgentStatus(agent.id, "active", "working", now);

    q.insertStory({
      agent_id: agent.id,
      mood: null,
      text: "Story",
      created_at: now,
      expires_at: now + 86400_000,
    });

    const active = q.getActiveStories(now - 1);
    expect(active[0].agent.status).toBe("active");
    expect(active[0].agent.current_task).toBe("working");
  });
});

// ── Entries ──────────────────────────────────────────────────────────

describe("entries", () => {
  it("inserts and retrieves from feed", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id, { text: "My first entry" });

    expect(entry.id).toBe(1);
    expect(entry.likes).toBe(0);

    const feed = q.getFeed(10);
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe("My first entry");
    expect(feed[0].agent.id).toBe(agent.id);
    expect(feed[0].replies).toHaveLength(0);
    expect(feed[0].reactions).toHaveLength(0);
  });

  it("returns feed ordered by created_at DESC", () => {
    const agent = seedAgent();
    seedEntry(agent.id, { text: "Older", created_at: 1000 });
    seedEntry(agent.id, { text: "Newer", created_at: 2000 });

    const feed = q.getFeed(10);
    expect(feed[0].text).toBe("Newer");
    expect(feed[1].text).toBe("Older");
  });

  it("respects feed limit", () => {
    const agent = seedAgent();
    for (let i = 0; i < 5; i++) {
      seedEntry(agent.id, { text: `Entry ${i}`, created_at: i });
    }

    const feed = q.getFeed(3);
    expect(feed).toHaveLength(3);
  });

  it("paginates with before cursor", () => {
    const agent = seedAgent();
    seedEntry(agent.id, { text: "A", created_at: 1000 });
    seedEntry(agent.id, { text: "B", created_at: 2000 });
    seedEntry(agent.id, { text: "C", created_at: 3000 });

    const page = q.getFeed(10, 3000);
    expect(page).toHaveLength(2);
    expect(page[0].text).toBe("B");
    expect(page[1].text).toBe("A");
  });

  it("filters by tag", () => {
    const agent = seedAgent();
    seedEntry(agent.id, {
      text: "Tagged",
      tags: JSON.stringify(["sqlite", "db"]),
    });
    seedEntry(agent.id, { text: "No tags" });
    seedEntry(agent.id, {
      text: "Other tag",
      tags: JSON.stringify(["react"]),
    });

    const sqliteEntries = q.getFeedByTag("sqlite");
    expect(sqliteEntries).toHaveLength(1);
    expect(sqliteEntries[0].text).toBe("Tagged");
    expect(sqliteEntries[0].parsed_tags).toEqual(["sqlite", "db"]);
  });

  it("filters by project", () => {
    const agentA = seedAgent({ id: "alpha/a1", project: "alpha" });
    const agentB = seedAgent({ id: "beta/b1", project: "beta" });

    seedEntry(agentA.id, { text: "Alpha entry" });
    seedEntry(agentB.id, { text: "Beta entry" });

    const alphaEntries = q.getFeedByProject("alpha");
    expect(alphaEntries).toHaveLength(1);
    expect(alphaEntries[0].text).toBe("Alpha entry");
    expect(alphaEntries[0].agent.project).toBe("alpha");
  });

  it("retrieves a single entry with details", () => {
    const agent = seedAgent();
    const codeBlock = JSON.stringify({
      lang: "ts",
      content: "const x = 1;",
      filename: "test.ts",
    });
    const entry = seedEntry(agent.id, {
      text: "Check this code",
      summary: "Code review entry",
      entry_type: "insight",
      scope: JSON.stringify(["src/db/"]),
      code_block: codeBlock,
      tags: JSON.stringify(["typescript"]),
    });

    const detail = q.getEntry(entry.id);
    expect(detail).toBeDefined();
    expect(detail!.parsed_code_block).toEqual({
      lang: "ts",
      content: "const x = 1;",
      filename: "test.ts",
    });
    expect(detail!.parsed_tags).toEqual(["typescript"]);
    expect(detail!.parsed_scope).toEqual(["src/db/"]);
    expect(detail!.summary).toBe("Code review entry");
    expect(detail!.entry_type).toBe("insight");
  });

  it("returns undefined for missing entry", () => {
    expect(q.getEntry(999)).toBeUndefined();
  });

  it("hydrates v2 agent fields in entry detail", () => {
    const agent = seedAgent();
    const now = Date.now();
    q.updateAgentStatus(agent.id, "active", "coding", now);

    const entry = seedEntry(agent.id, { text: "test" });
    const detail = q.getEntry(entry.id);
    expect(detail!.agent.status).toBe("active");
    expect(detail!.agent.current_task).toBe("coding");
  });
});

// ── Entry Summaries ──────────────────────────────────────────────────

describe("getEntrySummaries", () => {
  it("returns compact summaries with parsed tags", () => {
    const agent = seedAgent();
    seedEntry(agent.id, {
      text: "Full text here",
      summary: "Short summary",
      entry_type: "insight",
      mood: "happy",
      tags: JSON.stringify(["sqlite", "testing"]),
      created_at: 1000,
    });

    const summaries = q.getEntrySummaries();
    expect(summaries).toHaveLength(1);

    const s = summaries[0];
    expect(s.id).toBe(1);
    expect(s.agent_id).toBe(agent.id);
    expect(s.project).toBe("proj");
    expect(s.summary).toBe("Short summary");
    expect(s.entry_type).toBe("insight");
    expect(s.mood).toBe("happy");
    expect(s.tags).toEqual(["sqlite", "testing"]);
    expect(s.likes).toBe(0);
    expect(s.reply_count).toBe(0);
    expect(s.created_at).toBe(1000);
  });

  it("counts replies in summary", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id, { text: "Discussion" });

    q.insertReply({
      post_id: entry.id,
      agent_id: agent.id,
      text: "Reply 1",
      created_at: 1000,
    });
    q.insertReply({
      post_id: entry.id,
      agent_id: agent.id,
      text: "Reply 2",
      created_at: 2000,
    });

    const summaries = q.getEntrySummaries();
    expect(summaries[0].reply_count).toBe(2);
  });

  it("filters by tag", () => {
    const agent = seedAgent();
    seedEntry(agent.id, {
      text: "Tagged",
      tags: JSON.stringify(["go"]),
    });
    seedEntry(agent.id, { text: "Untagged" });

    const summaries = q.getEntrySummaries(50, "go");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].tags).toEqual(["go"]);
  });

  it("filters by project", () => {
    const agentA = seedAgent({ id: "alpha/a1", project: "alpha" });
    const agentB = seedAgent({ id: "beta/b1", project: "beta" });

    seedEntry(agentA.id, { text: "Alpha" });
    seedEntry(agentB.id, { text: "Beta" });

    const summaries = q.getEntrySummaries(50, undefined, "alpha");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].project).toBe("alpha");
  });

  it("respects limit and before cursor", () => {
    const agent = seedAgent();
    for (let i = 1; i <= 5; i++) {
      seedEntry(agent.id, { text: `Entry ${i}`, created_at: i * 1000 });
    }

    const limited = q.getEntrySummaries(2);
    expect(limited).toHaveLength(2);
    expect(limited[0].created_at).toBe(5000);

    const paged = q.getEntrySummaries(2, undefined, undefined, 4000);
    expect(paged).toHaveLength(2);
    expect(paged[0].created_at).toBe(3000);
    expect(paged[1].created_at).toBe(2000);
  });

  it("handles null/missing tags gracefully", () => {
    const agent = seedAgent();
    seedEntry(agent.id, { text: "No tags" });

    const summaries = q.getEntrySummaries();
    expect(summaries[0].tags).toEqual([]);
  });
});

// ── getEntriesByAgent ─────────────────────────────────────────────────

describe("getEntriesByAgent", () => {
  it("returns only entries from the specified agent", () => {
    const agentA = seedAgent({ id: "alpha/a1", project: "alpha" });
    const agentB = seedAgent({ id: "beta/b1", project: "beta" });

    seedEntry(agentA.id, { text: "Alpha entry 1", created_at: 1000 });
    seedEntry(agentA.id, { text: "Alpha entry 2", created_at: 2000 });
    seedEntry(agentB.id, { text: "Beta entry 1", created_at: 3000 });

    const results = q.getEntriesByAgent(agentA.id);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.agent_id === agentA.id)).toBe(true);
  });

  it("returns entries ordered by created_at DESC (newest first)", () => {
    const agent = seedAgent();
    seedEntry(agent.id, { text: "Older", created_at: 1000 });
    seedEntry(agent.id, { text: "Newer", created_at: 2000 });
    seedEntry(agent.id, { text: "Newest", created_at: 3000 });

    const results = q.getEntriesByAgent(agent.id);
    expect(results[0].created_at).toBe(3000);
    expect(results[1].created_at).toBe(2000);
    expect(results[2].created_at).toBe(1000);
  });

  it("respects the limit parameter", () => {
    const agent = seedAgent();
    for (let i = 1; i <= 5; i++) {
      seedEntry(agent.id, { text: `Entry ${i}`, created_at: i * 1000 });
    }

    const results = q.getEntriesByAgent(agent.id, 2);
    expect(results).toHaveLength(2);
    // Should be the 2 newest
    expect(results[0].created_at).toBe(5000);
    expect(results[1].created_at).toBe(4000);
  });

  it("defaults to limit 50", () => {
    const agent = seedAgent();
    // Insert 3 entries — all should be returned with default limit
    for (let i = 1; i <= 3; i++) {
      seedEntry(agent.id, { text: `Entry ${i}`, created_at: i * 1000 });
    }

    const results = q.getEntriesByAgent(agent.id);
    expect(results).toHaveLength(3);
  });

  it("returns correct EntrySummary shape with parsed tags and reply_count", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id, {
      text: "Full text",
      summary: "Short summary",
      entry_type: "insight",
      mood: "focused",
      tags: JSON.stringify(["typescript", "db"]),
      created_at: 5000,
    });

    q.insertReply({
      post_id: entry.id,
      agent_id: agent.id,
      text: "Reply 1",
      created_at: 6000,
    });

    const results = q.getEntriesByAgent(agent.id);
    expect(results).toHaveLength(1);

    const s = results[0];
    expect(s.id).toBe(entry.id);
    expect(s.agent_id).toBe(agent.id);
    expect(s.project).toBe("proj");
    expect(s.summary).toBe("Short summary");
    expect(s.entry_type).toBe("insight");
    expect(s.mood).toBe("focused");
    expect(s.tags).toEqual(["typescript", "db"]);
    expect(s.likes).toBe(0);
    expect(s.reply_count).toBe(1);
    expect(s.created_at).toBe(5000);
  });

  it("returns empty array for agent with no entries", () => {
    seedAgent({ id: "proj/lonely", project: "proj" });
    const results = q.getEntriesByAgent("proj/lonely");
    expect(results).toHaveLength(0);
  });
});

// ── Search ───────────────────────────────────────────────────────────

describe("searchEntries", () => {
  it("searches entries via FTS", () => {
    const agent = seedAgent();
    seedEntry(agent.id, { text: "SQLite is a great embedded database" });
    seedEntry(agent.id, { text: "React hooks are powerful" });

    const results = q.searchEntries("sqlite");
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain("SQLite");
  });

  it("respects before cursor in search", () => {
    const agent = seedAgent();
    seedEntry(agent.id, {
      text: "SQLite first mention",
      created_at: 1000,
    });
    seedEntry(agent.id, {
      text: "SQLite second mention",
      created_at: 2000,
    });

    const results = q.searchEntries("sqlite", 50, 2000);
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain("first");
  });
});

// ── Replies ───────────────────────────────────────────────────────────

describe("replies", () => {
  it("threads replies under an entry", () => {
    const author = seedAgent({ id: "proj/author", project: "proj" });
    const replier = seedAgent({
      id: "proj/replier",
      project: "proj",
      avatar_seed: "seed2",
    });

    const entry = seedEntry(author.id, { text: "Discussion topic" });

    q.insertReply({
      post_id: entry.id,
      agent_id: replier.id,
      text: "Great point!",
      created_at: 1000,
    });
    q.insertReply({
      post_id: entry.id,
      agent_id: author.id,
      text: "Thanks!",
      created_at: 2000,
    });

    const replies = q.getReplies(entry.id);
    expect(replies).toHaveLength(2);
    expect(replies[0].text).toBe("Great point!");
    expect(replies[0].agent.id).toBe("proj/replier");
    expect(replies[1].text).toBe("Thanks!");
    expect(replies[1].agent.id).toBe("proj/author");
  });

  it("replies appear in entry detail", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id);
    q.insertReply({
      post_id: entry.id,
      agent_id: agent.id,
      text: "Self-reply",
      created_at: 1000,
    });

    const detail = q.getEntry(entry.id);
    expect(detail!.replies).toHaveLength(1);
    expect(detail!.replies[0].text).toBe("Self-reply");
    expect(detail!.replies[0].agent.id).toBe(agent.id);
  });

  it("reply agent includes v2 fields", () => {
    const agent = seedAgent();
    const now = Date.now();
    q.updateAgentStatus(agent.id, "active", "replying", now);

    const entry = seedEntry(agent.id);
    q.insertReply({
      post_id: entry.id,
      agent_id: agent.id,
      text: "Hello",
      created_at: now,
    });

    const replies = q.getReplies(entry.id);
    expect(replies[0].agent.status).toBe("active");
    expect(replies[0].agent.current_task).toBe("replying");
  });
});

// ── Reactions ─────────────────────────────────────────────────────────

describe("reactions", () => {
  it("adds reactions and increments likes", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id);

    const reaction = q.insertReaction({
      post_id: entry.id,
      agent_id: agent.id,
      emoji: "\u2665",
      created_at: 1000,
    });
    expect(reaction).toBeDefined();
    expect(reaction!.emoji).toBe("\u2665");

    q.incrementLikes(entry.id);

    const detail = q.getEntry(entry.id);
    expect(detail!.likes).toBe(1);
    expect(detail!.reactions).toHaveLength(1);
    expect(detail!.reactions[0].emoji).toBe("\u2665");
  });

  it("prevents duplicate reactions (same entry, agent, emoji)", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id);

    const first = q.insertReaction({
      post_id: entry.id,
      agent_id: agent.id,
      emoji: "\u2665",
      created_at: 1000,
    });
    expect(first).toBeDefined();

    // Duplicate should be ignored
    const duplicate = q.insertReaction({
      post_id: entry.id,
      agent_id: agent.id,
      emoji: "\u2665",
      created_at: 2000,
    });
    expect(duplicate).toBeUndefined();

    // But different emoji is allowed
    const different = q.insertReaction({
      post_id: entry.id,
      agent_id: agent.id,
      emoji: "\uD83D\uDD25",
      created_at: 3000,
    });
    expect(different).toBeDefined();

    const reactions = q.getReactions(entry.id);
    expect(reactions).toHaveLength(2);
  });

  it("allows different agents to react with same emoji", () => {
    const agent1 = seedAgent({ id: "proj/a1", project: "proj" });
    const agent2 = seedAgent({
      id: "proj/a2",
      project: "proj",
      avatar_seed: "seed2",
    });
    const entry = seedEntry(agent1.id);

    q.insertReaction({
      post_id: entry.id,
      agent_id: agent1.id,
      emoji: "\u2665",
      created_at: 1000,
    });
    q.insertReaction({
      post_id: entry.id,
      agent_id: agent2.id,
      emoji: "\u2665",
      created_at: 2000,
    });

    const reactions = q.getReactions(entry.id);
    expect(reactions).toHaveLength(2);
  });

  it("reactions appear in entry detail", () => {
    const agent = seedAgent();
    const entry = seedEntry(agent.id);

    q.insertReaction({
      post_id: entry.id,
      agent_id: agent.id,
      emoji: "\uD83C\uDF89",
      created_at: 1000,
    });

    const detail = q.getEntry(entry.id);
    expect(detail!.reactions).toHaveLength(1);
    expect(detail!.reactions[0].emoji).toBe("\uD83C\uDF89");
  });
});

// ── Claims ───────────────────────────────────────────────────────────

describe("claims", () => {
  it("inserts and retrieves active claims", () => {
    const agent = seedAgent();
    const now = Date.now();

    const claim = q.insertClaim({
      agent_id: agent.id,
      scope: "src/db/queries.ts",
      scope_type: "file",
      claimed_at: now,
      expires_at: now + 3600_000, // 1 hour
      status: "active",
    });

    expect(claim.id).toBe(1);
    expect(claim.scope).toBe("src/db/queries.ts");
    expect(claim.scope_type).toBe("file");
    expect(claim.status).toBe("active");

    const active = q.getActiveClaims(now);
    expect(active).toHaveLength(1);
    expect(active[0].scope).toBe("src/db/queries.ts");
    expect(active[0].agent.id).toBe(agent.id);
  });

  it("excludes expired claims", () => {
    const agent = seedAgent();
    const now = Date.now();

    // Active claim
    q.insertClaim({
      agent_id: agent.id,
      scope: "active-scope",
      scope_type: "area",
      claimed_at: now,
      expires_at: now + 3600_000,
      status: "active",
    });

    // Expired claim
    q.insertClaim({
      agent_id: agent.id,
      scope: "expired-scope",
      scope_type: "area",
      claimed_at: now - 7200_000,
      expires_at: now - 1, // already expired
      status: "active",
    });

    const active = q.getActiveClaims(now);
    expect(active).toHaveLength(1);
    expect(active[0].scope).toBe("active-scope");
  });

  it("releases a claim", () => {
    const agent = seedAgent();
    const now = Date.now();

    const claim = q.insertClaim({
      agent_id: agent.id,
      scope: "src/",
      scope_type: "module",
      claimed_at: now,
      expires_at: now + 3600_000,
      status: "active",
    });

    q.releaseClaim(claim.id);

    const active = q.getActiveClaims(now);
    expect(active).toHaveLength(0);
  });

  it("finds claims by scope - file exact match", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.insertClaim({
      agent_id: agent.id,
      scope: "src/db/queries.ts",
      scope_type: "file",
      claimed_at: now,
      expires_at: now + 3600_000,
      status: "active",
    });

    const matches = q.getClaimsByScope("src/db/queries.ts", now);
    expect(matches).toHaveLength(1);

    const noMatch = q.getClaimsByScope("src/db/other.ts", now);
    expect(noMatch).toHaveLength(0);
  });

  it("finds claims by scope - module prefix match", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.insertClaim({
      agent_id: agent.id,
      scope: "src/db/",
      scope_type: "module",
      claimed_at: now,
      expires_at: now + 3600_000,
      status: "active",
    });

    // Searching for a file within the module should match
    const matches = q.getClaimsByScope("src/db/queries.ts", now);
    expect(matches).toHaveLength(1);

    // Searching for the parent should also match (reverse prefix)
    const parentMatch = q.getClaimsByScope("src/", now);
    expect(parentMatch).toHaveLength(1);

    // Unrelated module should not match
    const noMatch = q.getClaimsByScope("lib/utils/", now);
    expect(noMatch).toHaveLength(0);
  });

  it("finds claims by scope - area fuzzy match", () => {
    const agent = seedAgent();
    const now = Date.now();

    q.insertClaim({
      agent_id: agent.id,
      scope: "authentication",
      scope_type: "area",
      claimed_at: now,
      expires_at: now + 3600_000,
      status: "active",
    });

    // String containment: scope includes query
    const matches = q.getClaimsByScope("auth", now);
    expect(matches).toHaveLength(1);

    // Reverse containment: query includes scope
    const reverseMatch = q.getClaimsByScope("authentication system", now);
    expect(reverseMatch).toHaveLength(1);

    // No containment
    const noMatch = q.getClaimsByScope("database", now);
    expect(noMatch).toHaveLength(0);
  });
});

// ── Digests ──────────────────────────────────────────────────────────

describe("digests", () => {
  it("upserts and retrieves a digest", () => {
    const now = Date.now();

    q.upsertDigest({
      scope: "openrajya-os",
      scope_type: "project",
      summary: "Working on browser automation and portal scraping",
      entry_count: 15,
      last_entry_id: 42,
      updated_at: now,
    });

    const digest = q.getDigest("openrajya-os", "project");
    expect(digest).toBeDefined();
    expect(digest!.scope).toBe("openrajya-os");
    expect(digest!.scope_type).toBe("project");
    expect(digest!.summary).toBe(
      "Working on browser automation and portal scraping",
    );
    expect(digest!.entry_count).toBe(15);
    expect(digest!.last_entry_id).toBe(42);
    expect(digest!.updated_at).toBe(now);
  });

  it("upsert overwrites existing digest for same scope+scope_type", () => {
    const now = Date.now();

    q.upsertDigest({
      scope: "agent-board",
      scope_type: "project",
      summary: "Initial setup",
      entry_count: 5,
      last_entry_id: 10,
      updated_at: now,
    });

    q.upsertDigest({
      scope: "agent-board",
      scope_type: "project",
      summary: "Added v2 schema and queries",
      entry_count: 12,
      last_entry_id: 25,
      updated_at: now + 1000,
    });

    const digest = q.getDigest("agent-board", "project");
    expect(digest!.summary).toBe("Added v2 schema and queries");
    expect(digest!.entry_count).toBe(12);
    expect(digest!.last_entry_id).toBe(25);
  });

  it("returns undefined for missing digest", () => {
    expect(q.getDigest("nonexistent", "project")).toBeUndefined();
  });

  it("gets all digests ordered by updated_at DESC", () => {
    const now = Date.now();

    q.upsertDigest({
      scope: "proj-a",
      scope_type: "project",
      summary: "Summary A",
      entry_count: 1,
      last_entry_id: 1,
      updated_at: now - 1000,
    });

    q.upsertDigest({
      scope: "proj-b",
      scope_type: "project",
      summary: "Summary B",
      entry_count: 2,
      last_entry_id: 2,
      updated_at: now,
    });

    q.upsertDigest({
      scope: "sqlite",
      scope_type: "tag",
      summary: "SQLite-related entries",
      entry_count: 3,
      last_entry_id: 3,
      updated_at: now + 1000,
    });

    const all = q.getAllDigests();
    expect(all).toHaveLength(3);
    // Ordered by updated_at DESC
    expect(all[0].scope).toBe("sqlite");
    expect(all[1].scope).toBe("proj-b");
    expect(all[2].scope).toBe("proj-a");
  });

  it("allows same scope with different scope_types", () => {
    const now = Date.now();

    q.upsertDigest({
      scope: "agent-board",
      scope_type: "project",
      summary: "Project digest",
      entry_count: 10,
      last_entry_id: 20,
      updated_at: now,
    });

    q.upsertDigest({
      scope: "agent-board",
      scope_type: "tag",
      summary: "Tag digest",
      entry_count: 3,
      last_entry_id: 5,
      updated_at: now,
    });

    const projectDigest = q.getDigest("agent-board", "project");
    const tagDigest = q.getDigest("agent-board", "tag");

    expect(projectDigest!.summary).toBe("Project digest");
    expect(tagDigest!.summary).toBe("Tag digest");

    const all = q.getAllDigests();
    expect(all).toHaveLength(2);
  });
});

// ── Syntheses ────────────────────────────────────────────────────────

describe("syntheses", () => {
  it("upsertSynthesis inserts and updates", () => {
    q.upsertSynthesis({
      project: "proj", topic: "sqlite-concurrency", synthesis_type: "topic",
      summary: "Mutex + retry is the consensus.", entry_ids: "[1,2,3]",
      entry_count: 3, last_entry_id: 3, created_at: 1000, updated_at: 1000,
    });
    const all = q.getSynthesesByProject("proj");
    expect(all).toHaveLength(1);
    expect(all[0].summary).toBe("Mutex + retry is the consensus.");
    expect(all[0].entry_ids).toEqual([1, 2, 3]);

    // Update
    q.upsertSynthesis({
      project: "proj", topic: "sqlite-concurrency", synthesis_type: "topic",
      summary: "Updated consensus.", entry_ids: "[1,2,3,4]",
      entry_count: 4, last_entry_id: 4, created_at: 1000, updated_at: 2000,
    });
    const updated = q.getSynthesesByProject("proj");
    expect(updated).toHaveLength(1);
    expect(updated[0].summary).toBe("Updated consensus.");
  });

  it("getLatestSynthesisEntryId returns watermark", () => {
    expect(q.getLatestSynthesisEntryId("proj")).toBe(0);
    q.upsertSynthesis({
      project: "proj", topic: "t1", synthesis_type: "topic",
      summary: "s", entry_ids: "[5]", entry_count: 1, last_entry_id: 5,
      created_at: 1000, updated_at: 1000,
    });
    expect(q.getLatestSynthesisEntryId("proj")).toBe(5);
  });
});

// ── Agent Memory ─────────────────────────────────────────────────────

describe("agent_memory", () => {
  it("upsertAgentMemory inserts and retrieves", () => {
    // Need an agent first
    q.upsertAgent({ id: "proj/test-agent", project: "proj", agent_type: null, avatar_seed: "abc", first_seen: 1000, last_seen: 1000 });

    q.upsertAgentMemory({
      agent_id: "proj/test-agent",
      knowledge_brief: "You worked on sqlite concurrency.",
      expertise: '{"sqlite": 5, "docker": 2}',
      top_scopes: '["src/db/"]',
      entry_count: 7, last_entry_id: 10, updated_at: 1000,
    });

    const mem = q.getAgentMemory("proj/test-agent");
    expect(mem).toBeDefined();
    expect(mem!.knowledge_brief).toBe("You worked on sqlite concurrency.");
    expect(mem!.expertise).toEqual({ sqlite: 5, docker: 2 });
    expect(mem!.top_scopes).toEqual(["src/db/"]);
  });

  it("getAgentMemory returns undefined for unknown agent", () => {
    expect(q.getAgentMemory("unknown")).toBeUndefined();
  });
});

// ── Nudges ────────────────────────────────────────────────────────────

describe("nudges", () => {
  it("insertNudge and getNudgedEntryIds", () => {
    q.upsertAgent({ id: "proj/a1", project: "proj", agent_type: null, avatar_seed: "a1" });
    const now = Math.floor(Date.now() / 1000);
    const e1 = q.insertEntry({
      agent_id: "proj/a1", text: "Test", summary: "Test", entry_type: "bugfix",
      scope: null, mood: null, code_block: null, screenshot: null, tags: null, created_at: now,
    });

    q.insertNudge({ agent_id: "proj/a1", entry_id: e1.id, reason: "similar bug", created_at: now });

    const nudgedIds = q.getNudgedEntryIds("proj/a1");
    expect(nudgedIds).toContain(e1.id);
    expect(nudgedIds.length).toBe(1);
  });

  it("insertNudge ignores duplicates", () => {
    q.upsertAgent({ id: "proj/a1", project: "proj", agent_type: null, avatar_seed: "a1" });
    const now = Math.floor(Date.now() / 1000);
    const e1 = q.insertEntry({
      agent_id: "proj/a1", text: "Test", summary: "Test", entry_type: "bugfix",
      scope: null, mood: null, code_block: null, screenshot: null, tags: null, created_at: now,
    });

    q.insertNudge({ agent_id: "proj/a1", entry_id: e1.id, reason: "reason1", created_at: now });
    q.insertNudge({ agent_id: "proj/a1", entry_id: e1.id, reason: "reason2", created_at: now }); // duplicate — ignored

    const nudgedIds = q.getNudgedEntryIds("proj/a1");
    expect(nudgedIds.length).toBe(1);
  });

  it("getEngagedEntryIds returns reacted and replied entries", () => {
    q.upsertAgent({ id: "proj/a1", project: "proj", agent_type: null, avatar_seed: "a1" });
    q.upsertAgent({ id: "proj/a2", project: "proj", agent_type: null, avatar_seed: "a2" });
    const now = Math.floor(Date.now() / 1000);

    const e1 = q.insertEntry({
      agent_id: "proj/a2", text: "Post 1", summary: "Post 1", entry_type: "bugfix",
      scope: null, mood: null, code_block: null, screenshot: null, tags: null, created_at: now,
    });
    const e2 = q.insertEntry({
      agent_id: "proj/a2", text: "Post 2", summary: "Post 2", entry_type: "shipped",
      scope: null, mood: null, code_block: null, screenshot: null, tags: null, created_at: now,
    });

    // a1 reacts to e1
    q.insertReaction({ post_id: e1.id, agent_id: "proj/a1", emoji: "\uD83D\uDC40" });
    // a1 replies to e2
    q.insertReply({ post_id: e2.id, agent_id: "proj/a1", text: "Nice!", created_at: now });

    const engaged = q.getEngagedEntryIds("proj/a1");
    expect(engaged).toContain(e1.id);
    expect(engaged).toContain(e2.id);
    expect(engaged.length).toBe(2);
  });

  it("markNudgeEngaged updates engaged_at", () => {
    q.upsertAgent({ id: "proj/a1", project: "proj", agent_type: null, avatar_seed: "a1" });
    const now = Math.floor(Date.now() / 1000);
    const e1 = q.insertEntry({
      agent_id: "proj/a1", text: "Test", summary: "Test", entry_type: "bugfix",
      scope: null, mood: null, code_block: null, screenshot: null, tags: null, created_at: now,
    });

    q.insertNudge({ agent_id: "proj/a1", entry_id: e1.id, reason: "test", created_at: now });
    q.markNudgeEngaged("proj/a1", e1.id, now + 100);

    // Verify by re-querying — engaged nudges should still appear in getNudgedEntryIds
    const nudged = q.getNudgedEntryIds("proj/a1");
    expect(nudged).toContain(e1.id);
  });
});

// ── Analytics ─────────────────────────────────────────────────────────

describe("analytics", () => {
  it("getAnalytics returns activity, agents, types, and expertise data", () => {
    // Setup: create two agents
    q.upsertAgent({ id: "proj/a1", project: "proj", agent_type: null, avatar_seed: "a1" });
    q.upsertAgent({ id: "proj/a2", project: "proj", agent_type: null, avatar_seed: "a2" });

    const now = Math.floor(Date.now() / 1000);

    // Insert entries from both agents
    const e1 = q.insertEntry({
      agent_id: "proj/a1", text: "Fixed a bug", summary: "Fixed a bug",
      entry_type: "bugfix", scope: null, mood: null, code_block: null,
      screenshot: null, tags: '["sqlite"]', created_at: now,
    });
    const e2 = q.insertEntry({
      agent_id: "proj/a1", text: "Shipped feature", summary: "Shipped feature",
      entry_type: "shipped", scope: null, mood: null, code_block: null,
      screenshot: null, tags: '["frontend"]', created_at: now - 86400,
    });
    q.insertEntry({
      agent_id: "proj/a2", text: "Discovery about perf", summary: "Discovery about perf",
      entry_type: "discovery", scope: null, mood: null, code_block: null,
      screenshot: null, tags: '["perf"]', created_at: now,
    });

    // Add a reaction
    q.insertReaction({ post_id: e1.id, agent_id: "proj/a2", emoji: "\uD83D\uDD27" });

    // Add agent memory for expertise
    q.upsertAgentMemory({
      agent_id: "proj/a1",
      knowledge_brief: "Test brief",
      expertise: JSON.stringify({ sqlite: 5, frontend: 3 }),
      top_scopes: JSON.stringify(["sqlite", "frontend"]),
      entry_count: 2,
      last_entry_id: e2.id,
      updated_at: now,
    });

    const analytics = q.getAnalytics(30);

    // Activity: should have entries for today and yesterday
    expect(analytics.activity.length).toBeGreaterThanOrEqual(2);
    expect(analytics.activity.some(a => a.count > 0)).toBe(true);

    // Agents: both agents should appear
    expect(analytics.agents.length).toBe(2);
    const a1 = analytics.agents.find(a => a.agent_id === "proj/a1");
    expect(a1).toBeDefined();
    expect(a1!.entries).toBe(2);

    // Types: should have bugfix, shipped, discovery
    expect(analytics.types.length).toBe(3);
    expect(analytics.types.some(t => t.entry_type === "bugfix" && t.count === 1)).toBe(true);

    // Expertise: should have proj/a1 with parsed tags
    expect(analytics.expertise.length).toBeGreaterThanOrEqual(1);
    const exp = analytics.expertise.find(e => e.agent_id === "proj/a1");
    expect(exp).toBeDefined();
    expect(exp!.tags.sqlite).toBe(5);
  });

  it("getAnalytics returns empty arrays when no data", () => {
    const analytics = q.getAnalytics(30);
    expect(analytics.activity).toEqual([]);
    expect(analytics.agents).toEqual([]);
    expect(analytics.types).toEqual([]);
    expect(analytics.expertise).toEqual([]);
  });
});

// ── getProjectStats ────────────────────────────────────────────────────

describe("getProjectStats", () => {
  it("returns per-project totals and today counts", () => {
    const now = Math.floor(Date.now() / 1000);
    const oldTs = now - 100000; // well outside 24h window

    // proj-a: agent-a1 posts one entry today, one old
    const agentA1 = seedAgent({ id: "proj-a/agent-a1", project: "proj-a" });
    seedEntry(agentA1.id, { created_at: now });
    seedEntry(agentA1.id, { created_at: oldTs });

    // proj-b: agent-b1 posts one entry today
    const agentB1 = seedAgent({ id: "proj-b/agent-b1", project: "proj-b" });
    seedEntry(agentB1.id, { created_at: now });

    const stats = q.getProjectStats(now);

    // Should have exactly 2 projects
    expect(stats).toHaveLength(2);

    // proj-a has 2 total entries, 1 today
    const projA = stats.find((s) => s.project === "proj-a");
    expect(projA).toBeDefined();
    expect(projA!.total).toBe(2);
    expect(projA!.today).toBe(1);

    // proj-b has 1 total entry, 1 today
    const projB = stats.find((s) => s.project === "proj-b");
    expect(projB).toBeDefined();
    expect(projB!.total).toBe(1);
    expect(projB!.today).toBe(1);

    // Ordered by total DESC — proj-a (2) before proj-b (1)
    expect(stats[0].project).toBe("proj-a");
    expect(stats[1].project).toBe("proj-b");
  });

  it("returns empty array when no entries exist", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(q.getProjectStats(now)).toEqual([]);
  });
});

// ── getInYourProjects ─────────────────────────────────────────────────

describe("getInYourProjects", () => {
  it("returns recent un-engaged posts by other agents in the same project", () => {
    // 3 agents in the same project
    const selfAgent = seedAgent({ id: "myproj/self", project: "myproj" });
    const otherAgent = seedAgent({ id: "myproj/other", project: "myproj", avatar_seed: "seed2" });
    const thirdAgent = seedAgent({ id: "myproj/third", project: "myproj", avatar_seed: "seed3" });

    const now = Math.floor(Date.now() / 1000);

    // 1. Own post — should NOT appear
    seedEntry(selfAgent.id, {
      text: "My own post",
      summary: "My own post",
      entry_type: "insight",
      created_at: now - 100,
    });

    // 2. Other agent's recent post — SHOULD appear
    const recentPost = seedEntry(otherAgent.id, {
      text: "Recent post by other",
      summary: "Recent post summary",
      entry_type: "bugfix",
      created_at: now - 3600, // 1 hour ago
    });

    // 3. Old post >48h — should NOT appear
    seedEntry(thirdAgent.id, {
      text: "Very old post",
      summary: "Old post summary",
      entry_type: "discovery",
      created_at: now - 48 * 3600 - 1, // just over 48 hours ago
    });

    // 4. Post already reacted to — should NOT appear
    const reactedPost = seedEntry(thirdAgent.id, {
      text: "Post I already reacted to",
      summary: "Reacted post summary",
      entry_type: "shipped",
      created_at: now - 7200, // 2 hours ago, still recent
    });
    q.insertReaction({
      post_id: reactedPost.id,
      agent_id: selfAgent.id,
      emoji: "👍",
      created_at: now,
    });

    // 5. Post already replied to — should NOT appear
    const repliedPost = seedEntry(thirdAgent.id, {
      text: "Post I already replied to",
      summary: "Replied post summary",
      entry_type: "shipped",
      created_at: now - 1800, // 30 min ago, still recent
    });
    q.insertReply({
      post_id: repliedPost.id,
      agent_id: selfAgent.id,
      text: "My reply",
      created_at: now,
    });

    const results = q.getInYourProjects(selfAgent.id, "myproj", now, 50);

    // Only recentPost should appear
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(recentPost.id);
    expect(results[0].agent_id).toBe(otherAgent.id);
    expect(results[0].summary).toBe("Recent post summary");
    expect(results[0].entry_type).toBe("bugfix");
    expect(results[0].project).toBe("myproj");
    expect(results[0].created_at).toBe(now - 3600);
  });

  it("respects the limit parameter", () => {
    const selfAgent = seedAgent({ id: "limitproj/self", project: "limitproj" });
    const otherAgent = seedAgent({ id: "limitproj/other", project: "limitproj", avatar_seed: "seed2" });

    const now = Math.floor(Date.now() / 1000);

    // Insert 5 recent posts by other agent
    for (let i = 0; i < 5; i++) {
      seedEntry(otherAgent.id, {
        text: `Post ${i}`,
        summary: `Summary ${i}`,
        entry_type: "insight",
        created_at: now - i * 600, // 10 min apart
      });
    }

    const results = q.getInYourProjects(selfAgent.id, "limitproj", now, 3);
    expect(results).toHaveLength(3);
    // Should be newest first
    expect(results[0].created_at).toBeGreaterThan(results[1].created_at);
  });

  it("returns empty array when no posts in project", () => {
    const selfAgent = seedAgent({ id: "emptyproj/self", project: "emptyproj" });
    const now = Math.floor(Date.now() / 1000);

    const results = q.getInYourProjects(selfAgent.id, "emptyproj", now, 50);
    expect(results).toHaveLength(0);
  });

  it("does not return posts from other projects", () => {
    const selfAgent = seedAgent({ id: "proj-x/self", project: "proj-x" });
    const otherProjectAgent = seedAgent({ id: "proj-y/other", project: "proj-y", avatar_seed: "seed2" });

    const now = Math.floor(Date.now() / 1000);

    // Post in proj-y — should not appear for proj-x agent
    seedEntry(otherProjectAgent.id, {
      text: "Post in proj-y",
      summary: "Cross-project post",
      entry_type: "insight",
      created_at: now - 100,
    });

    const results = q.getInYourProjects(selfAgent.id, "proj-x", now, 50);
    expect(results).toHaveLength(0);
  });
});
