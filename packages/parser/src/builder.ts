import {
  emptyAggregate,
  emptyMask,
  encodeMask,
  setRange,
  usageCost,
  type DailyAggregate,
  type MinuteMask,
  type RequestUsage,
  type Source,
  type ToolCategory,
} from "@codewrapped/stats";
import type { LocalClock } from "./clock";

/** Gaps between events longer than this are idle time and not counted. */
export const MAX_GAP_MS = 5 * 60_000;

export type TimelineEvent = { t: number; repo: string | null };

export type Session = {
  events: TimelineEvent[];
  /** Only sessions with a prompt, a model reply or a tool call are counted. */
  active: boolean;
  /** Started by a script or another program, not by a person at a terminal. */
  automated: boolean;
  /** Times of prompts the user sent in this session. */
  prompts: number[];
};

type Kind = "interactive" | "automated";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Collects counts into daily buckets for one source. */
export class DayBuilder {
  private readonly days = new Map<string, DailyAggregate>();
  private readonly masks: Record<Kind, Map<string, MinuteMask>> = { interactive: new Map(), automated: new Map() };
  /** Active pieces of every session, for the concurrency sweep. */
  private readonly intervals: Record<Kind, Array<[number, number]>> = { interactive: [], automated: [] };

  constructor(
    readonly source: Source,
    readonly clock: LocalClock,
  ) {}

  bucket(day: string): DailyAggregate {
    let b = this.days.get(day);
    if (!b) {
      b = emptyAggregate(day, this.source);
      this.days.set(day, b);
    }
    return b;
  }

  at(ms: number): DailyAggregate {
    return this.bucket(this.clock.local(ms).day);
  }

  private mask(kind: Kind, day: string): MinuteMask {
    let m = this.masks[kind].get(day);
    if (!m) {
      m = emptyMask();
      this.masks[kind].set(day, m);
    }
    return m;
  }

  addTool(ms: number, name: string, category: ToolCategory): void {
    const b = this.at(ms);
    b.tools[name] = (b.tools[name] ?? 0) + 1;
    const c = (b.toolCategories ??= {});
    c[category] = (c[category] ?? 0) + 1;
  }

  addFileEdit(ms: number, filePath: string): void {
    const name = basename(filePath);
    if (!name) return;
    const b = this.at(ms);
    b.files[name] = (b.files[name] ?? 0) + 1;
  }

  /** reportedUsd is the cost the harness recorded, when it records one. */
  addUsage(ms: number, model: string, u: RequestUsage, repo: string | null = null, reportedUsd?: number | null): void {
    const b = this.at(ms);
    const cacheWrite = u.cacheWrite + u.cacheWriteLong;
    if (repo) (b.repos[repo] ??= { minutes: 0, tokens: 0 }).tokens += u.input + u.output + cacheWrite;
    b.tokens.input += u.input;
    b.tokens.output += u.output;
    b.tokens.cacheRead += u.cacheRead;
    b.tokens.cacheWrite += cacheWrite;
    const m = (b.models[model] ??= { tokens: 0, cacheRead: 0, costUsd: null });
    m.tokens += u.input + u.output + cacheWrite;
    m.cacheRead += u.cacheRead;
    const cost = usageCost(model, u, reportedUsd);
    if (cost !== null) m.costUsd = (m.costUsd ?? 0) + cost;
  }

  /**
   * Adds a session's active time: events sorted by time, gaps summed, gaps
   * over MAX_GAP_MS dropped. Each gap is split at local hour boundaries and
   * goes to that hour's day, repository and minute mask. Automated sessions
   * go to the separate `automated` block.
   */
  addSession(session: Session): void {
    if (!session.active || session.events.length === 0) return;
    const kind: Kind = session.automated ? "automated" : "interactive";
    const target = (b: DailyAggregate) => (session.automated ? b.automated : b);
    const addRepoMinutes = (b: DailyAggregate, repo: string, minutes: number) => {
      if (session.automated) b.automated.repoMinutes[repo] = (b.automated.repoMinutes[repo] ?? 0) + minutes;
      else (b.repos[repo] ??= { minutes: 0, tokens: 0 }).minutes += minutes;
    };
    const events = session.events.sort((a, b) => a.t - b.t);
    let total = 0;
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const gap = events[i]!.t - prev.t;
      if (gap <= 0 || gap > MAX_GAP_MS) continue;
      total += gap / 60_000;
      this.clock.split(prev.t, events[i]!.t, (local, minutes, from, to) => {
        const day = this.bucket(local.day);
        target(day).agentMinutes += minutes;
        if (prev.repo) addRepoMinutes(day, prev.repo, minutes);
        // A minute counts as active if the session was active at any point in it.
        setRange(this.mask(kind, local.day), this.clock.minuteOfDay(from), this.clock.minuteOfDay(to - 1));
        this.intervals[kind].push([from, to]);
      });
    }
    const first = target(this.at(events[0]!.t));
    first.sessions += 1;
    first.longestSessionMinutes = Math.max(first.longestSessionMinutes, total);
    for (const t of session.prompts) target(this.at(t)).messages += 1;
  }

  /** Sweeps session pieces and records the most open at once per day. */
  private peaks(intervals: Array<[number, number]>): Map<string, number> {
    const points: Array<[number, number]> = [];
    for (const [from, to] of intervals) points.push([from, 1], [to, -1]);
    // At equal times, close before open: back-to-back pieces are not concurrent.
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const peaks = new Map<string, number>();
    let open = 0;
    for (const [t, delta] of points) {
      open += delta;
      if (delta > 0) {
        const day = this.clock.local(t).day;
        if (open > (peaks.get(day) ?? 0)) peaks.set(day, open);
      }
    }
    return peaks;
  }

  result(): DailyAggregate[] {
    const peaks = this.peaks(this.intervals.interactive);
    const peaksAll = this.peaks([...this.intervals.interactive, ...this.intervals.automated]);
    for (const kind of ["interactive", "automated"] as const) for (const day of this.masks[kind].keys()) this.bucket(day);
    const roundValues = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round2(v)]));
    return [...this.days.values()]
      .map((b) => ({
        ...b,
        activeMask: encodeMask(this.masks.interactive.get(b.day) ?? emptyMask()),
        agentMinutes: round2(b.agentMinutes),
        peakSessions: peaks.get(b.day) ?? 0,
        longestSessionMinutes: round2(b.longestSessionMinutes),
        repos: Object.fromEntries(Object.entries(b.repos).map(([k, v]) => [k, { minutes: round2(v.minutes), tokens: v.tokens }])),
        models: Object.fromEntries(
          Object.entries(b.models).map(([k, v]) => [
            k,
            { ...v, costUsd: v.costUsd === null ? null : Math.round(v.costUsd * 1e6) / 1e6 },
          ]),
        ),
        automated: {
          ...b.automated,
          activeMask: encodeMask(this.masks.automated.get(b.day) ?? emptyMask()),
          agentMinutes: round2(b.automated.agentMinutes),
          longestSessionMinutes: round2(b.automated.longestSessionMinutes),
          peakSessionsAll: peaksAll.get(b.day) ?? 0,
          repoMinutes: roundValues(b.automated.repoMinutes),
        },
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }
}

export function basename(p: string): string {
  const parts = p.trim().split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
