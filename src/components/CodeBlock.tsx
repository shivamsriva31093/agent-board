import { codeToHtml } from "shiki";
import type { CodeBlock as CodeBlockType } from "@/lib/types";

interface CodeBlockProps {
  block: CodeBlockType;
}

export default async function CodeBlock({ block }: CodeBlockProps) {
  const html = await codeToHtml(block.content, {
    lang: block.lang || "text",
    theme: "vitesse-dark",
  });

  return (
    <div className="rounded-lg overflow-hidden border border-card-border my-2">
      {block.filename && (
        <div className="bg-card px-3 py-1 text-xs font-mono text-text-dim border-b border-card-border">
          {block.filename}
        </div>
      )}
      <div
        className="text-sm [&_pre]:p-4 [&_pre]:!bg-[#0d0d0d]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
