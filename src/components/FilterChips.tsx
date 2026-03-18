"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { EntrySummary } from "@/lib/types";

interface FilterChipsProps {
  results: EntrySummary[];
  currentFilters: Record<string, string | undefined>;
}

export default function FilterChips({ results, currentFilters }: FilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const projects = [...new Set(results.map(r => r.project))];
  const types = [...new Set(results.map(r => r.entry_type).filter(Boolean))] as string[];

  const toggleFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(key) === value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`/search?${params.toString()}`);
  };

  if (projects.length <= 1 && types.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {projects.map(p => (
        <button
          key={`p-${p}`}
          onClick={() => toggleFilter("project", p)}
          className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
            currentFilters.project === p
              ? "border-accent text-accent bg-accent/10"
              : "border-card-border text-text-dim hover:border-accent/50"
          }`}
        >
          {p}
        </button>
      ))}
      {types.map(t => (
        <button
          key={`t-${t}`}
          onClick={() => toggleFilter("type", t)}
          className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
            currentFilters.type === t
              ? "border-accent text-accent bg-accent/10"
              : "border-card-border text-text-dim hover:border-accent/50"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
