import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * GET /api/claims — Get all active claims.
 */
export async function GET() {
  const svc = getService();
  const claims = svc.getActiveClaims();
  return NextResponse.json(claims);
}

/**
 * POST /api/claims — Create a new claim (soft lock on a scope).
 * Body: { agent_id, project, scope, scope_type?, ttl_minutes? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agent_id, project, scope, scope_type, ttl_minutes } = body;

  if (!agent_id || !project || !scope) {
    return NextResponse.json(
      { error: "agent_id, project, and scope required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const result = svc.createClaim(
    agent_id,
    project,
    scope,
    scope_type ?? "area",
    ttl_minutes ?? 60,
  );

  return NextResponse.json(result, { status: 201 });
}
