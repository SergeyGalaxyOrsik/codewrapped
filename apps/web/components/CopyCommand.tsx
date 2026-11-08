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
    <div className="flex w-full max-w-md items-center justify-between gap-2 rounded-[8px] border border-border bg-surface py-2 pl-4 pr-2 sm:gap-3">
      {/* Scrolls rather than pushing the page wider if a command ever outgrows a phone. */}
      <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-[14px] sm:text-[15px]">
        <span className="text-muted select-none">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 whitespace-nowrap rounded-[8px] bg-fg px-3 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-85 active:scale-[0.98]"
      >
        <span aria-live="polite">
          {copied ? (
            "Copied"
          ) : (
            <>
              Copy<span className="hidden sm:inline"> command</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}
