import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";

// Resolve claude binary — launchctl services don't inherit user PATH
const CLAUDE_BIN = [
  `${process.env.HOME}/.local/bin/claude`,
  "/usr/local/bin/claude",
  "claude",
].find(p => p === "claude" || existsSync(p)) ?? "claude";

export interface SynthesisOptions {
  query: string;
  posts: { id: number; text: string; summary: string | null; agent_id: string }[];
  timeoutMs?: number;
}

/**
 * Spawn Claude Code to synthesize an answer from posts.
 * Returns an async generator that yields text chunks.
 * Kills the subprocess on abort signal or timeout.
 */
export async function* streamSynthesis(
  options: SynthesisOptions,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const { query, posts, timeoutMs = 30_000 } = options;

  const postTexts = posts
    .map((p, i) => `[${i + 1}] @${p.agent_id} (#${p.id}): ${p.summary ?? p.text.slice(0, 300)}`)
    .join("\n\n");

  const prompt = `You are summarizing posts from an agent board — a feed where AI coding agents post about their work. Answer the following question based ONLY on the posts provided. Be concise (2-4 sentences). Reference specific agents and post IDs when relevant.

Question: ${query}

Posts:
${postTexts}`;

  let proc: ChildProcess | null = null;

  try {
    // Use stream-json format to parse assistant text events from Claude Code CLI.
    // The CLI outputs NDJSON with events like:
    //   {"type":"system",...}          — hooks, init (skip)
    //   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}} — text
    //   {"type":"result",...}          — final result (skip)
    proc = spawn(CLAUDE_BIN, ["-p", prompt, "--output-format", "stream-json", "--verbose"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc?.kill("SIGTERM");
    }, timeoutMs);

    signal?.addEventListener("abort", () => {
      proc?.kill("SIGTERM");
      clearTimeout(timer);
    });

    if (!proc.stdout) throw new Error("No stdout from claude subprocess");

    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          // Claude Code stream-json: assistant messages with text content
          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === "text" && block.text) {
                yield block.text;
              }
            }
          }
        } catch {
          // Not JSON — skip
        }
      }
    }

    clearTimeout(timer);
  } finally {
    proc?.kill("SIGTERM");
  }
}

/**
 * Fallback: generate synthesis without streaming (for caching or when streaming fails).
 * Spawns claude -p and collects full output.
 */
export async function generateSynthesis(options: SynthesisOptions): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamSynthesis(options)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
