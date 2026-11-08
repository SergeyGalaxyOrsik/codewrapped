import { addDays, emptyAggregate, emptyMask, encodeMask, setRange, summarize, type Summary } from "@codewrapped/stats";

/**
 * An example card for the landing page when no hero profile is configured.
 * Round numbers on purpose, and labelled "Example" where it is shown.
 */
export function exampleSummary(today: string): Summary {
  const rows = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(today, -i);
    const r = emptyAggregate(day, i % 4 === 0 ? "codex" : "claude");
    if (i % 7 === 5 || i % 7 === 6) return r;
    const mask = emptyMask();
    setRange(mask, 540 + (i % 3) * 30, 779);
    setRange(mask, 840, 1019 - (i % 2) * 60);
    r.activeMask = encodeMask(mask);
    r.agentMinutes = 480;
    r.sessions = 3;
    r.peakSessions = 3;
    r.messages = 40;
    r.tokens = { input: 100_000, output: 400_000, cacheRead: 20_000_000, cacheWrite: 1_500_000 };
    r.models = { "claude-opus-5-5": { tokens: 2_000_000, cacheRead: 20_000_000, costUsd: 15 } };
    r.tools = { Bash: 300, Read: 120, Edit: 80 };
    r.repos = { web: { minutes: 240, tokens: 1_000_000 }, api: { minutes: 180, tokens: 700_000 }, docs: { minutes: 60, tokens: 300_000 } };
    return r;
  });
  return summarize(rows, { period: "30d", today });
}
