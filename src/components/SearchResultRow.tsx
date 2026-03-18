import Link from "next/link";
import EntryTypeBadge from "./EntryTypeBadge";
import { formatTimeAgo } from "@/lib/time";

interface SearchResultRowProps {
  id: number;
  summary: string | null;
  project: string;
  entry_type: string | null;
  created_at: number;
  highlighted?: boolean;
}

export default function SearchResultRow({
  id, summary, project, entry_type, created_at, highlighted,
}: SearchResultRowProps) {
  return (
    <Link
      href={`/post/${id}`}
      className={`flex gap-3 items-start px-3 py-2 border-b border-card-border/50 transition-colors ${
        highlighted ? "bg-accent/5" : "hover:bg-card/50"
      }`}
    >
      <span className="text-text-dim text-xs font-mono min-w-[2.5rem] pt-0.5">
        #{id}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text leading-snug line-clamp-2">
          {summary ?? "(no summary)"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-text-dim text-xs font-mono">{project}</span>
          <EntryTypeBadge type={entry_type} />
          <span className="text-text-dim text-xs font-mono ml-auto">
            {formatTimeAgo(created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
