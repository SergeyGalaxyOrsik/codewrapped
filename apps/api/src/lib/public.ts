import { activityCalendar, headlineTokens, summarize, type DailyAggregate, type Period, type Summary } from "@codewrapped/stats";
import type { Visibility } from "../db/schema";

/** A summary with the sections the owner hid set to null. */
export type PublicSummary = Omit<Summary, "heatmap" | "models" | "totals"> & {
  heatmap: number[][] | null;
  models: Summary["models"] | null;
  totals: Omit<Summary["totals"], "costUsd"> & { costUsd: number | null };
};

export type PublicProfile = {
  profile: { handle: string; displayName: string | null; avatarUrl: string | null; joinedAt: string };
  visibility: Visibility;
  period: Period;
  summary: PublicSummary;
  /** Every synced day with activity, for the full heatmap. Null when the heatmap is hidden. */
  calendar: Array<{ day: string; minutes: number }> | null;
  /** Totals since the first synced day. */
  allTime: { firstDay: string | null; activeMinutes: number; tokens: number; sessions: number; costUsd: number | null };
};

/** YYYY-MM-DD in a timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function publicSummary(rows: DailyAggregate[], period: Period, today: string, vis: Visibility): PublicSummary {
  const s = summarize(rows, { period, today, hideFiles: !vis.files, hideRepos: !vis.repos });
  return {
    ...s,
    totals: { ...s.totals, costUsd: vis.cost ? s.totals.costUsd : null },
    models: vis.models ? s.models.map((m) => (vis.cost ? m : { ...m, costUsd: null })) : null,
    topTools: vis.tools ? s.topTools : [],
    heatmap: vis.heatmap ? s.heatmap : null,
    busiestHour: vis.heatmap ? s.busiestHour : null,
    busiestWeekday: vis.heatmap ? s.busiestWeekday : null,
  };
}

export function buildPublicProfile(
  profile: PublicProfile["profile"],
  vis: Visibility,
  rows: DailyAggregate[],
  period: Period,
  today: string,
): PublicProfile {
  const all = summarize(rows, { period: "all", today });
  return {
    profile,
    visibility: vis,
    period,
    summary: publicSummary(rows, period, today, vis),
    calendar: vis.heatmap ? activityCalendar(rows) : null,
    allTime: {
      firstDay: all.firstDataDay,
      activeMinutes: all.totals.activeMinutes,
      tokens: headlineTokens(all.totals.tokens),
      sessions: all.totals.sessions,
      costUsd: vis.cost ? all.totals.costUsd : null,
    },
  };
}
