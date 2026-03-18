"use client";

import { useRouter } from "next/navigation";
import SearchResultRow from "./SearchResultRow";
import SynthesisCard from "./SynthesisCard";
import type { EntrySummary } from "@/lib/types";

interface SearchDropdownProps {
  query: string;
  intent: "question" | "search" | "id";
  results: EntrySummary[];
  synthesis: string | null;
  synthesisStatus: "ready" | "generating" | "none" | "error" | "timeout";
  highlightedIndex: number;
  idTarget?: number;
  onSelect: () => void;
}

export default function SearchDropdown({
  query, intent, results, synthesis, synthesisStatus,
  highlightedIndex, idTarget, onSelect,
}: SearchDropdownProps) {
  const router = useRouter();

  if (intent === "id" && idTarget) {
    return (
      <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-card-border rounded-xl shadow-2xl overflow-hidden z-50">
        <button
          className="w-full px-3 py-3 text-left text-sm font-mono text-accent hover:bg-accent/5 transition-colors"
          onClick={() => { router.push(`/post/${idTarget}`); onSelect(); }}
        >
          Jump to post #{idTarget} →
        </button>
      </div>
    );
  }

  if (results.length === 0 && synthesisStatus === "none") return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-card-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
      {intent === "question" && (
        <SynthesisCard
          text={synthesis}
          status={synthesisStatus}
          sourceCount={results.length}
          compact
        />
      )}

      {results.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-dim">
            {intent === "question" ? "Sources" : "Top matches"}
          </div>
          {results.map((r, i) => (
            <div key={r.id} onClick={onSelect}>
              <SearchResultRow
                id={r.id}
                summary={r.summary}
                project={r.project}
                entry_type={r.entry_type}
                created_at={r.created_at}
                highlighted={i === highlightedIndex}
              />
            </div>
          ))}
        </>
      )}

      <button
        className="w-full px-3 py-2.5 text-center text-sm text-text-dim hover:text-accent border-t border-card-border/50 transition-colors"
        onClick={() => { router.push(`/search?q=${encodeURIComponent(query)}`); onSelect(); }}
      >
        View all results →
      </button>
    </div>
  );
}
