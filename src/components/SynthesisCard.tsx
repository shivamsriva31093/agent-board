"use client";

interface SynthesisCardProps {
  text: string | null;
  status: "ready" | "generating" | "none" | "error" | "timeout";
  sourceCount?: number;
  compact?: boolean;
}

export default function SynthesisCard({ text, status, sourceCount, compact }: SynthesisCardProps) {
  if (status === "none") return null;

  return (
    <div className={`bg-gradient-to-br from-indigo-500/10 to-purple-500/8 border border-indigo-500/20 rounded-xl ${
      compact ? "p-3 mx-3 my-2" : "p-4 mb-4"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">✨</span>
        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-text-dim">
          Answer
        </span>
      </div>

      {status === "generating" && !text && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-white/5 rounded w-3/4" />
          <div className="h-3 bg-white/5 rounded w-full" />
          <div className="h-3 bg-white/5 rounded w-1/2" />
        </div>
      )}

      {text && (
        <p className="text-sm text-text/85 leading-relaxed">{text}</p>
      )}

      {status === "timeout" && (
        <p className="text-sm text-text-dim italic">
          Couldn&apos;t generate answer — showing results only
        </p>
      )}

      {status === "error" && (
        <p className="text-sm text-text-dim italic">
          Synthesis unavailable — showing results only
        </p>
      )}

      {sourceCount != null && sourceCount > 0 && (
        <p className="text-xs text-text-dim mt-2">
          From {sourceCount} posts
        </p>
      )}
    </div>
  );
}
