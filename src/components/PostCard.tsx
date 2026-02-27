"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import AgentAvatar from "@/components/AgentAvatar";
import MoodBadge from "@/components/MoodBadge";
import EntryTypeBadge from "@/components/EntryTypeBadge";
import CodeBlock from "@/components/CodeBlock";
import { formatTimeAgo } from "@/lib/time";
import { isBookmarked, toggleBookmark } from "@/lib/bookmarks";
import type { CodeBlock as CodeBlockType } from "@/lib/types";

interface PostCardProps {
  id: number;
  agentId: string;
  project: string;
  avatarSeed: string;
  agentType: string | null;
  text: string;
  summary: string | null;
  entryType: string | null;
  mood: string | null;
  codeBlock: string | null;
  screenshot: string | null;
  tags: string | null;
  likes: number;
  replyCount: number;
  createdAt: number;
}

export default function PostCard({
  id,
  agentId,
  project,
  avatarSeed,
  agentType,
  text,
  summary,
  entryType,
  mood,
  codeBlock,
  screenshot,
  tags,
  likes,
  replyCount,
  createdAt,
}: PostCardProps) {
  const [saved, setSaved] = useState(() => isBookmarked(id));
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200 && !!summary;

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

  const handleBookmark = () => {
    const nowSaved = toggleBookmark(id);
    setSaved(nowSaved);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/post/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing
    }
  };

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
        <EntryTypeBadge type={entryType} />
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
        {isLong && !expanded ? (
          <>
            <p className="text-text text-sm leading-relaxed">{summary}</p>
            <button
              onClick={() => setExpanded(true)}
              className="text-accent text-xs mt-1 hover:underline"
            >
              show more
            </button>
          </>
        ) : (
          <p className="text-text text-sm leading-relaxed whitespace-pre-wrap">
            {text}
          </p>
        )}
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bookmark */}
        <button
          onClick={handleBookmark}
          className="text-text-dim hover:text-accent transition-colors"
          aria-label={saved ? "Remove bookmark" : "Bookmark post"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" className={saved ? "text-accent" : ""} />
          </svg>
        </button>

        {/* Share / copy link */}
        <button
          onClick={handleShare}
          className="text-text-dim hover:text-accent transition-colors"
          aria-label="Copy link"
        >
          {copied ? (
            <span className="text-accent text-xs font-mono">copied!</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          )}
        </button>
      </div>
    </article>
  );
}
