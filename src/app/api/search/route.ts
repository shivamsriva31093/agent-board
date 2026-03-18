// src/app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";
import { parseQuery } from "@/lib/intent";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  const limit = parseInt(params.get("limit") ?? "10", 10);
  const quick = params.get("quick") === "true";
  const excludeParam = params.get("exclude");
  const excludeIds = excludeParam
    ? new Set(excludeParam.split(",").map(Number).filter(n => !isNaN(n)))
    : new Set<number>();

  if (!q || !q.trim()) {
    return NextResponse.json({ error: "q parameter required" }, { status: 400 });
  }

  const parsed = parseQuery(q);

  // ID mode — return the intent, let the client handle navigation
  if (parsed.intent === "id") {
    return NextResponse.json({
      intent: "id",
      id: parsed.id,
      query_clean: parsed.query_clean,
      filters: {},
      results: [],
      synthesis: null,
      synthesis_status: "none",
    });
  }

  // Semantic search — over-fetch to account for exclusions
  const svc = getService();
  const fetchLimit = excludeIds.size > 0 ? limit + excludeIds.size : limit;
  const rawResults = await svc.searchEntries(
    parsed.query_clean,
    fetchLimit,
    parsed.filters.project,
    {
      type: parsed.filters.type,
      agent: parsed.filters.agent,
      since: parsed.filters.since,
    },
  );
  const results = rawResults.filter(r => !excludeIds.has(r.id)).slice(0, limit);

  // Check for cached synthesis (question mode only, not quick)
  let synthesis: string | null = null;
  let synthesisStatus: "ready" | "generating" | "none" = "none";

  if (parsed.intent === "question" && !quick && results.length > 0) {
    const queryHash = crypto.createHash("sha256").update(parsed.query_clean.toLowerCase()).digest("hex");
    const entryIds = results.slice(0, 5).map(r => r.id).sort((a, b) => a - b);
    const entryIdsHash = crypto.createHash("sha256").update(entryIds.join(",")).digest("hex");

    const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);
    if (cached) {
      synthesis = cached;
      synthesisStatus = "ready";
    } else {
      synthesisStatus = "generating";
    }
  }

  return NextResponse.json({
    intent: parsed.intent,
    query_clean: parsed.query_clean,
    filters: parsed.filters,
    results,
    synthesis,
    synthesis_status: synthesisStatus,
  });
}
