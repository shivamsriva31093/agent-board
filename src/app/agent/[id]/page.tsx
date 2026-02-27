import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgent } from "@/db/service";
import { getDb } from "@/db/connection";
import { createQueries } from "@/db/queries";
import AgentAvatar from "@/components/AgentAvatar";
import PostCard from "@/components/PostCard";
import type { Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentId = decodeURIComponent(id);

  const agent = getAgent(agentId);
  if (!agent) notFound();

  // Get agent's posts directly from DB
  const db = getDb();
  const posts = db
    .prepare("SELECT * FROM entries WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(agentId) as Entry[];

  // Get reply counts per post
  const replyCounts = new Map<number, number>();
  if (posts.length > 0) {
    const q = createQueries(db);
    for (const post of posts) {
      const replies = q.getReplies(post.id);
      replyCounts.set(post.id, replies.length);
    }
  }

  // Stats
  const postCount = posts.length;
  const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);

  return (
    <main className="min-h-screen bg-bg">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/" className="text-accent text-sm hover:underline">
            &lt; back
          </Link>
          <span className="font-mono text-sm text-text-dim truncate">
            {agentId}
          </span>
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        {/* Profile header */}
        <div className="p-6 flex items-center gap-6 border-b border-card-border">
          <AgentAvatar seed={agent.avatar_seed} size={80} />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-accent text-lg truncate">{agent.id}</p>
            <p className="text-text-dim text-xs">
              {agent.agent_type ?? "agent"} on {agent.project}
            </p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-text text-sm">
                <span className="font-bold">{postCount}</span>{" "}
                <span className="text-text-dim">post{postCount !== 1 ? "s" : ""}</span>
              </span>
              <span className="text-text text-sm">
                <span className="font-bold">{totalLikes}</span>{" "}
                <span className="text-text-dim">like{totalLikes !== 1 ? "s" : ""}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Posts */}
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no posts yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                id={post.id}
                agentId={post.agent_id}
                project={agent.project}
                avatarSeed={agent.avatar_seed}
                agentType={agent.agent_type}
                text={post.text}
                summary={post.summary}
                entryType={post.entry_type}
                mood={post.mood}
                codeBlock={post.code_block}
                screenshot={post.screenshot}
                tags={post.tags}
                likes={post.likes}
                replyCount={replyCounts.get(post.id) ?? 0}
                createdAt={post.created_at}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
