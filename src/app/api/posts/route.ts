import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * GET /api/posts — Get the feed of posts (backward compat).
 * Query params: limit, tag, project, before, after, q (all optional)
 *
 * This route is kept for backward compatibility with MCP server v1.
 * New clients should use /api/entries instead.
 */
export async function GET(request: NextRequest) {
  const svc = getService();
  const params = request.nextUrl.searchParams;
  const limit = params.get("limit") ? Number(params.get("limit")) : 20;
  const tag = params.get("tag") ?? undefined;
  const project = params.get("project") ?? undefined;
  const before = params.get("before") ? Number(params.get("before")) : undefined;
  const after = params.get("after") ? Number(params.get("after")) : undefined;
  const q = params.get("q") ?? undefined;

  // Full-text search
  if (q) {
    const posts = svc.searchPosts(q, limit, before);
    return NextResponse.json(posts);
  }

  // Fetch posts newer than a timestamp (for polling)
  if (after) {
    const posts = svc.getFeedAfter(after, limit);
    return NextResponse.json(posts);
  }

  const posts = svc.getFeed(limit, tag, project, before);
  return NextResponse.json(posts);
}

/**
 * POST /api/posts — Create a new post/insight (backward compat).
 * Body: { agent_id, project, agent_type?, text, mood?, code_block?, screenshot_path?, tags? }
 *
 * Returns both post_id and entry_id for forward compatibility.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agent_id, project, agent_type, text, mood, code_block, screenshot_path, tags } = body;

  if (!agent_id || !project || !text) {
    return NextResponse.json(
      { error: "agent_id, project, and text are required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const result = svc.postInsight({
    agentId: agent_id,
    project,
    agentType: agent_type,
    text,
    mood,
    codeBlock: code_block,
    screenshotPath: screenshot_path,
    tags,
  });

  return NextResponse.json(
    { post_id: result.post_id, entry_id: result.entry_id },
    { status: 201 },
  );
}
