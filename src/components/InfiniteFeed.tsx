"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import PostCard from "@/components/PostCard";

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

interface InfiniteFeedProps {
  initialPosts: FeedPost[];
  tag?: string;
  project?: string;
  q?: string;
  pageSize?: number;
}

const POLL_INTERVAL = 15_000;

export default function InfiniteFeed({
  initialPosts,
  tag,
  project,
  q,
  pageSize = 20,
}: InfiniteFeedProps) {
  const [posts, setPosts] = useState(initialPosts);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialPosts.length < pageSize);
  const [newCount, setNewCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // Track the newest created_at we've seen
  const newestTs = useRef(initialPosts[0]?.created_at ?? 0);

  // Keep newestTs in sync when posts change
  useEffect(() => {
    if (posts[0]) newestTs.current = posts[0].created_at;
  }, [posts]);

  // ── Poll for new posts ───────────────────────────────────────────
  useEffect(() => {
    // Don't poll on filtered/search views
    if (tag || project || q) return;

    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/posts?limit=1`);
        const latest = (await res.json()) as FeedPost[];
        if (latest.length > 0 && latest[0].created_at > newestTs.current) {
          // Count how many new posts exist
          const countRes = await fetch(
            `/api/posts?limit=50&after=${newestTs.current}`,
          );
          const newPosts = (await countRes.json()) as FeedPost[];
          setNewCount(newPosts.length);
        }
      } catch {
        // ignore polling errors
      }
    };

    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [tag, project, q]);

  const showNewPosts = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/posts?limit=50&after=${newestTs.current}`,
      );
      const newPosts = (await res.json()) as FeedPost[];
      if (newPosts.length > 0) {
        setPosts((prev) => [...newPosts, ...prev]);
        newestTs.current = newPosts[0].created_at;
      }
    } catch {
      // ignore
    }
    setNewCount(0);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ── Load older posts (infinite scroll) ───────────────────────────
  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);

    const lastPost = posts[posts.length - 1];
    if (!lastPost) {
      setDone(true);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("before", String(lastPost.created_at));
    if (tag) params.set("tag", tag);
    if (project) params.set("project", project);
    if (q) params.set("q", q);

    try {
      const res = await fetch(`/api/posts?${params}`);
      const newPosts = (await res.json()) as FeedPost[];
      if (newPosts.length === 0) {
        setDone(true);
      } else {
        setPosts((prev) => [...prev, ...newPosts]);
        if (newPosts.length < pageSize) setDone(true);
      }
    } catch {
      // silently fail, user can scroll again to retry
    } finally {
      setLoading(false);
    }
  }, [posts, loading, done, tag, project, q, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="flex flex-col gap-4 p-4 relative">
      <div ref={topRef} />

      {/* New posts toast */}
      {newCount > 0 && (
        <button
          onClick={showNewPosts}
          className="sticky top-16 z-20 self-center px-4 py-2 rounded-full bg-accent text-bg text-xs font-mono font-bold shadow-lg shadow-accent/20 hover:brightness-110 transition-all animate-bounce-subtle"
        >
          {newCount} new post{newCount !== 1 ? "s" : ""}
        </button>
      )}

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

      {/* Sentinel for intersection observer */}
      {!done && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loading && (
            <span className="text-text-dim text-sm font-mono animate-pulse">
              loading...
            </span>
          )}
        </div>
      )}

      {done && posts.length > 0 && (
        <p className="text-text-dim text-xs font-mono text-center py-4">
          that&apos;s all for now
        </p>
      )}
    </div>
  );
}
