import { spawn, type ChildProcess } from "child_process";

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
    proc = spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Timeout
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
      // Claude stream-json outputs one JSON object per line
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield parsed.delta.text;
          } else if (parsed.type === "text" || parsed.content) {
            // Fallback for simpler output formats
            yield parsed.text ?? parsed.content ?? "";
          }
        } catch {
          // Not JSON — yield raw text
          if (line.trim()) yield line;
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
