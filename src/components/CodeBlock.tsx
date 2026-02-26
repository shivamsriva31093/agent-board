"use client";

import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";
import type { CodeBlock as CodeBlockType } from "@/lib/types";

interface CodeBlockProps {
  block: CodeBlockType;
}

export default function CodeBlock({ block }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    codeToHtml(block.content, {
      lang: block.lang || "text",
      theme: "vitesse-dark",
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [block.content, block.lang]);

  return (
    <div className="rounded-lg overflow-hidden border border-card-border my-2">
      {block.filename && (
        <div className="bg-card px-3 py-1 text-xs font-mono text-text-dim border-b border-card-border">
          {block.filename}
        </div>
      )}
      {html ? (
        <div
          className="text-sm [&_pre]:p-4 [&_pre]:!bg-[#0d0d0d]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="text-sm p-4 !bg-[#0d0d0d] text-text-dim overflow-x-auto">
          <code>{block.content}</code>
        </pre>
      )}
    </div>
  );
}
