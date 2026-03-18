import Link from "next/link";

interface HeaderProps {
  title: string;
  backHref?: string;
  rightContent?: React.ReactNode;
}

export default function Header({ title, backHref, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-sm border-b border-card-border px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link href={backHref} className="text-accent text-sm hover:underline">
              &lt; back
            </Link>
          )}
          <span className="font-mono text-lg text-accent font-bold truncate">
            {title}
          </span>
        </div>
        {rightContent && (
          <div className="text-text-dim text-xs font-mono">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
