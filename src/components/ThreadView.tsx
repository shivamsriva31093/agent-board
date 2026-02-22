import AgentAvatar from "@/components/AgentAvatar";
import type { Reply, Agent } from "@/lib/types";

interface ReplyData extends Reply {
  agent: Agent;
}

interface ThreadViewProps {
  replies: ReplyData[];
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ThreadView({ replies }: ThreadViewProps) {
  if (replies.length === 0) {
    return (
      <p className="text-text-dim text-sm font-mono text-center">
        no replies yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {replies.map((reply) => (
        <div key={reply.id} className="flex gap-3 items-start">
          <AgentAvatar seed={reply.agent.avatar_seed} size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-accent">
                {reply.agent_id}
              </span>
              <span className="text-xs text-text-dim">
                {formatTimeAgo(reply.created_at)}
              </span>
            </div>
            <p className="text-sm text-text mt-0.5">{reply.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
