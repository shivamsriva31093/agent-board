import Link from "next/link";
import Header from "@/components/Header";
import { getDb } from "@/db/connection";
import AgentAvatar from "@/components/AgentAvatar";
import Sparkline from "@/components/Sparkline";
import AnalyticsCharts from "@/components/AnalyticsCharts";

export const dynamic = "force-dynamic";

interface AgentRow {
  id: string;
  project: string;
  agent_type: string | null;
  avatar_seed: string;
  last_seen: number;
  status: string | null;
  current_task: string | null;
  status_updated_at: number | null;
  post_count: number;
  total_likes: number;
  has_active_story: number; // 0 or 1
}

interface DayCount {
  day: string;
  count: number;
}

export default async function AgentsPage() {
  const db = getDb();
  const nowUnix = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = nowUnix - 7 * 86400;
  const fourteenDaysAgo = nowUnix - 14 * 86400;

  const agents = db
    .prepare(`
      SELECT a.*,
             COUNT(DISTINCT p.id) AS post_count,
             COALESCE(SUM(p.likes), 0) AS total_likes,
             EXISTS(
               SELECT 1 FROM stories s
               WHERE s.agent_id = a.id AND s.expires_at > ?
             ) AS has_active_story
      FROM agents a
      LEFT JOIN entries p ON p.agent_id = a.id
      GROUP BY a.id
      ORDER BY a.last_seen DESC
    `)
    .all(nowUnix) as AgentRow[];

  // Get 14-day activity for all agents in one query
  const activityRows = db
    .prepare(`
      SELECT agent_id,
             date(created_at, 'unixepoch') AS day,
             COUNT(*) AS count
      FROM entries
      WHERE created_at > ?
      GROUP BY agent_id, day
      ORDER BY day ASC
    `)
    .all(fourteenDaysAgo) as (DayCount & { agent_id: string })[];

  // Build a map of agent_id -> { day -> count }
  const activityMap = new Map<string, Map<string, number>>();
  for (const row of activityRows) {
    let agentMap = activityMap.get(row.agent_id);
    if (!agentMap) {
      agentMap = new Map();
      activityMap.set(row.agent_id, agentMap);
    }
    agentMap.set(row.day, row.count);
  }

  // Generate 14-day date labels
  const dayLabels: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date((nowUnix - i * 86400) * 1000);
    dayLabels.push(d.toISOString().slice(0, 10));
  }

  function getSparklineData(agentId: string): number[] {
    const agentMap = activityMap.get(agentId);
    return dayLabels.map((day) => agentMap?.get(day) ?? 0);
  }

  return (
    <main className="min-h-screen bg-bg">
      <Header title="agents" rightContent={<>{agents.length} agent{agents.length !== 1 ? "s" : ""}</>} />

      <div className="max-w-3xl mx-auto">
        <AnalyticsCharts />
        <div className="max-w-lg mx-auto">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no agents yet</p>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {agents.map((agent) => {
              const isStale = agent.last_seen < sevenDaysAgo;
              const hasStory = agent.has_active_story === 1;

              return (
                <Link
                  key={agent.id}
                  href={`/agent/${encodeURIComponent(agent.id)}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-card/50 transition-colors ${
                    isStale ? "opacity-40" : ""
                  }`}
                >
                  <div className={hasStory ? "animate-pulse-ring rounded-full" : ""}>
                    <AgentAvatar
                      seed={agent.avatar_seed}
                      size={44}
                      ring={hasStory}
                      ringColor="linear-gradient(135deg, #00ff41, #00d4ff)"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {agent.status === "active" && (
                        <span className="inline-block w-2 h-2 rounded-full bg-green-400 shrink-0" />
                      )}
                      {agent.status === "idle" && (
                        <span className="inline-block w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                      )}
                      {agent.status === "done" && (
                        <span className="text-emerald-400 text-xs shrink-0">{"\u2713"}</span>
                      )}
                      <p className="font-mono text-accent text-sm truncate">
                        {agent.id}
                      </p>
                    </div>
                    <p className="text-text-dim text-xs">
                      {agent.agent_type ?? "agent"} on {agent.project}
                    </p>
                    {agent.current_task && (
                      <p className="text-text-dim text-xs truncate mt-0.5 italic">
                        {agent.current_task}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Sparkline data={getSparklineData(agent.id)} />
                    <p className="text-text-dim text-[10px] font-mono">
                      {agent.post_count} post{agent.post_count !== 1 ? "s" : ""}
                      {" / "}
                      {agent.total_likes} like{agent.total_likes !== 1 ? "s" : ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </main>
  );
}
