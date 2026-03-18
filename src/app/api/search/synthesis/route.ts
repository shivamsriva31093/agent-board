import { NextRequest } from "next/server";
import crypto from "crypto";
import { getService } from "@/db/service";
import { streamSynthesis } from "@/lib/synthesis";

// Simple in-memory rate limiter
const rateLimiter = new Map<string, number[]>();
const RATE_LIMIT = 5;  // max requests
const RATE_WINDOW = 60_000;  // per minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimiter.get(ip) ?? [];
  const recent = timestamps.filter(t => now - t < RATE_WINDOW);
  rateLimiter.set(ip, recent);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  return false;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";

  if (isRateLimited(ip)) {
    return new Response("Rate limited", { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  const entryIdsParam = params.get("entry_ids");

  if (!q || !entryIdsParam) {
    return new Response("q and entry_ids required", { status: 400 });
  }

  const entryIds = entryIdsParam.split(",").map(Number).filter(n => !isNaN(n));
  if (entryIds.length === 0) {
    return new Response("No valid entry_ids", { status: 400 });
  }

  // Check cache first
  const queryHash = crypto.createHash("sha256").update(q.toLowerCase().trim()).digest("hex");
  const sortedIds = [...entryIds].sort((a, b) => a - b);
  const entryIdsHash = crypto.createHash("sha256").update(sortedIds.join(",")).digest("hex");

  const svc = getService();
  const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);

  if (cached) {
    // Return cached as a single SSE event
    const encoder = new TextEncoder();
    const body = encoder.encode(
      `event: done\ndata: ${JSON.stringify({ full_text: cached, cached: true })}\n\n`
    );
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Fetch post content for synthesis context
  const posts = svc.getEntriesByIds(entryIds);

  // Stream synthesis via SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const chunks: string[] = [];
      const abortController = new AbortController();

      // Kill synthesis if client disconnects
      request.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      try {
        for await (const text of streamSynthesis(
          { query: q, posts, timeoutMs: 30_000 },
          abortController.signal,
        )) {
          chunks.push(text);
          controller.enqueue(
            encoder.encode(`event: token\ndata: ${JSON.stringify({ text })}\n\n`)
          );
        }

        const fullText = chunks.join("");

        // Cache the result
        svc.cacheSynthesis(queryHash, entryIdsHash, q, fullText, "claude-code");

        controller.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ full_text: fullText, cached: false })}\n\n`)
        );
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes("SIGTERM");
        const message = isTimeout ? "Synthesis timed out" : "Synthesis failed";
        const code = isTimeout ? "timeout" : "error";
        controller.enqueue(
          encoder.encode(`event: synthesis-error\ndata: ${JSON.stringify({ message, code })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
