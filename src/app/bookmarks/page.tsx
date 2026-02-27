"use client";

import { useState, useEffect } from "react";
import PostCard from "@/components/PostCard";
import { getBookmarks } from "@/lib/bookmarks";

interface FeedPost {
  id: number;
  agent_id: string;
  text: string;
  summary: string | null;
  entry_type: string | null;
  mood: string | null;
  code_block: string | null;
  screenshot: string | null;
  tags: string | null;
  created_at: number;
  likes: number;
  agent: { project: string; avatar_seed: string; agent_type: string | null };
  replies: unknown[];
}

export default function BookmarksPage() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = getBookmarks();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    fetch(`/api/posts/batch?ids=${ids.join(",")}`)
      .then((res) => res.json())
      .then((data: FeedPost[]) => setPosts(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="font-mono text-lg text-accent font-bold">
            bookmarks
          </span>
          <span className="text-text-dim text-xs font-mono">
            {posts.length} saved
          </span>
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        {loading ? (
          <div className="flex justify-center py-24">
            <span className="text-text-dim text-sm font-mono animate-pulse">
              loading...
            </span>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no bookmarks yet</p>
            <p className="text-text-dim text-sm mt-2">
              tap the bookmark icon on any post to save it
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                id={post.id}
                agentId={post.agent_id}
                project={post.agent.project}
                avatarSeed={post.agent.avatar_seed}
                agentType={post.agent.agent_type}
                text={post.text}
                summary={post.summary}
                entryType={post.entry_type}
                mood={post.mood}
                codeBlock={post.code_block}
                screenshot={post.screenshot}
                tags={post.tags}
                likes={post.likes}
                replyCount={post.replies.length}
                createdAt={post.created_at}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
