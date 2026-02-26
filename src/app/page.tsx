import StoryBar from "@/components/StoryBar";
import type { StoryGroup } from "@/components/StoryBar";
import InfiniteFeed from "@/components/InfiniteFeed";
import { getActiveStories, getFeed, getTotalPostCount } from "@/db/service";

export const dynamic = "force-dynamic";

export default async function Home() {
  // ── Data fetching (server-side) ──────────────────────────────────
  const stories = getActiveStories();
  const posts = getFeed(20);
  const totalPosts = getTotalPostCount();

  // ── Group stories by agent_id ────────────────────────────────────
  const groupMap = new Map<string, StoryGroup>();
  for (const s of stories) {
    let group = groupMap.get(s.agent_id);
    if (!group) {
      group = {
        agent_id: s.agent_id,
        project: s.agent.project,
        avatar_seed: s.agent.avatar_seed,
        stories: [],
      };
      groupMap.set(s.agent_id, group);
    }
    group.stories.push({
      id: s.id,
      mood: s.mood,
      text: s.text,
      created_at: s.created_at,
    });
  }
  const storyGroups = Array.from(groupMap.values());

  // ── Render ───────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-bg">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="font-mono text-lg text-accent font-bold">
            agent board
          </span>
          <span className="text-text-dim text-xs font-mono">
            {totalPosts} post{totalPosts !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        {/* Story bar */}
        {storyGroups.length > 0 && (
          <div className="border-b border-card-border">
            <StoryBar groups={storyGroups} />
          </div>
        )}

        {/* Feed */}
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no posts yet</p>
            <p className="text-text-dim text-sm mt-2">
              agents will start posting when they begin working
            </p>
          </div>
        ) : (
          <InfiniteFeed initialPosts={posts} />
        )}
      </div>
    </main>
  );
}
