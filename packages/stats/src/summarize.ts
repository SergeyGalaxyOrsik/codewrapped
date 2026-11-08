import { pickArchetype, type Archetype } from "./archetype";
import { addCounts, addModels, addRepos, mergeAggregates } from "./merge";
import { addDays, daysBetween, periodStart, weekdayOf } from "./days";
import { countMinutes, decodeMask, emptyMask, hoursOf, orInto, type MinuteMask } from "./mask";
import { toolCategories, type ToolCategory } from "./tools";
import {
  SOURCE_NAMES,
  SOURCES,
  headlineTokens,
  type DailyAggregate,
  type ModelUsage,
  type Period,
  type RepoUsage,
  type Source,
  type SourceFilter,
  type TokenCounts,
} from "./types";

export type SummaryOptions = {
  period: Period;
  /** Local "today" as YYYY-MM-DD. The period ends on this day. */
  today: string;
  source?: SourceFilter;
  hideFiles?: boolean;
  hideRepos?: boolean;
  /** Count automated runs (claude -p, Agent SDK, codex exec) in time, sessions and archetype. */
  includeAutomated?: boolean;
};

export type Ranked = { name: string; count: number };

export type SourceTotals = { activeMinutes: number; agentMinutes: number; tokens: number; sessions: number };

/** One slice of the per-harness split: a harness, or "other" for the rest. */
export type HarnessShare = { source: Source | "other"; name: string; activeMinutes: number; tokens: number; share: number };

/**
 * Harnesses ranked by `by`, the top `n` named and the rest folded into one
 * "other" slice. Shares are of the summed per-harness values, so they add up
 * to 1 even when sessions of two harnesses overlap in time. Harnesses with
 * nothing in `by` are left out.
 */
export function harnessSplit(bySource: Record<Source, SourceTotals>, by: "tokens" | "activeMinutes", n = 3): HarnessShare[] {
  const ranked = SOURCES.map((source) => ({ source, ...bySource[source] }))
    .filter((x) => x[by] > 0)
    .sort((a, b) => b[by] - a[by] || SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source));
  const total = ranked.reduce((a, x) => a + x[by], 0);
  const slice = (source: Source | "other", name: string, xs: typeof ranked): HarnessShare => {
    const activeMinutes = xs.reduce((a, x) => a + x.activeMinutes, 0);
    const tokens = xs.reduce((a, x) => a + x.tokens, 0);
    return { source, name, activeMinutes, tokens, share: total > 0 ? (by === "tokens" ? tokens : activeMinutes) / total : 0 };
  };
  // Folding a single harness into "other" would hide its name for nothing.
  const named = ranked.length <= n + 1 ? ranked : ranked.slice(0, n);
  const out = named.map((x) => slice(x.source, SOURCE_NAMES[x.source], [x]));
  if (named.length < ranked.length) out.push(slice("other", "other", ranked.slice(n)));
  return out;
}

export type Summary = {
  period: Period;
  source: SourceFilter;
  /** The days this summary actually covers. */
  range: { start: string; end: string; days: number };
  /** True when the logs start later than the period does. */
  truncated: boolean;
  /** Earliest day with any data, across all time. */
  firstDataDay: string | null;
  totals: {
    /** Wall-clock minutes with at least one active session. The headline. */
    activeMinutes: number;
    /** Session minutes summed. Parallel sessions each count. */
    agentMinutes: number;
    /** Most sessions active at once on any day. */
    peakSessions: number;
    sessions: number;
    messages: number;
    /** headline = input + output + cacheWrite. Cache reads are listed but not in the headline. */
    tokens: TokenCounts & { headline: number };
    /** Estimated, at public API prices, all four buckets. Excludes unpriced models. */
    costUsd: number;
    /** Headline tokens from models with no known price. */
    unpricedTokens: number;
    activeDays: number;
    toolCalls: number;
    fileEdits: number;
    /** Automated runs. Their tokens and tools are always in the totals above. */
    automated: {
      /** Whether time, sessions and prompts above include these runs. */
      included: boolean;
      sessions: number;
      messages: number;
      /** Wall-clock minutes of automated runs on their own. */
      activeMinutes: number;
      /** Wall-clock minutes they add on top of interactive time. */
      addedMinutes: number;
      agentMinutes: number;
    };
  };
  bySource: Record<Source, SourceTotals>;
  /** Tool calls per category. Raw names are in topTools. */
  toolCategories: Record<ToolCategory, number>;
  /** Share is of headline tokens. */
  models: Array<{ model: string; tokens: number; cacheRead: number; costUsd: number | null; share: number }>;
  topFiles: Ranked[];
  topTools: Ranked[];
  /** Top 3 repositories by headline tokens. */
  topRepos: Array<{ name: string; tokens: number; minutes: number }>;
  longestSessionMinutes: number;
  longestStreakDays: number;
  /** 0-23, or null with no activity. */
  busiestHour: number | null;
  /** 0 = Monday ... 6 = Sunday, or null with no activity. */
  busiestWeekday: number | null;
  /** [weekday 0-6][hour 0-23] of wall-clock active minutes. */
  heatmap: number[][];
  archetype: Archetype;
};

function top(counts: Record<string, number>, n: number): Ranked[] {
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function argmax(values: number[]): number | null {
  let best = -1;
  let bestValue = 0;
  values.forEach((v, i) => {
    if (v > bestValue) {
      best = i;
      bestValue = v;
    }
  });
  return best === -1 ? null : best;
}

function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function summarize(rows: readonly DailyAggregate[], opts: SummaryOptions): Summary {
  const source = opts.source ?? "all";
  const all = mergeAggregates(rows.filter((r) => source === "all" || r.source === source));

  const firstDataDay = all.length > 0 ? all[0]!.day : null;
  const nominalStart = periodStart(opts.period, opts.today);
  let start = nominalStart ?? firstDataDay ?? opts.today;
  const truncated = firstDataDay !== null && firstDataDay > start;
  if (truncated) start = firstDataDay!;
  if (start > opts.today) start = opts.today;
  const end = opts.today;

  const inRange = all.filter((r) => r.day >= start && r.day <= end);

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, headline: 0 };
  const models: Record<string, ModelUsage> = {};
  const tools: Record<string, number> = {};
  const files: Record<string, number> = {};
  const repos: Record<string, RepoUsage> = {};
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const bySource = Object.fromEntries(
    SOURCES.map((src) => [src, { activeMinutes: 0, agentMinutes: 0, tokens: 0, sessions: 0 }]),
  ) as Summary["bySource"];
  let agentMinutes = 0;
  let peakSessions = 0;
  let sessions = 0;
  let messages = 0;
  let longestSession = 0;
  const activeDays: string[] = [];

  const include = opts.includeAutomated ?? false;
  // Wall-clock time: OR the masks of every source for each day.
  const dayMasks = new Map<string, MinuteMask>();
  const interactiveDayMasks = new Map<string, MinuteMask>();
  const automatedDayMasks = new Map<string, MinuteMask>();
  const orDay = (masks: Map<string, MinuteMask>, day: string, mask: MinuteMask) => {
    let m = masks.get(day);
    if (!m) {
      m = emptyMask();
      masks.set(day, m);
    }
    orInto(m, mask);
  };
  const auto = { sessions: 0, messages: 0, agentMinutes: 0 };

  for (const r of inRange) {
    const a = r.automated;
    const interactiveMask = decodeMask(r.activeMask);
    const automatedMask = decodeMask(a.activeMask);
    orDay(interactiveDayMasks, r.day, interactiveMask);
    orDay(automatedDayMasks, r.day, automatedMask);
    auto.sessions += a.sessions;
    auto.messages += a.messages;
    auto.agentMinutes += a.agentMinutes;

    const mask = interactiveMask;
    if (include) orInto(mask, automatedMask);
    const minutes = countMinutes(mask);
    orDay(dayMasks, r.day, mask);

    agentMinutes += r.agentMinutes + (include ? a.agentMinutes : 0);
    peakSessions = Math.max(peakSessions, include ? Math.max(r.peakSessions, a.peakSessionsAll) : r.peakSessions);
    sessions += r.sessions + (include ? a.sessions : 0);
    messages += r.messages + (include ? a.messages : 0);
    tokens.input += r.tokens.input;
    tokens.output += r.tokens.output;
    tokens.cacheRead += r.tokens.cacheRead;
    tokens.cacheWrite += r.tokens.cacheWrite;
    addModels(models, r.models);
    addCounts(tools, r.tools);
    addCounts(files, r.files);
    addRepos(repos, r.repos);
    if (include) {
      for (const [name, minutes] of Object.entries(a.repoMinutes)) {
        (repos[name] ??= { minutes: 0, tokens: 0 }).minutes += minutes;
      }
    }
    longestSession = Math.max(longestSession, r.longestSessionMinutes, include ? a.longestSessionMinutes : 0);

    // Rows are merged per day and source, so this is already the per-source union.
    const s = bySource[r.source];
    s.activeMinutes += minutes;
    s.agentMinutes += r.agentMinutes + (include ? a.agentMinutes : 0);
    s.sessions += r.sessions + (include ? a.sessions : 0);
    s.tokens += headlineTokens(r.tokens);

    if (minutes > 0 || r.messages > 0 || r.sessions > 0 || (include && a.sessions > 0)) activeDays.push(r.day);
  }
  tokens.headline = headlineTokens(tokens);

  let activeMinutes = 0;
  let weekendMinutes = 0;
  for (const [day, mask] of dayMasks) {
    const wd = weekdayOf(day);
    const dayHours = hoursOf(mask);
    let total = 0;
    for (let h = 0; h < 24; h++) {
      hours[h]! += dayHours[h]!;
      heatmap[wd]![h]! += dayHours[h]!;
      total += dayHours[h]!;
    }
    activeMinutes += total;
    weekdays[wd]! += total;
    if (wd >= 5) weekendMinutes += total;
  }

  let automatedMinutes = 0;
  let addedMinutes = 0;
  for (const [day, m] of automatedDayMasks) {
    automatedMinutes += countMinutes(m);
    const both = emptyMask();
    orInto(both, m);
    const interactive = interactiveDayMasks.get(day);
    if (interactive) orInto(both, interactive);
    addedMinutes += countMinutes(both) - (interactive ? countMinutes(interactive) : 0);
  }

  let costUsd = 0;
  let unpricedTokens = 0;
  const modelList = Object.entries(models)
    .map(([model, u]) => {
      if (u.costUsd === null) unpricedTokens += u.tokens;
      else costUsd += u.costUsd;
      return {
        model,
        tokens: u.tokens,
        cacheRead: u.cacheRead,
        costUsd: u.costUsd === null ? null : round2(u.costUsd),
        share: tokens.headline > 0 ? u.tokens / tokens.headline : 0,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);

  const categories = toolCategories(tools);
  const toolCalls = Object.values(categories).reduce((a, b) => a + b, 0);
  const fileEdits = Object.values(files).reduce((a, b) => a + b, 0);
  const topFiles = top(files, 5);
  const uniqueActiveDays = new Set(activeDays).size;
  const days = daysBetween(start, end);

  const nightMinutes = [22, 23, 0, 1, 2, 3].reduce((a, h) => a + hours[h]!, 0);
  const archetype = pickArchetype(
    {
      activeMinutes,
      nightMinutes,
      weekendMinutes,
      minutesBySource: Object.fromEntries(SOURCES.map((src) => [src, bySource[src].activeMinutes])) as Record<Source, number>,
      toolCalls,
      shellCalls: categories.shell,
      // Looking around without changing anything: reads, searches and web lookups.
      readCalls: categories.read + categories.search + categories.web,
      editCalls: categories.edit,
      topFile: topFiles[0] ?? null,
      fileEdits,
      longestSessionMinutes: longestSession,
      activeDays: uniqueActiveDays,
      periodDays: days,
    },
    { hideFiles: opts.hideFiles },
  );

  return {
    period: opts.period,
    source,
    range: { start, end, days },
    truncated,
    firstDataDay,
    totals: {
      activeMinutes,
      agentMinutes: round2(agentMinutes),
      peakSessions,
      sessions,
      messages,
      tokens,
      costUsd: round2(costUsd),
      unpricedTokens,
      activeDays: uniqueActiveDays,
      toolCalls,
      fileEdits,
      automated: {
        included: include,
        sessions: auto.sessions,
        messages: auto.messages,
        activeMinutes: automatedMinutes,
        addedMinutes,
        agentMinutes: round2(auto.agentMinutes),
      },
    },
    bySource: Object.fromEntries(
      SOURCES.map((src) => [src, { ...bySource[src], agentMinutes: round2(bySource[src].agentMinutes) }]),
    ) as Summary["bySource"],
    toolCategories: categories,
    models: modelList,
    topFiles: opts.hideFiles ? [] : topFiles,
    topTools: top(tools, 5),
    topRepos: opts.hideRepos
      ? []
      : Object.entries(repos)
          .filter(([, r]) => r.tokens > 0 || r.minutes > 0)
          .sort((a, b) => b[1].tokens - a[1].tokens || b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([name, r]) => ({ name, tokens: r.tokens, minutes: round2(r.minutes) })),
    longestSessionMinutes: round2(longestSession),
    longestStreakDays: longestStreak(activeDays),
    busiestHour: argmax(hours),
    busiestWeekday: argmax(weekdays),
    heatmap,
    archetype,
  };
}

/**
 * Wall-clock active minutes per day over all synced time, for the profile
 * heatmap. Interactive sessions only; sources and machines are ORed.
 */
export function activityCalendar(rows: readonly DailyAggregate[]): Array<{ day: string; minutes: number }> {
  const byDay = new Map<string, MinuteMask>();
  for (const r of rows) {
    let m = byDay.get(r.day);
    if (!m) {
      m = emptyMask();
      byDay.set(r.day, m);
    }
    orInto(m, decodeMask(r.activeMask));
  }
  return [...byDay.entries()]
    .map(([day, m]) => ({ day, minutes: countMinutes(m) }))
    .filter((d) => d.minutes > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
}
