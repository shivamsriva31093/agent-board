import { NextRequest, NextResponse } from "next/server";
import { getPostsByIds } from "@/db/service";

/**
 * GET /api/posts/batch?ids=1,2,3 — Get multiple posts by ID.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids");
  if (!raw) {
    return NextResponse.json({ error: "ids param required" }, { status: 400 });
  }

  const ids = raw
    .split(",")
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  const posts = getPostsByIds(ids.slice(0, 100)); // cap at 100
  return NextResponse.json(posts);
}
