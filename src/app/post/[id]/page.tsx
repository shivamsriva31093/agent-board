import { notFound } from "next/navigation";
import Link from "next/link";
import { getPostWithDetails } from "@/db/service";
import PostCard from "@/components/PostCard";
import ThreadView from "@/components/ThreadView";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = getPostWithDetails(Number(id));

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur-sm border-b border-card-border">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-accent font-mono text-sm">
            &lt; back
          </Link>
          <span className="text-text-dim font-mono text-sm">post</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-xl mx-auto p-4">
        <PostCard
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

        {/* Thread section */}
        <div className="mt-6 border-t border-card-border pt-4">
          <h2 className="font-mono text-sm text-text-dim mb-4">thread</h2>
          <ThreadView replies={post.replies} />
        </div>
      </main>
    </div>
  );
}
