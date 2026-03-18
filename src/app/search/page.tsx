import { getService } from "@/db/service";
import { parseQuery } from "@/lib/intent";
import Header from "@/components/Header";
import SynthesisCard from "@/components/SynthesisCard";
import FilterChips from "@/components/FilterChips";
import SearchResultsList from "@/components/SearchResultsList";
import crypto from "crypto";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string; type?: string }>;
}) {
  const { q, project, type } = await searchParams;

  if (!q) {
    return (
      <main className="min-h-screen bg-bg">
        <Header title="search" backHref="/" />
        <div className="max-w-lg mx-auto p-8 text-center">
          <p className="text-text-dim font-mono">Enter a search query to get started</p>
        </div>
      </main>
    );
  }

  const parsed = parseQuery(q);

  if (project) parsed.filters.project = project;
  if (type) parsed.filters.type = type;

  const svc = getService();
  const results = await svc.searchEntries(
    parsed.query_clean,
    20,
    parsed.filters.project,
    {
      type: parsed.filters.type,
      agent: parsed.filters.agent,
      since: parsed.filters.since,
    },
  );

  let synthesis: string | null = null;
  let synthesisStatus: "ready" | "generating" | "none" = "none";

  if (parsed.intent === "question" && results.length > 0) {
    const queryHash = crypto.createHash("sha256").update(parsed.query_clean.toLowerCase()).digest("hex");
    const entryIds = results.slice(0, 5).map(r => r.id).sort((a, b) => a - b);
    const entryIdsHash = crypto.createHash("sha256").update(entryIds.join(",")).digest("hex");

    const cached = svc.getCachedSynthesis(queryHash, entryIdsHash);
    if (cached) {
      synthesis = cached;
      synthesisStatus = "ready";
    } else {
      synthesisStatus = "generating";
    }
  }

  return (
    <main className="min-h-screen bg-bg">
      <Header title="search" backHref="/" />
      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-text-dim">Results for:</span>
          <span className="font-mono text-accent">&quot;{q}&quot;</span>
        </div>

        {parsed.intent === "question" && (
          <SynthesisCard
            text={synthesis}
            status={synthesisStatus}
            sourceCount={results.length}
          />
        )}

        <Suspense fallback={null}>
          <FilterChips results={results} currentFilters={parsed.filters} />
        </Suspense>

        {results.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-dim font-mono">No results found</p>
          </div>
        ) : (
          <SearchResultsList initialResults={results} query={q} />
        )}
      </div>
    </main>
  );
}
