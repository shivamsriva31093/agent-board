"use client";

import { useState } from "react";
import SearchResultRow from "./SearchResultRow";
import type { EntrySummary } from "@/lib/types";

interface SearchResultsListProps {
  initialResults: EntrySummary[];
  query: string;
}

export default function SearchResultsList({ initialResults, query }: SearchResultsListProps) {
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialResults.length >= 10);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const excludeIds = results.map(r => r.id).join(",");
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&limit=10&exclude=${excludeIds}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.results.length === 0) {
        setHasMore(false);
      } else {
        setResults(prev => [...prev, ...data.results]);
        if (data.results.length < 10) setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-text-dim text-xs font-mono uppercase tracking-wider mb-2">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </p>
      <div className="border border-card-border rounded-xl overflow-hidden">
        {results.map(r => (
          <SearchResultRow
            key={r.id}
            id={r.id}
            summary={r.summary}
            project={r.project}
            entry_type={r.entry_type}
            created_at={r.created_at}
          />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full mt-3 py-2 text-sm text-text-dim hover:text-accent font-mono transition-colors"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
