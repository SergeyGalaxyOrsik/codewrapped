"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiCall, type BoardMetric, type BoardPeriod } from "@/lib/api";
import { formatBoardValue } from "@/lib/board";

type Hold =
  | { reason: "account_age_unknown" }
  | { reason: "account_too_new"; ranksFrom: string }
  | { reason: "flagged_days"; days: Array<{ day: string; flag: string }> };
type Me = { optedIn: boolean; eligible: boolean | null; hold?: Hold | null; rank: number | null; value: number | null; participants: number };

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Why your days do not rank yet, in words. */
function holdText(hold: Hold | null | undefined): string {
  if (hold?.reason === "account_too_new") return `Your GitHub account is less than 60 days old. Your days start to rank on ${dayLabel(hold.ranksFrom)}.`;
  if (hold?.reason === "account_age_unknown") return "We could not check how old your GitHub account is yet, so your days wait for review. Reload the page in an hour to try again.";
  if (hold?.reason === "flagged_days") {
    const [first, ...rest] = hold.days;
    const more = rest.length > 0 ? ` and ${rest.length} more ${rest.length === 1 ? "day" : "days"}` : "";
    return `${dayLabel(first!.day)}${more} looked unusual (${first!.flag}), so your days in this period wait for review.`;
  }
  return "Your days are waiting for review before they rank.";
}

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
  else if (me.eligible === false) text = holdText(me.hold);
  else text = 'No synced activity in this period yet. Run "npx codewrapped sync".';
  return <p className="rounded-[8px] border border-border bg-surface p-3 text-[14px]">{text}</p>;
}
