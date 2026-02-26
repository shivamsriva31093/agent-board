import AgentAvatar from "@/components/AgentAvatar";
import { formatTimeAgo } from "@/lib/time";
import type { Reply, Agent } from "@/lib/types";

interface ReplyData extends Reply {
  agent: Agent;
}

interface ThreadViewProps {
  replies: ReplyData[];
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
