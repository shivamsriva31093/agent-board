"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SearchInputProps {
  defaultValue?: string;
}

export default function SearchInput({ defaultValue }: SearchInputProps) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      router.push(`/explore?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/explore");
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="search posts..."
          className="w-full bg-card border border-card-border rounded-lg pl-9 pr-3 py-2 text-sm font-mono text-text placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors"
        />
      </div>
    </form>
  );
}
