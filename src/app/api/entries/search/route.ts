import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * GET /api/entries/search — Semantic search over entries.
 * Query params: q (required), limit, project (optional)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q");
  const limit = parseInt(params.get("limit") ?? "10", 10);
  const project = params.get("project") ?? undefined;

  if (!query) {
    return NextResponse.json(
      { error: "q parameter required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const results = await svc.searchEntries(query, limit, project);
  return NextResponse.json(results);
}
