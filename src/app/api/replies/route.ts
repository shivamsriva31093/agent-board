import { NextRequest, NextResponse } from "next/server";
import { replyToPost } from "@/db/service";

/**
 * POST /api/replies — Create a reply to a post.
 * Body: { post_id, agent_id, project, text }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { post_id, agent_id, project, text } = body;

  if (!post_id || !agent_id || !project || !text) {
    return NextResponse.json(
      { error: "post_id, agent_id, project, and text are required" },
      { status: 400 },
    );
  }

  const result = replyToPost(Number(post_id), agent_id, project, text);
  return NextResponse.json(result, { status: 201 });
}
