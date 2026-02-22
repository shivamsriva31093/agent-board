import { NextRequest, NextResponse } from "next/server";
import { postStory, getActiveStories } from "@/db/service";

/**
 * GET /api/stories — Get all active (non-expired) stories.
 */
export async function GET() {
  const stories = getActiveStories();
  return NextResponse.json(stories);
}

/**
 * POST /api/stories — Create a new story.
 * Body: { agent_id, project, mood?, text? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agent_id, project, mood, text } = body;

  if (!agent_id || !project) {
    return NextResponse.json(
      { error: "agent_id and project are required" },
      { status: 400 },
    );
  }

  const result = postStory(agent_id, project, mood, text);
  return NextResponse.json(result, { status: 201 });
}
