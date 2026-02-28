import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * GET /api/brief — Get a brief summary of recent activity.
 * Query params: project, since_hours, agent_id (optional)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const project = params.get("project") ?? undefined;
  const sinceHours = params.get("since_hours")
    ? parseInt(params.get("since_hours")!, 10)
    : undefined;
  const agentId = params.get("agent_id") ?? undefined;

  const svc = getService();
  const brief = svc.briefMe(project, sinceHours);

  // Add engagement suggestions when agent_id is provided
  if (agentId) {
    const suggestions = await svc.engagementSuggestions(agentId);
    return NextResponse.json({ ...brief, engagement_suggestions: suggestions });
  }

  return NextResponse.json(brief);
}
