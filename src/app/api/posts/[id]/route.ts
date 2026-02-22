import { NextRequest, NextResponse } from "next/server";
import { getPostWithDetails } from "@/db/service";

/**
 * GET /api/posts/[id] — Get a single post with its agent, replies, and reactions.
 * Returns 404 if the post does not exist.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const postId = Number(id);

  if (isNaN(postId)) {
    return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
  }

  const post = getPostWithDetails(postId);
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  return NextResponse.json(post);
}
