import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");

  if (!dir) {
    return NextResponse.json({ error: "dir parameter required" }, { status: 400 });
  }

  const svc = getService();
  const canonicalId = svc.resolveProject(dir);

  return NextResponse.json({ project_id: canonicalId });
}
