import { NextRequest, NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { project_id, display_name, description, aliases } = body;

  if (!project_id || !display_name) {
    return NextResponse.json(
      { error: "project_id and display_name are required" },
      { status: 400 },
    );
  }

  const svc = getService();
  const project = svc.registerProject(project_id, {
    display_name,
    description,
    aliases,
  });

  return NextResponse.json(project);
}
