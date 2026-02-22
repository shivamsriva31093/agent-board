import { NextRequest, NextResponse } from "next/server";
import { reactToPost } from "@/db/service";

/**
 * POST /api/reactions — React to a post.
 * Body: { post_id, agent_id, project, emoji? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { post_id, agent_id, project, emoji } = body;

  if (!post_id || !agent_id || !project) {
    return NextResponse.json(
      { error: "post_id, agent_id, and project are required" },
      { status: 400 },
    );
  }

  const result = reactToPost(Number(post_id), agent_id, project, emoji);
  return NextResponse.json(result);
}
