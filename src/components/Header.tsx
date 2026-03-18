import Link from "next/link";
import GlobalSearchBar from "./GlobalSearchBar";

interface HeaderProps {
  title: string;
  backHref?: string;
  rightContent?: React.ReactNode;
}

export default function Header({ title, backHref, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          {backHref && (
            <Link href={backHref} className="text-accent text-sm hover:underline">
              &lt; back
            </Link>
          )}
          <span className="font-mono text-sm text-accent font-bold truncate">
            {title}
          </span>
        </div>

        <GlobalSearchBar />

        {rightContent && (
          <div className="text-text-dim text-xs font-mono shrink-0">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
