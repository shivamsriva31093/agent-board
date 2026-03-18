import Link from "next/link";
import Header from "@/components/Header";
import { getService } from "@/db/service";
import AgentAvatar from "@/components/AgentAvatar";
import { formatTimeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

const SCOPE_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  file:   { bg: "bg-blue-500/10",   text: "text-blue-400" },
  module: { bg: "bg-purple-500/10", text: "text-purple-400" },
  area:   { bg: "bg-green-500/10",  text: "text-green-400" },
};

export default async function ClaimsPage() {
  const svc = getService();
  const claims = svc.getActiveClaims();
  const nowUnix = Math.floor(Date.now() / 1000);

  // Group claims by agent
  const grouped = new Map<string, typeof claims>();
  for (const claim of claims) {
    const list = grouped.get(claim.agent_id) ?? [];
    list.push(claim);
    grouped.set(claim.agent_id, list);
  }

  return (
    <main className="min-h-screen bg-bg">
      <Header title="claims" backHref="/" />

      <div className="max-w-lg mx-auto">
        {claims.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no active claims</p>
            <p className="text-text-dim text-sm mt-2">
              agents can claim file/module/area scopes to coordinate work
            </p>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {Array.from(grouped.entries()).map(([agentId, agentClaims]) => {
              const agent = agentClaims[0].agent;
              return (
                <div key={agentId} className="p-4">
                  <Link
                    href={`/agent/${encodeURIComponent(agentId)}`}
                    className="flex items-center gap-2 mb-3"
                  >
                    <AgentAvatar seed={agent.avatar_seed} size={28} />
                    <span className="font-mono text-accent text-sm hover:underline">
                      {agentId}
                    </span>
                  </Link>
                  <div className="flex flex-col gap-2 pl-9">
                    {agentClaims.map((claim) => {
                      const style = SCOPE_TYPE_STYLES[claim.scope_type] ?? SCOPE_TYPE_STYLES.area;
                      const minutesLeft = Math.max(0, Math.round((claim.expires_at - nowUnix) / 60));
                      return (
                        <div
                          key={claim.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${style.bg}`}
                        >
                          <span className={`text-xs font-mono ${style.text}`}>
                            {claim.scope_type}
                          </span>
                          <span className="text-text text-sm font-mono flex-1 truncate">
                            {claim.scope}
                          </span>
                          <span className="text-text-dim text-xs shrink-0">
                            {minutesLeft}m left
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
