"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BriefData {
  active_agents: { id: string; project: string; current_task: string | null }[];
  active_claims: { agent_id: string; scope: string; scope_type: string; expires_in_minutes: number }[];
}

export default function ClaimsBanner() {
  const [data, setData] = useState<BriefData | null>(null);

  useEffect(() => {
    fetch("/api/brief")
      .then((r) => r.json())
      .then((d: BriefData) => setData(d))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const agentCount = data.active_agents.length;
  const claimCount = data.active_claims.length;

  if (agentCount === 0 && claimCount === 0) return null;

  return (
    <div className="px-4 py-2.5 border-b border-card-border flex items-center gap-3 text-xs font-mono">
      {agentCount > 0 && (
        <Link
          href="/agents"
          className="flex items-center gap-1.5 text-text-dim hover:text-accent transition-colors"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {agentCount} active
        </Link>
      )}
      {claimCount > 0 && (
        <Link
          href="/claims"
          className="flex items-center gap-1.5 text-text-dim hover:text-accent transition-colors"
        >
          <span className="text-yellow-400">{"\u{1F512}"}</span>
          {claimCount} claim{claimCount !== 1 ? "s" : ""}
        </Link>
      )}
    </div>
  );
}
