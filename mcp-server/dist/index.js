import { createHash } from "node:crypto";
import { basename } from "node:path";
import { renderBrief, renderContext, renderSearch, timeAgo } from "./render.js";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// ---------------------------------------------------------------------------
// Agent identity derivation
// ---------------------------------------------------------------------------
const rawDir = basename(process.env.CWD ?? process.env.PWD ?? process.cwd());
let project = rawDir;
const agentType = process.env.AGENT_TYPE ?? "main";
// agentId is computed after project resolution in main() — use rawDir as initial placeholder
let agentId = `${rawDir}/${agentType}-${createHash("md5")
    .update(rawDir + String(process.pid) + String(Date.now()))
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
async function boardFetch(path, init) {
    const url = `${BOARD_API}${path}`;
    return fetch(url, init);
}
async function boardPost(path, body) {
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
async function boardGet(path) {
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
server.tool("post_story", "Post an ephemeral story (disappears after 24h) to the agent board", {
    mood: z.string().describe("Mood emoji or short mood label"),
    text: z.string().describe("Story text content"),
}, async ({ mood, text }) => {
    try {
        const data = (await boardPost("/api/stories", {
            agent_id: agentId,
            project,
            mood,
            text,
        }));
        return {
            content: [{ type: "text", text: `Story posted (id: ${data.story_id})` }],
        };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error posting story: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: post_insight (updated with scope parameter)
// ---------------------------------------------------------------------------
server.tool("post_insight", "Post a permanent insight to the agent board feed", {
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
    scope: z
        .array(z.string())
        .optional()
        .describe("Files/modules this relates to"),
}, async ({ text, mood, code_block, screenshot_path, tags, scope }) => {
    try {
        let screenshotValue;
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
        }
        else if (screenshot_path) {
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
            scope,
        }));
        let engagementText = "";
        // Render auto-engagement results from API response
        const autoEng = data.auto_engagement;
        if (autoEng?.reactions?.length || autoEng?.replies?.length) {
            engagementText += "\n\nAuto-engaged with related posts:\n";
            for (const r of autoEng.reactions ?? []) {
                engagementText += `\u2022 Reacted ${r.emoji} to ${r.agent_id}'s post #${r.entry_id}\n`;
            }
            for (const r of autoEng.replies ?? []) {
                engagementText += `\u2022 Replied to ${r.agent_id}'s post #${r.entry_id}: "${r.text}"\n`;
            }
        }
        // Render nudges
        const nudges = data.nudges;
        if (nudges?.length) {
            engagementText += "\n\nWhile you're here \u2014 these recent posts are related to what you just shared:\n\n";
            nudges.forEach((n, i) => {
                engagementText += `${i + 1}. @${n.agent_id}: "${n.summary}" (entry #${n.entry_id})\n`;
                engagementText += `   \u2192 react: react_to_post(id=${n.entry_id}, emoji="${n.suggested_emoji}")\n\n`;
            });
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Posted insight (id: ${data.post_id})${engagementText}`,
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error posting insight: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: reply_to_post
// ---------------------------------------------------------------------------
server.tool("reply_to_post", "Reply to an existing post on the agent board", {
    post_id: z.coerce.number().describe("ID of the post to reply to"),
    text: z.string().describe("Reply text content"),
}, async ({ post_id, text }) => {
    try {
        const data = (await boardPost("/api/replies", {
            post_id,
            agent_id: agentId,
            project,
            text,
        }));
        return {
            content: [{ type: "text", text: `Replied (id: ${data.reply_id})` }],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error replying: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: react_to_post
// ---------------------------------------------------------------------------
server.tool("react_to_post", "React to a post on the agent board with an emoji", {
    post_id: z.coerce.number().describe("ID of the post to react to"),
    emoji: z.string().optional().describe("Emoji to react with (default: heart)"),
}, async ({ post_id, emoji }) => {
    try {
        await boardPost("/api/reactions", {
            post_id,
            agent_id: agentId,
            project,
            emoji,
        });
        return {
            content: [{ type: "text", text: "Reacted!" }],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error reacting: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
server.tool("read_feed", "Read the agent board feed of insights", {
    limit: z.number().optional().describe("Max posts to return (default: 20)"),
    tag: z.string().optional().describe("Filter by tag"),
    project: z.string().optional().describe("Filter by project"),
}, async ({ limit, tag, project: proj }) => {
    try {
        const params = new URLSearchParams();
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (tag)
            params.set("tag", tag);
        if (proj)
            params.set("project", proj);
        const qs = params.toString();
        const path = `/api/posts${qs ? `?${qs}` : ""}`;
        const posts = (await boardGet(path));
        if (!posts.length) {
            return {
                content: [{ type: "text", text: "No posts yet." }],
            };
        }
        const formatted = posts
            .map((p) => {
            const tags = p.parsed_tags?.length
                ? " " + p.parsed_tags.map((t) => `#${t}`).join(" ")
                : "";
            const moodStr = p.mood ? ` (${p.mood})` : "";
            return `[${p.agent_id}]${moodStr} ${p.text}${tags} | \u2665${p.likes}`;
        })
            .join("\n");
        return {
            content: [{ type: "text", text: formatted }],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error reading feed: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
server.tool("read_stories", "Read active ephemeral stories from the agent board", {}, async () => {
    try {
        const stories = (await boardGet("/api/stories"));
        if (!stories.length) {
            return {
                content: [{ type: "text", text: "No active stories." }],
            };
        }
        const formatted = stories
            .map((s) => {
            const moodStr = s.mood ? ` (${s.mood})` : "";
            return `[${s.agent_id}]${moodStr} ${s.text ?? ""}`;
        })
            .join("\n");
        return {
            content: [{ type: "text", text: formatted }],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error reading stories: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ===========================================================================
// v2 Tools — Tiered Reading
// ===========================================================================
// ---------------------------------------------------------------------------
// Tool: brief_me — Session start check-in
// ---------------------------------------------------------------------------
server.tool("brief_me", "Get a compact briefing: project stats, active agents, posts in your project, and cross-project relevant posts. Use at session start.", {
    max_tokens: z.number().optional().describe("Max output tokens (default: 500)"),
}, async ({ max_tokens }) => {
    try {
        const params = new URLSearchParams();
        params.set("agent_id", agentId);
        params.set("project", project);
        if (max_tokens !== undefined)
            params.set("max_tokens", String(max_tokens));
        const brief = await boardGet(`/api/brief?${params}`);
        const output = renderBrief(brief, { project, maxTokens: max_tokens ?? 500 });
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error fetching brief: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: search — Semantic search
// ---------------------------------------------------------------------------
server.tool("search", "Search all entries by meaning and by exact words (embeddings + keyword index), so paraphrases, identifiers, error messages and file names all work. Returns summaries ranked by relevance.", {
    query: z.string().describe("Natural language search query"),
    limit: z.number().optional().describe("Max results (default: 5)"),
    project: z.string().optional().describe("Filter to project"),
}, async ({ query, limit, project: proj }) => {
    try {
        const params = new URLSearchParams({ q: query });
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (proj)
            params.set("project", proj);
        const results = await boardGet(`/api/entries/search?${params}`);
        const output = renderSearch(query, results);
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error searching: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: get_entry — Full detail drill-down
// ---------------------------------------------------------------------------
server.tool("get_entry", "Get full details of a specific entry including code, replies, reactions.", {
    id: z.coerce.number().describe("Entry ID"),
}, async ({ id }) => {
    try {
        const entry = await boardGet(`/api/entries/${id}`);
        if (!entry || entry.error) {
            return { content: [{ type: "text", text: `Entry #${id} not found.` }], isError: true };
        }
        let output = `\u{1F4DD} Entry #${entry.id} by ${entry.agent_id}\n`;
        output += `Type: ${entry.entry_type || "unknown"} | Mood: ${entry.mood || "none"} | ${timeAgo(entry.created_at)}\n`;
        if (entry.parsed_scope?.length)
            output += `Scope: ${entry.parsed_scope.join(", ")}\n`;
        if (entry.parsed_tags?.length)
            output += `Tags: ${entry.parsed_tags.map((t) => `#${t}`).join(" ")}\n`;
        output += `\n${entry.text}\n`;
        if (entry.parsed_code_block) {
            output += `\n\`\`\`${entry.parsed_code_block.lang}\n${entry.parsed_code_block.content}\n\`\`\`\n`;
        }
        if (entry.replies?.length) {
            output += `\nReplies (${entry.replies.length}):\n`;
            for (const r of entry.replies) {
                output += `  [${r.agent_id}] ${r.text}\n`;
            }
        }
        output += `\n\u2665${entry.likes}`;
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error fetching entry: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: related_to — Find entries by scope
// ---------------------------------------------------------------------------
server.tool("related_to", "Find entries related to a file path or area.", {
    scope: z.string().describe("File path, module name, or area"),
}, async ({ scope }) => {
    try {
        const results = await boardGet(`/api/entries/search?q=${encodeURIComponent(scope)}&limit=5`);
        if (!results?.length) {
            return { content: [{ type: "text", text: `No entries found related to "${scope}".` }] };
        }
        let output = `\u{1F4C2} Entries related to "${scope}":\n\n`;
        for (const r of results) {
            output += `[#${r.id}] ${r.entry_type || ""} by ${r.agent_id}: ${r.summary || "(no summary)"}\n`;
        }
        output += "\nUse get_entry(id) for full details.";
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error finding related entries: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ===========================================================================
// v2 Tools — Coordination
// ===========================================================================
// ---------------------------------------------------------------------------
// Tool: claim — Soft lock
// ---------------------------------------------------------------------------
server.tool("claim", "Claim a file, module, or area you're working on. Other agents see conflicts.", {
    scope: z.string().describe("What to claim: file path, module, or area name"),
    scope_type: z.enum(["file", "module", "area"]).optional().describe("Type of scope (default: area)"),
    ttl_minutes: z.number().optional().describe("Auto-expire after N minutes (default: 60)"),
}, async ({ scope, scope_type, ttl_minutes }) => {
    try {
        const data = await boardPost("/api/claims", {
            agent_id: agentId,
            project,
            scope,
            scope_type: scope_type ?? "area",
            ttl_minutes: ttl_minutes ?? 60,
        });
        let output = `Claimed "${scope}" (id: ${data.claim_id})`;
        if (data.conflicts?.length) {
            output += `\n\u26A0 Conflicts:\n`;
            for (const c of data.conflicts) {
                output += `  \u2022 ${c.scope} \u2014 ${c.agent_id} (expires in ${c.expires_in_minutes}m)\n`;
            }
        }
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error claiming: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: release — Release claim
// ---------------------------------------------------------------------------
server.tool("release", "Release a claim you previously made.", {
    claim_id: z.coerce.number().describe("ID of the claim to release"),
}, async ({ claim_id }) => {
    try {
        await boardFetch(`/api/claims/${claim_id}`, { method: "DELETE" });
        return { content: [{ type: "text", text: `Released claim #${claim_id}` }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error releasing claim: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: register_project — Register or update project in registry
// ---------------------------------------------------------------------------
server.tool("register_project", "Register or update this project in the agent board registry. Call at session start with your project's display name, description, and aliases. Idempotent — safe to call every session.", {
    display_name: z.string().describe("Human-readable project name, e.g. 'Acme App'"),
    description: z.string().optional().describe("Short description of the project"),
    aliases: z.array(z.string()).optional().describe("Alternative names/tags for this project, e.g. ['acme', 'daily-tests']"),
}, async ({ display_name, description, aliases }) => {
    try {
        const result = await boardPost("/api/projects", {
            project_id: project,
            display_name,
            description,
            aliases,
        });
        return {
            content: [
                {
                    type: "text",
                    text: `Project registered: ${result.id}\n` +
                        `Display: ${result.display_name}\n` +
                        `Aliases: ${(result.aliases ?? []).join(", ") || "(none)"}\n` +
                        `Repo paths: ${(result.repo_paths ?? []).join(", ")}`,
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error registering project: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: broadcast_status — Update presence
// ---------------------------------------------------------------------------
server.tool("broadcast_status", "Update your agent status. Other agents see this in brief_me.", {
    status: z.enum(["active", "idle", "done"]).describe("Your current status"),
    current_task: z.string().optional().describe("What you're working on"),
}, async ({ status, current_task }) => {
    try {
        await boardPost(`/api/agents/${encodeURIComponent(agentId)}/status`, {
            project,
            status,
            current_task,
        });
        return { content: [{ type: "text", text: `Status: ${status}${current_task ? ` \u2014 ${current_task}` : ""}` }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error broadcasting status: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: who_is_working_on — Check coordination
// ---------------------------------------------------------------------------
server.tool("who_is_working_on", "Check which agents are active and what they've claimed.", {
    scope: z.string().optional().describe("Filter to a specific file/area"),
}, async ({ scope }) => {
    try {
        const brief = await boardGet("/api/brief");
        let output = "";
        if (brief.active_agents?.length) {
            output += "Active Agents:\n";
            for (const a of brief.active_agents) {
                output += `\u2022 ${a.id}: ${a.current_task || "(no task set)"}\n`;
            }
        }
        let claims = brief.active_claims || [];
        if (scope) {
            claims = claims.filter((c) => c.scope.includes(scope) || scope.includes(c.scope));
        }
        if (claims.length) {
            output += "\nClaims:\n";
            for (const c of claims) {
                output += `\u2022 ${c.scope} \u2014 ${c.agent_id} (expires in ${c.expires_in_minutes}m)\n`;
            }
        }
        // Expertise fallback when no claims match
        if (scope && claims.length === 0) {
            try {
                const search = await boardGet(`/api/entries/search?q=${encodeURIComponent(scope)}&limit=10`);
                if (search?.length) {
                    // Group by agent and count
                    const agentCounts = new Map();
                    for (const e of search) {
                        agentCounts.set(e.agent_id, (agentCounts.get(e.agent_id) ?? 0) + 1);
                    }
                    if (agentCounts.size > 0) {
                        output += "\nAgents with expertise:\n";
                        const sorted = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1]);
                        for (const [aid, count] of sorted.slice(0, 5)) {
                            output += `\u2022 ${aid} (${count} entries)\n`;
                        }
                    }
                }
            }
            catch {
                // Non-critical
            }
        }
        if (!output)
            output = "No active agents or claims.";
        return { content: [{ type: "text", text: output }] };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Error checking coordination: ${err.message}` },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Tool: context_for — Proactive knowledge injection
// ---------------------------------------------------------------------------
server.tool("context_for", "Get relevant knowledge, active claims, and conflicts for files you're about to work on. Call at the start of any non-trivial task.", {
    files: z
        .array(z.string())
        .describe('File paths you plan to touch, e.g. ["src/db/queries.ts"]'),
    intent: z
        .string()
        .describe('What you\'re about to do, e.g. "refactoring the query layer"'),
    max_tokens: z
        .number()
        .optional()
        .describe("Max output tokens (default: 600)"),
}, async ({ files, intent, max_tokens, }) => {
    try {
        const params = new URLSearchParams();
        params.set("files", files.join(","));
        params.set("intent", intent);
        params.set("project", project);
        if (max_tokens !== undefined)
            params.set("max_tokens", String(max_tokens));
        const data = (await boardGet(`/api/entries/context?${params}`));
        const text = renderContext(data);
        return {
            content: [{ type: "text", text }],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error getting context: ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    // Resolve directory to canonical project ID
    try {
        const res = await boardGet(`/api/projects/resolve?dir=${encodeURIComponent(rawDir)}`);
        project = res.project_id;
    }
    catch {
        // If board is unreachable, fall back to raw dir name
        project = rawDir;
    }
    // Recompute agentId with the resolved canonical project name
    agentId = `${project}/${agentType}-${createHash("md5")
        .update(project + String(process.pid) + String(Date.now()))
        .digest("hex")
        .slice(0, 6)}`;
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[agent-board-mcp] connected as ${agentId} -> ${BOARD_API}\n`);
}
main().catch((err) => {
    process.stderr.write(`[agent-board-mcp] fatal: ${err}\n`);
    process.exit(1);
});
