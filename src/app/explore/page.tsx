import Link from "next/link";
import { getFeed, searchPosts } from "@/db/service";
import { getDb } from "@/db/connection";
import InfiniteFeed from "@/components/InfiniteFeed";
import SearchInput from "@/components/SearchInput";

export const dynamic = "force-dynamic";

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; project?: string; q?: string }>;
}) {
  const { tag, project, q } = await searchParams;

  // Get filtered feed or search results
  const posts = q
    ? searchPosts(q, 20)
    : getFeed(20, tag, project);

  // Get all tags from posts for tag cloud
  const db = getDb();
  const tagRows = db
    .prepare("SELECT tags FROM posts WHERE tags IS NOT NULL")
    .all() as { tags: string }[];

  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    try {
      const parsed = JSON.parse(row.tags) as string[];
      for (const t of parsed) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  // Get all projects from agents table
  const projectRows = db
    .prepare("SELECT DISTINCT project FROM agents ORDER BY project ASC")
    .all() as { project: string }[];
  const projects = projectRows.map((r) => r.project);

  const hasFilter = !!(tag || project || q);

  return (
    <main className="min-h-screen bg-bg">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/" className="text-accent text-sm hover:underline">
            &lt; back
          </Link>
          <span className="font-mono text-lg text-accent font-bold">
            explore
          </span>
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        {/* Search input */}
        <div className="px-4 pt-3 pb-2">
          <SearchInput defaultValue={q} />
        </div>

        {/* Filters section */}
        {!q && (
          <div className="p-4 pt-2 border-b border-card-border">
            {/* Projects row */}
            {projects.length > 0 && (
              <div className="mb-4">
                <h3 className="text-text-dim text-xs font-mono uppercase tracking-wider mb-2">
                  projects
                </h3>
                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => (
                    <Link
                      key={p}
                      href={`/explore?project=${encodeURIComponent(p)}`}
                      className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
                        project === p
                          ? "border-accent text-accent bg-accent/10"
                          : "border-card-border text-text-dim hover:border-accent/50"
                      }`}
                    >
                      {p}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tags row */}
            {sortedTags.length > 0 && (
              <div>
                <h3 className="text-text-dim text-xs font-mono uppercase tracking-wider mb-2">
                  tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {sortedTags.map(([t, count]) => (
                    <Link
                      key={t}
                      href={`/explore?tag=${encodeURIComponent(t)}`}
                      className={`text-xs font-mono transition-colors ${
                        tag === t
                          ? "text-accent"
                          : "text-text-dim hover:text-accent"
                      }`}
                    >
                      #{t} ({count})
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active filter indicator */}
        {hasFilter && (
          <div className="px-4 py-2 border-b border-card-border flex items-center gap-2 text-sm">
            <span className="text-text-dim">
              {q ? "search:" : "filtered by:"}
            </span>
            {q && (
              <span className="font-mono text-accent">&quot;{q}&quot;</span>
            )}
            {tag && (
              <span className="font-mono text-accent">#{tag}</span>
            )}
            {project && (
              <span className="font-mono text-accent">{project}</span>
            )}
            <Link
              href="/explore"
              className="text-text-dim hover:text-accent text-xs underline ml-auto"
            >
              clear
            </Link>
          </div>
        )}

        {/* Results */}
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <p className="text-text-dim font-mono">no posts found</p>
            {hasFilter && (
              <Link
                href="/explore"
                className="text-accent text-sm mt-2 hover:underline"
              >
                clear filters
              </Link>
            )}
          </div>
        ) : (
          <InfiniteFeed initialPosts={posts} tag={tag} project={project} q={q} />
        )}
      </div>
    </main>
  );
}
