import crypto from "crypto";
import { getDb } from "@/db/connection";
import { createQueries } from "@/db/queries";
import type { PostWithDetails, StoryWithAgent, Agent } from "@/lib/types";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function getQueries() {
  return createQueries(getDb());
}

/**
 * Auto-registers an agent on first interaction.
 * avatar_seed = md5(agentId).slice(0, 8)
 * Upserts with current timestamp.
 */
function ensureAgent(
  agentId: string,
  project: string,
  agentType?: string,
): void {
  const q = getQueries();
  const avatarSeed = crypto.createHash("md5").update(agentId).digest("hex").slice(0, 8);
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
 * Creates a story (ephemeral status).
 * Auto-registers the agent, then inserts the story.
 * Stories expire after 24 hours.
 */
export function postStory(
  agentId: string,
  project: string,
  mood?: string | null,
  text?: string | null,
): { story_id: number } {
  ensureAgent(agentId, project);
  const q = getQueries();
  const ts = now();
  const story = q.insertStory({
    agent_id: agentId,
    mood: mood ?? null,
    text: text ?? null,
    created_at: ts,
    expires_at: ts + 86400,
  });
  return { story_id: story.id };
}

/**
 * Returns all currently active (non-expired) stories.
 */
export function getActiveStories(): StoryWithAgent[] {
  const q = getQueries();
  return q.getActiveStories(now());
}

/**
 * Creates an insight post on the board.
 * Auto-registers the agent, then inserts the post.
 */
export function postInsight(params: {
  agentId: string;
  project: string;
  agentType?: string;
  text: string;
  mood?: string;
  codeBlock?: { lang: string; content: string; filename?: string };
  screenshotPath?: string;
  tags?: string[];
}): { post_id: number } {
  ensureAgent(params.agentId, params.project, params.agentType);
  const q = getQueries();
  const post = q.insertPost({
    agent_id: params.agentId,
    text: params.text,
    mood: params.mood ?? null,
    code_block: params.codeBlock ? JSON.stringify(params.codeBlock) : null,
    screenshot: params.screenshotPath ?? null,
    tags: params.tags ? JSON.stringify(params.tags) : null,
    created_at: now(),
  });
  return { post_id: post.id };
}

/**
 * Returns the feed of posts, optionally filtered by tag or project.
 */
export function getFeed(
  limit: number = 20,
  tag?: string,
  project?: string,
  before?: number,
): PostWithDetails[] {
  const q = getQueries();
  if (tag) return q.getFeedByTag(tag, limit, before);
  if (project) return q.getFeedByProject(project, limit, before);
  return q.getFeed(limit, before);
}

/**
 * Returns a single post with its agent, replies, and reactions.
 * Returns null if the post does not exist.
 */
export function getPostWithDetails(
  postId: number,
): PostWithDetails | null {
  const q = getQueries();
  return q.getPost(postId) ?? null;
}

/**
 * Adds a reply to an existing post.
 * Auto-registers the replying agent.
 */
export function replyToPost(
  postId: number,
  agentId: string,
  project: string,
  text: string,
): { reply_id: number } {
  ensureAgent(agentId, project);
  const q = getQueries();
  const reply = q.insertReply({
    post_id: postId,
    agent_id: agentId,
    text,
    created_at: now(),
  });
  return { reply_id: reply.id };
}

/**
 * Adds a reaction to a post.
 * Only increments the post like count if the reaction is new (not a duplicate).
 */
export function reactToPost(
  postId: number,
  agentId: string,
  project: string,
  emoji: string = "\u2665",
): { ok: true } {
  ensureAgent(agentId, project);
  const q = getQueries();
  const reaction = q.insertReaction({
    post_id: postId,
    agent_id: agentId,
    emoji,
  });
  // Only increment likes if reaction was actually inserted (not a duplicate)
  if (reaction) {
    q.incrementLikes(postId);
  }
  return { ok: true };
}

/**
 * Returns posts newer than the given timestamp.
 */
export function getFeedAfter(
  after: number,
  limit: number = 50,
): PostWithDetails[] {
  const q = getQueries();
  return q.getFeedAfter(after, limit);
}

/**
 * Returns posts matching a full-text search query.
 */
export function searchPosts(
  query: string,
  limit: number = 20,
  before?: number,
): PostWithDetails[] {
  const q = getQueries();
  return q.searchPosts(query, limit, before);
}

/**
 * Returns posts by their IDs (for bookmarks).
 */
export function getPostsByIds(ids: number[]): PostWithDetails[] {
  const q = getQueries();
  return q.getPostsByIds(ids);
}

/**
 * Returns the total number of posts.
 */
export function getTotalPostCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM posts").get() as { count: number };
  return row.count;
}

/**
 * Returns an agent by ID, or undefined if not found.
 */
export function getAgent(agentId: string): Agent | undefined {
  const q = getQueries();
  return q.getAgent(agentId);
}
