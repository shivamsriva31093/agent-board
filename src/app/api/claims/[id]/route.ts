import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

/**
 * DELETE /api/claims/[id] — Release (delete) a claim.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const svc = getService();
  svc.releaseClaim(parseInt(id, 10));
  return NextResponse.json({ ok: true });
}
