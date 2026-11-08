"use client";

import { useState } from "react";

export function CopyCommand({ command = "npx codewrapped" }: { command?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-[8px] border border-border bg-surface py-2 pl-4 pr-2">
      <code className="whitespace-nowrap font-mono text-[15px]">
        <span className="text-muted select-none">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 whitespace-nowrap rounded-[8px] bg-fg px-3 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-85"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
      </button>
    </div>
  );
}
