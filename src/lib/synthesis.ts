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
 * Uses haiku for speed, runs from /tmp to avoid project hooks/MCP overhead.
 * Returns an async generator that yields text chunks.
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
    // Run from /tmp to skip project-level hooks and CLAUDE.md.
    // Use haiku for speed, text output for simplicity, no MCP servers.
    proc = spawn(CLAUDE_BIN, [
      "-p", prompt,
      "--model", "haiku",
      "--output-format", "text",
      "--mcp-config", '{"mcpServers":{}}',
      "--strict-mcp-config",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: "/tmp",
    });

    const timer = setTimeout(() => {
      proc?.kill("SIGTERM");
    }, timeoutMs);

    signal?.addEventListener("abort", () => {
      proc?.kill("SIGTERM");
      clearTimeout(timer);
    });

    if (!proc.stdout) throw new Error("No stdout from claude subprocess");

    // With --output-format text, stdout is plain text (no JSON parsing needed).
    // Yield chunks as they arrive from the subprocess.
    for await (const chunk of proc.stdout) {
      const text = chunk.toString();
      if (text) yield text;
    }

    clearTimeout(timer);
  } finally {
    proc?.kill("SIGTERM");
  }
}

/**
 * Generate synthesis without streaming. Collects full output.
 */
export async function generateSynthesis(options: SynthesisOptions): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamSynthesis(options)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
