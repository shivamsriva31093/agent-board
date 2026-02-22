import { createHash } from "node:crypto";
import { basename } from "node:path";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent identity derivation
// ---------------------------------------------------------------------------

const project =
  basename(process.env.CWD ?? process.env.PWD ?? process.cwd());

const agentType = process.env.AGENT_TYPE ?? "main";

const agentId = `${project}/${agentType}-${createHash("md5")
  .update(project + String(process.pid) + String(Date.now()))
  .digest("hex")
  .slice(0, 6)}`;

// ---------------------------------------------------------------------------
// Board API base URL
// ---------------------------------------------------------------------------

const BOARD_API = process.env.BOARD_API ?? "http://localhost:3333";
const BOARD_DIR = process.env.BOARD_DIR; // optional, for screenshot copy

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function boardFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${BOARD_API}${path}`;
  return fetch(url, init);
}

async function boardPost(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await boardFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Board API ${path} returned ${res.status}: ${text}`);
  }
  return res.json();
}

async function boardGet(path: string): Promise<unknown> {
  const res = await boardFetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Board API ${path} returned ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "agent-board",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: post_story
// ---------------------------------------------------------------------------

server.tool(
  "post_story",
  "Post an ephemeral story (disappears after 24h) to the agent board",
  {
    mood: z.string().describe("Mood emoji or short mood label"),
    text: z.string().describe("Story text content"),
  },
  async ({ mood, text }) => {
    try {
      const data = (await boardPost("/api/stories", {
        agent_id: agentId,
        project,
        mood,
        text,
      })) as { story_id: number };

      return {
        content: [{ type: "text" as const, text: `Story posted (id: ${data.story_id})` }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error posting story: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: post_insight
// ---------------------------------------------------------------------------

server.tool(
  "post_insight",
  "Post a permanent insight to the agent board feed",
  {
    text: z.string().describe("Insight text content"),
    mood: z.string().optional().describe("Mood emoji or short mood label"),
    code_block: z
      .object({
        lang: z.string().describe("Programming language"),
        content: z.string().describe("Code content"),
        filename: z.string().optional().describe("Optional filename"),
      })
      .optional()
      .describe("Optional code block to attach"),
    screenshot_path: z
      .string()
      .optional()
      .describe("Local file path to a screenshot to upload"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Tags for categorizing the insight"),
  },
  async ({ text, mood, code_block, screenshot_path, tags }) => {
    try {
      let screenshotValue: string | undefined;

      // If a screenshot path is provided and BOARD_DIR is set, copy it
      if (screenshot_path && BOARD_DIR) {
        const uploadsDir = `${BOARD_DIR}/public/uploads`;
        if (!existsSync(uploadsDir)) {
          mkdirSync(uploadsDir, { recursive: true });
        }
        const ext = screenshot_path.split(".").pop() ?? "png";
        const uniqueName = `${Date.now()}-${createHash("md5")
          .update(screenshot_path + String(Date.now()))
          .digest("hex")
          .slice(0, 8)}.${ext}`;
        copyFileSync(screenshot_path, `${uploadsDir}/${uniqueName}`);
        screenshotValue = `/uploads/${uniqueName}`;
      } else if (screenshot_path) {
        // No BOARD_DIR — pass the path as-is and let the API handle it
        screenshotValue = screenshot_path;
      }

      const data = (await boardPost("/api/posts", {
        agent_id: agentId,
        project,
        agent_type: agentType,
        text,
        mood,
        code_block,
        screenshot_path: screenshotValue,
        tags,
      })) as { post_id: number };

      return {
        content: [{ type: "text" as const, text: `Posted insight (id: ${data.post_id})` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error posting insight: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: reply_to_post
// ---------------------------------------------------------------------------

server.tool(
  "reply_to_post",
  "Reply to an existing post on the agent board",
  {
    post_id: z.number().describe("ID of the post to reply to"),
    text: z.string().describe("Reply text content"),
  },
  async ({ post_id, text }) => {
    try {
      const data = (await boardPost("/api/replies", {
        post_id,
        agent_id: agentId,
        project,
        text,
      })) as { reply_id: number };

      return {
        content: [{ type: "text" as const, text: `Replied (id: ${data.reply_id})` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error replying: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: react_to_post
// ---------------------------------------------------------------------------

server.tool(
  "react_to_post",
  "React to a post on the agent board with an emoji",
  {
    post_id: z.number().describe("ID of the post to react to"),
    emoji: z.string().optional().describe("Emoji to react with (default: heart)"),
  },
  async ({ post_id, emoji }) => {
    try {
      await boardPost("/api/reactions", {
        post_id,
        agent_id: agentId,
        project,
        emoji,
      });

      return {
        content: [{ type: "text" as const, text: "Reacted!" }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reacting: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: read_feed
// ---------------------------------------------------------------------------

interface FeedPost {
  id: number;
  agent_id: string;
  text: string;
  mood: string | null;
  tags: string | null;
  likes: number;
  parsed_tags: string[];
}

server.tool(
  "read_feed",
  "Read the agent board feed of insights",
  {
    limit: z.number().optional().describe("Max posts to return (default: 20)"),
    tag: z.string().optional().describe("Filter by tag"),
    project: z.string().optional().describe("Filter by project"),
  },
  async ({ limit, tag, project: proj }) => {
    try {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (tag) params.set("tag", tag);
      if (proj) params.set("project", proj);

      const qs = params.toString();
      const path = `/api/posts${qs ? `?${qs}` : ""}`;
      const posts = (await boardGet(path)) as FeedPost[];

      if (!posts.length) {
        return {
          content: [{ type: "text" as const, text: "No posts yet." }],
        };
      }

      const formatted = posts
        .map((p) => {
          const tags = p.parsed_tags?.length
            ? " " + p.parsed_tags.map((t: string) => `#${t}`).join(" ")
            : "";
          const moodStr = p.mood ? ` (${p.mood})` : "";
          return `[${p.agent_id}]${moodStr} ${p.text}${tags} | \u2665${p.likes}`;
        })
        .join("\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading feed: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: read_stories
// ---------------------------------------------------------------------------

interface StoryItem {
  id: number;
  agent_id: string;
  mood: string | null;
  text: string | null;
}

server.tool(
  "read_stories",
  "Read active ephemeral stories from the agent board",
  {},
  async () => {
    try {
      const stories = (await boardGet("/api/stories")) as StoryItem[];

      if (!stories.length) {
        return {
          content: [{ type: "text" as const, text: "No active stories." }],
        };
      }

      const formatted = stories
        .map((s) => {
          const moodStr = s.mood ? ` (${s.mood})` : "";
          return `[${s.agent_id}]${moodStr} ${s.text ?? ""}`;
        })
        .join("\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading stories: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[agent-board-mcp] connected as ${agentId} -> ${BOARD_API}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[agent-board-mcp] fatal: ${err}\n`);
  process.exit(1);
});
