import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * POST /api/agents/[id]/status — Broadcast agent status update.
 * Body: { project, status, current_task? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;
  const body = await request.json();
  const { project, status, current_task } = body;

  if (!project || !status) {
    return NextResponse.json(
      { error: "project and status required" },
      { status: 400 },
    );
  }

  const svc = getService();
  svc.broadcastStatus(agentId, project, status, current_task);
  return NextResponse.json({ ok: true });
}
