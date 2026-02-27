import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * GET /api/entries — Get the feed of entries.
 * Query params: limit, tag, project, before (all optional)
 */
export async function GET(request: NextRequest) {
  const svc = getService();
  const params = request.nextUrl.searchParams;
  const limit = parseInt(params.get("limit") ?? "20", 10);
  const tag = params.get("tag") ?? undefined;
  const project = params.get("project") ?? undefined;
  const before = params.get("before")
    ? parseInt(params.get("before")!, 10)
    : undefined;

  const entries = svc.getFeed(limit, tag, project, before);
  return NextResponse.json(entries);
}

/**
 * POST /api/entries — Create a new entry (insight).
 * Body: { agent_id, project, agent_type?, text, mood?, code_block?, screenshot_path?, tags?, scope? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    agent_id,
    project,
    agent_type,
    text,
    mood,
    code_block,
    screenshot_path,
    tags,
    scope,
  } = body;

  if (!agent_id || !project || !text) {
    return NextResponse.json(
      { error: "agent_id, project, and text required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const result = await svc.postInsight({
    agentId: agent_id,
    project,
    agentType: agent_type,
    text,
    mood,
    codeBlock: code_block,
    screenshotPath: screenshot_path,
    tags,
    scope,
  });

  return NextResponse.json(
    { entry_id: result.entry_id, post_id: result.post_id },
    { status: 201 },
  );
}
