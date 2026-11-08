import { EMPTY_MASK, unionMasks } from "./mask";
import type { AutomatedActivity, DailyAggregate, ModelUsage, RepoUsage, Source } from "./types";

export function emptyAutomated(): AutomatedActivity {
  return {
    sessions: 0,
    messages: 0,
    activeMask: EMPTY_MASK,
    agentMinutes: 0,
    longestSessionMinutes: 0,
    peakSessionsAll: 0,
    repoMinutes: {},
  };
}

export function emptyAggregate(day: string, source: Source): DailyAggregate {
  return {
    day,
    source,
    sessions: 0,
    messages: 0,
    activeMask: EMPTY_MASK,
    agentMinutes: 0,
    peakSessions: 0,
    longestSessionMinutes: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: {},
    tools: {},
    files: {},
    repos: {},
    automated: emptyAutomated(),
    schemaVersion: 1,
  };
}

export function addCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

export function addModels(into: Record<string, ModelUsage>, from: Record<string, ModelUsage>): void {
  for (const [model, u] of Object.entries(from)) {
    const cur = (into[model] ??= { tokens: 0, cacheRead: 0, costUsd: null });
    cur.tokens += u.tokens;
    cur.cacheRead += u.cacheRead;
    if (u.costUsd !== null) cur.costUsd = (cur.costUsd ?? 0) + u.costUsd;
  }
}

export function addRepos(into: Record<string, RepoUsage>, from: Record<string, RepoUsage>): void {
  for (const [name, r] of Object.entries(from)) {
    const cur = (into[name] ??= { minutes: 0, tokens: 0 });
    cur.minutes += r.minutes;
    cur.tokens += r.tokens;
  }
}

/** Adds b into a. Both must be for the same day and source. */
export function addAggregate(a: DailyAggregate, b: DailyAggregate): void {
  a.sessions += b.sessions;
  a.messages += b.messages;
  a.activeMask = unionMasks([a.activeMask, b.activeMask]);
  a.agentMinutes += b.agentMinutes;
  // Sessions on different machines may or may not overlap in time. The larger
  // peak is a lower bound and never overstates.
  a.peakSessions = Math.max(a.peakSessions, b.peakSessions);
  a.longestSessionMinutes = Math.max(a.longestSessionMinutes, b.longestSessionMinutes);
  a.tokens.input += b.tokens.input;
  a.tokens.output += b.tokens.output;
  a.tokens.cacheRead += b.tokens.cacheRead;
  a.tokens.cacheWrite += b.tokens.cacheWrite;
  addModels(a.models, b.models);
  addCounts(a.tools, b.tools);
  addCounts(a.files, b.files);
  addRepos(a.repos, b.repos);
  const x = a.automated;
  const y = b.automated;
  x.sessions += y.sessions;
  x.messages += y.messages;
  x.activeMask = unionMasks([x.activeMask, y.activeMask]);
  x.agentMinutes += y.agentMinutes;
  x.longestSessionMinutes = Math.max(x.longestSessionMinutes, y.longestSessionMinutes);
  x.peakSessionsAll = Math.max(x.peakSessionsAll, y.peakSessionsAll);
  addCounts(x.repoMinutes, y.repoMinutes);
}

/**
 * Sums rows that share day and source, for example the same day synced from
 * two machines. The result does not depend on input order.
 */
export function mergeAggregates(rows: readonly DailyAggregate[]): DailyAggregate[] {
  const byKey = new Map<string, DailyAggregate>();
  for (const row of rows) {
    const key = `${row.day}|${row.source}`;
    let cur = byKey.get(key);
    if (!cur) {
      cur = emptyAggregate(row.day, row.source);
      byKey.set(key, cur);
    }
    addAggregate(cur, row);
  }
  return [...byKey.values()].sort((a, b) =>
    a.day === b.day ? a.source.localeCompare(b.source) : a.day.localeCompare(b.day),
  );
}
