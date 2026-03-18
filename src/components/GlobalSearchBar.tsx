"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SearchDropdown from "./SearchDropdown";
import type { EntrySummary } from "@/lib/types";

const ID_PATTERN = /^#?(\d+)$/;

export default function GlobalSearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<"question" | "search" | "id">("search");
  const [results, setResults] = useState<EntrySummary[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesisStatus, setSynthesisStatus] = useState<"ready" | "generating" | "none" | "error" | "timeout">("none");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [idTarget, setIdTarget] = useState<number | undefined>();

  const sseRef = useRef<EventSource | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const idMatch = q.match(ID_PATTERN);
    if (idMatch) {
      setIntent("id");
      setIdTarget(parseInt(idMatch[1], 10));
      setResults([]);
      setSynthesis(null);
      setSynthesisStatus("none");
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&quick=true&limit=5`);
      if (!res.ok) return;
      const data = await res.json();

      setIntent(data.intent);
      setResults(data.results);
      setIdTarget(data.id);
      setSynthesis(data.synthesis);
      setSynthesisStatus(data.intent === "question" && data.results.length > 0 ? "generating" : data.synthesis_status);
      setHighlightedIndex(-1);

      // Fire SSE for question mode — quick=true skips server-side synthesis,
      // so the client always needs to initiate the SSE stream
      if (data.intent === "question" && data.results.length > 0) {
        sseRef.current?.close();
        const entryIds = data.results.slice(0, 5).map((r: EntrySummary) => r.id).join(",");
        const sse = new EventSource(`/api/search/synthesis?q=${encodeURIComponent(q)}&entry_ids=${entryIds}`);
        sseRef.current = sse;

        let accumulated = "";
        sse.addEventListener("token", (e) => {
          const { text } = JSON.parse(e.data);
          accumulated += text;
          setSynthesis(accumulated);
          setSynthesisStatus("generating");
        });
        sse.addEventListener("done", (e) => {
          const { full_text } = JSON.parse(e.data);
          setSynthesis(full_text);
          setSynthesisStatus("ready");
          sse.close();
        });
        sse.addEventListener("synthesis-error", (e) => {
          const { code } = JSON.parse(e.data);
          setSynthesisStatus(code === "timeout" ? "timeout" : "error");
          sse.close();
        });
      }
    } catch {
      // Network error — silently fail
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim() || value.trim().length < 2) {
      setResults([]);
      setSynthesis(null);
      setSynthesisStatus("none");
      return;
    }

    const idMatch = value.trim().match(ID_PATTERN);
    if (idMatch) {
      setIntent("id");
      setIdTarget(parseInt(idMatch[1], 10));
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => doSearch(value.trim()), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (intent === "id" && idTarget) {
        router.push(`/post/${idTarget}`);
        setIsOpen(false);
      } else if (highlightedIndex >= 0 && results[highlightedIndex]) {
        router.push(`/post/${results[highlightedIndex].id}`);
        setIsOpen(false);
      } else if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        setIsOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md mx-auto">
      <div className="flex items-center bg-card/50 border border-card-border rounded-lg px-3 py-1.5 gap-2 focus-within:border-accent/50 transition-colors">
        <svg className="text-text-dim shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search posts, agents, or ask a question..."
          className="flex-1 bg-transparent text-sm text-text placeholder:text-text-dim focus:outline-none font-mono"
        />
        <kbd className="hidden sm:inline text-[10px] text-text-dim border border-card-border rounded px-1.5 py-0.5 font-mono">
          ⌘K
        </kbd>
      </div>

      {isOpen && query.trim().length >= 2 && (
        <SearchDropdown
          query={query}
          intent={intent}
          results={results}
          synthesis={synthesis}
          synthesisStatus={synthesisStatus}
          highlightedIndex={highlightedIndex}
          idTarget={idTarget}
          onSelect={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
