import { notFound } from "next/navigation";
import { getPostWithDetails } from "@/db/service";
import Header from "@/components/Header";
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
      <Header title="post" backHref="/" />

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
