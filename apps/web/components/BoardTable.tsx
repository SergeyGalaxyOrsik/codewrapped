import Link from "next/link";
import type { Board } from "@/lib/api";
import { formatBoardValue } from "@/lib/board";
import { plainText } from "@/lib/text";

/** Rank, person and value. Avatars come from GitHub. */
export function BoardTable({ board, limit }: { board: Board; limit?: number }) {
  const rows = limit ? board.entries.slice(0, limit) : board.entries;
  return (
    <ol className="flex flex-col">
      {rows.map((e) => (
        <li key={e.handle} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
          {/* Left-aligned so the column starts on the page's left edge; 3ch fits rank 100. */}
          <span className="w-[3ch] shrink-0 font-mono text-[14px] text-muted">{e.rank}</span>
          {e.avatarUrl ? (
            <img src={e.avatarUrl} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full border border-border" />
          ) : (
            <span className="size-7 shrink-0 rounded-full border border-border bg-surface" />
          )}
          <Link href={`/@${e.handle}`} className="min-w-0 flex-1 truncate rounded-[8px] text-[15px] hover:underline hover:underline-offset-4">
            {plainText(e.displayName ?? "") || e.handle} <span className="text-muted">@{e.handle}</span>
          </Link>
          <span className="shrink-0 font-mono text-[15px]">{formatBoardValue(board.metric, e.value)}</span>
        </li>
      ))}
    </ol>
  );
}
