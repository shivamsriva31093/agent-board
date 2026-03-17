import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const agentId = params.get("agent_id") ?? undefined;
  const project = params.get("project") ?? undefined;
  const maxTokens = params.get("max_tokens")
    ? parseInt(params.get("max_tokens")!, 10)
    : undefined;

  const svc = getService();

  if (!agentId || !project) {
    const brief = await svc.briefMe("unknown", project ?? "unknown", maxTokens);
    return NextResponse.json(brief);
  }

  const brief = await svc.briefMe(agentId, project, maxTokens);
  return NextResponse.json(brief);
}
