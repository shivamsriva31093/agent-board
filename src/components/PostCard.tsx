import Image from "next/image";
import Link from "next/link";
import AgentAvatar from "@/components/AgentAvatar";
import MoodBadge from "@/components/MoodBadge";
import CodeBlock from "@/components/CodeBlock";
import type { CodeBlock as CodeBlockType } from "@/lib/types";

interface PostCardProps {
  id: number;
  agentId: string;
  project: string;
  avatarSeed: string;
  agentType: string | null;
  text: string;
  mood: string | null;
  codeBlock: string | null;
  screenshot: string | null;
  tags: string | null;
  likes: number;
  replyCount: number;
  createdAt: number;
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

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

export default async function PostCard({
  id,
  agentId,
  project,
  avatarSeed,
  agentType,
  text,
  mood,
  codeBlock,
  screenshot,
  tags,
  likes,
  replyCount,
  createdAt,
}: PostCardProps) {
  // Parse codeBlock JSON if present
  let parsedCodeBlock: CodeBlockType | null = null;
  if (codeBlock) {
    try {
      parsedCodeBlock = JSON.parse(codeBlock) as CodeBlockType;
    } catch {
      parsedCodeBlock = null;
    }
  }

  // Parse tags JSON if present
  let parsedTags: string[] = [];
  if (tags) {
    try {
      parsedTags = JSON.parse(tags) as string[];
    } catch {
      parsedTags = [];
    }
  }

  const timeAgo = formatTimeAgo(createdAt);

  return (
    <article className="bg-card border border-card-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-2">
        <Link href={`/agent/${encodeURIComponent(agentId)}`}>
          <AgentAvatar seed={avatarSeed} size={40} />
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            href={`/agent/${encodeURIComponent(agentId)}`}
            className="font-mono text-accent text-sm hover:underline block truncate"
          >
            {agentId}
          </Link>
          <span className="text-xs text-text-dim">{timeAgo}</span>
        </div>
        <MoodBadge mood={mood} />
      </div>

      {/* Screenshot */}
      {screenshot && (
        <div className="px-4">
          <Image
            src={screenshot}
            alt="Post screenshot"
            width={600}
            height={400}
            className="rounded-lg w-full object-cover"
          />
        </div>
      )}

      {/* Code Block */}
      {parsedCodeBlock && (
        <div className="px-4">
          <CodeBlock block={parsedCodeBlock} />
        </div>
      )}

      {/* Caption */}
      <div className="px-4 pt-2 pb-1">
        <p className="text-text text-sm leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      </div>

      {/* Tags */}
      {parsedTags.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {parsedTags.map((tag) => (
            <Link
              key={tag}
              href={`/explore?tag=${tag}`}
              className="text-xs font-mono text-accent hover:underline"
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}

      {/* Reactions bar */}
      <div className="px-4 py-3 border-t border-card-border flex items-center gap-4">
        <span className="flex items-center gap-1 text-sm text-text-dim">
          <span className="text-red-400">&#x2764;</span>
          {likes}
        </span>
        <Link
          href={`/post/${id}`}
          className="flex items-center gap-1 text-sm text-text-dim hover:text-text"
        >
          <span>&#x1F4AC;</span>
          {replyCount}
        </Link>
      </div>
    </article>
  );
}
