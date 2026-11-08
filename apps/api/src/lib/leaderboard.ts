import { addDays, countMinutes, decodeMask, emptyMask, headlineTokens, orInto, weekdayOf, type DailyAggregate, type MinuteMask } from "@codewrapped/stats";

export const BOARD_PERIODS = ["week", "month"] as const;
export const BOARD_METRICS = ["hours", "streak", "tokens"] as const;
export type BoardPeriod = (typeof BOARD_PERIODS)[number];
/** Never cost: comparing spend is not the point and people may not want it shown. */
export type BoardMetric = (typeof BOARD_METRICS)[number];

/** GitHub accounts younger than this are reviewed before they rank. */
export const MIN_ACCOUNT_AGE_DAYS = 60;
/** Percentiles appear only when this many users were active in the month. */
export const PERCENTILE_MIN_USERS = 200;

/** Monday-to-Sunday week, or calendar month, containing `today`. Boards reset when it ends. */
export function boardRange(period: BoardPeriod, today: string): { start: string; end: string } {
  if (period === "week") {
    const start = addDays(today, -weekdayOf(today));
    return { start, end: addDays(start, 6) };
  }
  const start = `${today.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
  return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
}

export type Scores = { minutes: number; streak: number; tokens: number };

/** Wall-clock minutes (interactive sessions, ORed across machines), longest streak, headline tokens. */
export function score(rows: DailyAggregate[]): Scores {
  const masks = new Map<string, MinuteMask>();
  let tokens = 0;
  for (const r of rows) {
    tokens += headlineTokens(r.tokens);
    let m = masks.get(r.day);
    if (!m) {
      m = emptyMask();
      masks.set(r.day, m);
    }
    orInto(m, decodeMask(r.activeMask));
  }
  let minutes = 0;
  const activeDays: string[] = [];
  for (const [day, m] of masks) {
    const n = countMinutes(m);
    minutes += n;
    if (n > 0) activeDays.push(day);
  }
  activeDays.sort();
  let streak = 0;
  let run = 0;
  for (let i = 0; i < activeDays.length; i++) {
    run = i > 0 && addDays(activeDays[i - 1]!, 1) === activeDays[i] ? run + 1 : 1;
    streak = Math.max(streak, run);
  }
  return { minutes, streak, tokens };
}

export function metricValue(s: Scores, metric: BoardMetric): number {
  return metric === "hours" ? s.minutes : metric === "streak" ? s.streak : s.tokens;
}

export type Candidate = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  xHandle: string | null;
  optedIn: boolean;
  /** Passes review: trusted by hand, or an old enough account with no flagged day in the period. */
  eligible: boolean;
  /** Why an untrusted user waits for review, or null. Shown only to that user. */
  hold: Hold | null;
  scores: Scores;
};

export type Hold =
  /** The account predates the github_created_at column and GitHub could not be asked yet. */
  | { reason: "account_age_unknown" }
  | { reason: "account_too_new"; ranksFrom: string }
  | { reason: "flagged_days"; days: Array<{ day: string; flag: string }> };

/** Why a user is held back from the boards, before any manual trust. */
export function holdFor(githubCreatedAt: Date | null, flags: Array<{ day: string; flag: string }>, now: Date): Hold | null {
  if (githubCreatedAt === null) return { reason: "account_age_unknown" };
  const ranksFrom = new Date(githubCreatedAt.getTime() + MIN_ACCOUNT_AGE_DAYS * 86_400_000);
  if (ranksFrom > now) return { reason: "account_too_new", ranksFrom: ranksFrom.toISOString().slice(0, 10) };
  // One entry per day: the same day can be flagged on several machines or sources.
  const days = [...new Map(flags.map((f) => [f.day, f] as const)).values()].sort((a, b) => a.day.localeCompare(b.day));
  if (days.length > 0) return { reason: "flagged_days", days };
  return null;
}

export type Ranked = Candidate & { rank: number; value: number };

/** Ranks with ties sharing a rank (1, 2, 2, 4). Zero values are left out. */
export function rank(candidates: Candidate[], metric: BoardMetric): Ranked[] {
  const sorted = candidates
    .map((c) => ({ ...c, value: metricValue(c.scores, metric) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || a.handle.localeCompare(b.handle));
  let prev: number | null = null;
  let prevRank = 0;
  return sorted.map((c, i) => {
    const r = c.value === prev ? prevRank : i + 1;
    prev = c.value;
    prevRank = r;
    return { ...c, rank: r };
  });
}

/** "Top 4%" by wall-clock hours this month, among eligible active users. Null below PERCENTILE_MIN_USERS or outside the top half. */
export function percentile(ranked: Ranked[], userId: string): number | null {
  if (ranked.length < PERCENTILE_MIN_USERS) return null;
  const me = ranked.find((r) => r.userId === userId);
  if (!me) return null;
  const pct = Math.max(1, Math.ceil((me.rank / ranked.length) * 100));
  return pct <= 50 ? pct : null;
}
