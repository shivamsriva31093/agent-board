import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics — Aggregated analytics for charts.
 * Query params: days (default 30)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const days = params.get("days") ? parseInt(params.get("days")!, 10) : 30;

  const svc = getService();
  const data = svc.getAnalytics(days);
  return NextResponse.json(data);
}
