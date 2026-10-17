/**
 * Text rendering for MCP tool output. Pure functions with no imports, so
 * the board's tests can measure exactly what agents receive.
 * Input types are structural copies of the board API's JSON responses.
 */
export function timeAgo(unixSeconds) {
    const diff = Math.floor(Date.now() / 1000) - unixSeconds;
    if (diff < 60)
        return `${diff}s ago`;
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}
const MAX_STATS = 5;
const MAX_ACTIVE_AGENTS = 3;
const MAX_ACTIVE_CLAIMS = 3;
// Room left for the "(+N more)" notes when a section is cut short.
const NOTE_RESERVE = 8;
/** Conservative token estimate: English runs ~4 chars/token, ids and emoji denser. */
function estimateTokens(text) {
    return Math.ceil(text.length / 3);
}
/**
 * The service returns every project, agent and claim (the web UI counts
 * them); the brief an agent reads is capped here to fit `maxTokens`.
 */
export function renderBrief(brief, opts = {}) {
    const maxTokens = opts.maxTokens ?? 500;
    const isCurrent = (project) => project === opts.project;
    // Stats line: current project first, then projects active today; total counts everything.
    const stats = brief.stats ?? [];
    const totalPosts = stats.reduce((s, p) => s + p.total, 0);
    const orderedStats = [
        ...stats.filter((s) => isCurrent(s.project)),
        ...stats.filter((s) => !isCurrent(s.project) && s.today > 0),
        ...stats.filter((s) => !isCurrent(s.project) && s.today === 0),
    ];
    let statsLine = orderedStats
        .slice(0, MAX_STATS)
        .map((s) => s.today > 0 ? `${s.project}: ${s.total} (${s.today} today)` : `${s.project}: ${s.total}`)
        .join(" \u2022 ");
    if (stats.length > MAX_STATS)
        statsLine += ` +${stats.length - MAX_STATS} more`;
    let output = `\u{1F4CB} ${totalPosts} posts | ${statsLine}\n`;
    // Active agents + claims, current project's agents first
    const agents = brief.active_agents ?? [];
    const orderedAgents = [
        ...agents.filter((a) => isCurrent(a.id.split("/")[0])),
        ...agents.filter((a) => !isCurrent(a.id.split("/")[0])),
    ];
    const claims = brief.active_claims ?? [];
    const activeParts = [];
    for (const a of orderedAgents.slice(0, MAX_ACTIVE_AGENTS)) {
        const task = a.current_task ? ` \u2014 "${a.current_task}"` : "";
        activeParts.push(`${a.id}${task}`);
    }
    if (agents.length > MAX_ACTIVE_AGENTS)
        activeParts.push(`+${agents.length - MAX_ACTIVE_AGENTS} more agents`);
    for (const c of claims.slice(0, MAX_ACTIVE_CLAIMS)) {
        activeParts.push(`\u{1F512} ${c.scope} \u2014 ${c.agent_id} (${c.expires_in_minutes}m)`);
    }
    if (claims.length > MAX_ACTIVE_CLAIMS)
        activeParts.push(`+${claims.length - MAX_ACTIVE_CLAIMS} more claims`);
    if (activeParts.length > 0) {
        output += `\nActive: ${activeParts.join(" | ")}\n`;
    }
    // Entry sections, each cut off once the budget runs out
    const addSection = (header, lines) => {
        if (lines.length === 0)
            return;
        let chunk = header;
        let added = 0;
        for (const line of lines) {
            if (estimateTokens(output + chunk + line) > maxTokens - NOTE_RESERVE)
                break;
            chunk += line;
            added++;
        }
        if (added < lines.length)
            chunk += `(+${lines.length - added} more)\n`;
        output += chunk;
    };
    addSection(`\n\u{1F4CC} In your projects:\n`, (brief.in_your_projects ?? []).map((e, i) => `${i + 1}. @${e.agent_id}: ${e.summary} (${e.project}, ${timeAgo(e.created_at)}) #${e.id}\n`));
    addSection("\n\u{1F4E2} Mentions from other projects:\n", (brief.mentions ?? []).map((m) => {
        const type = m.entry_type ? ` [${m.entry_type}]` : "";
        return `  [#${m.id}]${type} ${m.project}: "${m.summary}" (${timeAgo(m.created_at)})\n`;
    }));
    addSection(`\n\u{1F4A1} Relevant to you:\n`, (brief.relevant_to_you ?? []).map((e, i) => `${i + 1}. ${e.summary} (${e.project}, ${timeAgo(e.created_at)}) #${e.id}\n`));
    if (!brief.stats?.length && !brief.active_agents?.length) {
        output += "No recent activity.";
    }
    return output;
}
export function renderSearch(query, results) {
    if (!results?.length) {
        return `No results for "${query}".`;
    }
    let output = `\u{1F50D} Results for "${query}" (${results.length} matches):\n\n`;
    for (const r of results) {
        const sim = r.similarity ? ` (${Math.round(r.similarity * 100)}% match)` : "";
        const tags = r.tags?.length ? " " + r.tags.map((t) => `#${t}`).join(" ") : "";
        const type = r.entry_type ? `${r.entry_type} ` : "";
        output += `[#${r.id}] ${type}by ${r.agent_id} (${timeAgo(r.created_at)}, ♥${r.likes})${sim}\n`;
        output += `  → ${r.summary || "(no summary)"}${tags}\n\n`;
    }
    output += "Use get_entry(id) for full details.";
    return output;
}
export function renderContext(data) {
    const nowSec = Math.floor(Date.now() / 1000);
    const lines = [];
    // Syntheses section
    if (data.syntheses?.length) {
        lines.push("**Synthesized knowledge:**");
        for (const s of data.syntheses) {
            const typeLabel = s.synthesis_type === "decision" ? "\u{1F4CB}" : "\u{1F4A1}";
            lines.push(`${typeLabel} ${s.topic}: ${s.summary}`);
        }
        lines.push("");
    }
    // Claims section
    if (data.claims.length > 0) {
        lines.push("**Claims:**");
        for (const c of data.claims) {
            const minsLeft = Math.max(0, Math.round((c.expires_at - nowSec) / 60));
            lines.push(`- ${c.agent_id} has "${c.scope}" claimed (${c.scope_type}, ${minsLeft}m left)`);
        }
        lines.push("");
    }
    // Conflicts section
    if (data.conflicts?.length > 0) {
        lines.push("**⚠ Potential conflicts:**");
        for (const c of data.conflicts) {
            const summaries = c.entries
                .map((e) => `#${e.id} (${e.entry_type ?? "note"}, ${timeAgo(e.created_at)}): "${e.summary ?? "(no summary)"}"`)
                .join(" ↔ ");
            lines.push(`- ${c.scope}: ${summaries}`);
        }
        lines.push("→ Use get_entry(id) to understand the full context");
        lines.push("");
    }
    // Entries section
    if (data.entries.length > 0) {
        lines.push("**Relevant knowledge:**");
        data.entries.forEach((e, i) => {
            const age = timeAgo(e.created_at);
            const type = e.entry_type ?? "note";
            const staleLabel = e.stale
                ? ` ⚠ stale${e.superseded_by ? ` → see #${e.superseded_by}` : ""}`
                : "";
            lines.push(`${i + 1}. [${type}, ${age}${staleLabel}] ${e.summary ?? "(no summary)"} (id:${e.id})`);
        });
        lines.push("");
    }
    if (data.claims.length === 0 && data.entries.length === 0) {
        lines.push("No relevant context found for these files.");
    }
    if (data.truncated) {
        lines.push("_(truncated to token budget — use get_entry for full details)_");
    }
    return lines.join("\n");
}
