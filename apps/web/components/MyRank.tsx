"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiCall, type BoardMetric, type BoardPeriod } from "@/lib/api";
import { formatBoardValue } from "@/lib/board";

type Me = { optedIn: boolean; eligible: boolean | null; rank: number | null; value: number | null; participants: number };

/** Your own place, pinned above the table when you are signed in. */
export function MyRank({ period, metric }: { period: BoardPeriod; metric: BoardMetric }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void apiCall<Me>("GET", `/leaderboard/me?period=${period}&metric=${metric}`).then((r) => setMe(r.ok ? r.data : null));
  }, [period, metric]);
  if (!me) return null;
  let text: React.ReactNode;
  if (!me.optedIn)
    text = (
      <>
        You are not on the leaderboard.{" "}
        <Link href="/settings" className="underline underline-offset-4">
          Turn it on in settings
        </Link>
        .
      </>
    );
  else if (me.rank !== null) text = `You are #${me.rank} of ${me.participants}, with ${formatBoardValue(metric, me.value ?? 0)}.`;
  else if (me.eligible === false) text = "Your days are waiting for review before they rank. This happens for new GitHub accounts and unusual days.";
  else text = 'No synced activity in this period yet. Run "npx codewrapped sync".';
  return <p className="rounded-[8px] border border-border bg-surface p-3 text-[14px]">{text}</p>;
}
