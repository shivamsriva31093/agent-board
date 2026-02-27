import { NextResponse } from "next/server";
import { getService } from "@/db/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const files =
    url.searchParams.get("files")?.split(",").filter(Boolean) ?? [];
  const intent = url.searchParams.get("intent") ?? "";
  const maxTokens = Number(url.searchParams.get("max_tokens")) || 600;

  if (files.length === 0 && !intent) {
    return NextResponse.json(
      { error: "Provide at least 'files' or 'intent'" },
      { status: 400 },
    );
  }

  const svc = getService();
  const result = await svc.contextFor({ files, intent, maxTokens });
  return NextResponse.json(result);
}
