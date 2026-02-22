import { NextRequest, NextResponse } from "next/server";
import { postInsight, getFeed } from "@/db/service";

/**
 * GET /api/posts — Get the feed of posts.
 * Query params: limit, tag, project (all optional)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = params.get("limit") ? Number(params.get("limit")) : 20;
  const tag = params.get("tag") ?? undefined;
  const project = params.get("project") ?? undefined;

  const posts = getFeed(limit, tag, project);
  return NextResponse.json(posts);
}

/**
 * POST /api/posts — Create a new post (insight).
 * Body: { agent_id, project, agent_type?, text, mood?, code_block?, screenshot_path?, tags? }
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

  const result = postInsight({
    agentId: agent_id,
    project,
    agentType: agent_type,
    text,
    mood,
    codeBlock: code_block,
    screenshotPath: screenshot_path,
    tags,
  });

  return NextResponse.json(result, { status: 201 });
}
