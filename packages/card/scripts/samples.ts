/**
 * Synthetic summaries for layout edge cases. They are built from daily
 * aggregates through summarize(), so they have the same shape as real ones.
 * The numbers are chosen to stress the layout, not to look like a real user.
 */
import {
  addDays,
  emptyAggregate,
  emptyMask,
  encodeMask,
  setRange,
  summarize,
  type DailyAggregate,
  type Source,
  type Summary,
} from "@codewrapped/stats";

type DayInput = {
  minutes: Array<[number, number]>;
  source?: Source;
  sessions?: number;
  peak?: number;
  tokens?: number;
  costUsd?: number;
  tools?: Record<string, number>;
  files?: Record<string, number>;
  /** Share of the day's tokens per repository. */
  repos?: Record<string, number>;
};

function row(day: string, i: DayInput): DailyAggregate {
  const r = emptyAggregate(day, i.source ?? "claude");
  const mask = emptyMask();
  let minutes = 0;
  for (const [a, b] of i.minutes) {
    setRange(mask, a, b);
    minutes += b - a + 1;
  }
  r.activeMask = encodeMask(mask);
  r.agentMinutes = minutes * (i.peak && i.peak > 1 ? 1.4 : 1);
  r.sessions = i.sessions ?? 1;
  r.peakSessions = i.peak ?? 1;
  r.longestSessionMinutes = minutes;
  r.messages = r.sessions * 4;
  const tokens = i.tokens ?? 0;
  r.tokens = { input: tokens * 0.1, output: tokens * 0.2, cacheRead: tokens * 10, cacheWrite: tokens * 0.7 };
  r.models = { "claude-opus-5-5": { tokens, cacheRead: tokens * 10, costUsd: i.costUsd ?? 0 } };
  r.tools = i.tools ?? {};
  r.files = i.files ?? {};
  const headline = r.tokens.input + r.tokens.output + r.tokens.cacheWrite;
  r.repos = Object.fromEntries(
    Object.entries(i.repos ?? {}).map(([name, share]) => [name, { minutes: minutes * share, tokens: headline * share }]),
  );
  return r;
}

function days(today: string, n: number, f: (i: number) => DayInput | null): DailyAggregate[] {
  const out: DailyAggregate[] = [];
  for (let i = 0; i < n; i++) {
    const input = f(i);
    if (input) out.push(row(addDays(today, -i), input));
  }
  return out;
}

export function samples(today: string): Record<string, { summary: Summary; handle: string | null }> {
  const small = days(today, 6, (i) =>
    i % 2 === 0
      ? {
          minutes: [[600, 639]],
          tokens: 400_000,
          costUsd: 1.1,
          tools: { Read: 10, Bash: 4, Edit: 3 },
          files: (i === 0 ? { "page.tsx": 3, "api.ts": 1 } : { "page.tsx": 2 }) as Record<string, number>,
          repos: { "shop-web": 1 },
        }
      : null,
  );

  const longNames = days(today, 20, (i) => ({
    minutes: [[540 + i, 700]],
    tokens: 3_000_000,
    costUsd: 9,
    tools: { "mcp__claude-in-chrome__javascript_tool": 30, "mcp__codex_app__get_worktree_creation_status": 20, Bash: 10 },
    files: {
      "AutomationRunHistoryTableWithFilters.integration.test.tsx": 9,
      "use-workspace-permissions-and-roles-for-admins.ts": 6,
      "20261104_add_automation_run_attempts_table.sql": 4,
    },
    repos: { "customer-onboarding-and-billing-platform": 0.6, "internal-design-system-tokens": 0.3, dotfiles: 0.1 },
  }));

  const big = days(today, 90, (i) => ({
    minutes: [[480, 1307]],
    source: i % 3 === 0 ? "codex" : "claude",
    sessions: 14,
    peak: 14,
    tokens: 10_500_000_000 / 90,
    costUsd: 12_480 / 90,
    tools: { Bash: 4000, Read: 1500, Edit: 900 },
    files: { "schema.ts": 120, "page.tsx": 100, "api.ts": 80 },
    repos: { platform: 0.5, "mobile-app": 0.3, infra: 0.2 },
  }));

  const short = days(today, 23, (i) =>
    i % 3 === 2
      ? null
      : {
          minutes: [[1320, 1439]],
          source: i % 4 === 0 ? "codex" : "claude",
          tokens: 9_000_000,
          costUsd: 31,
          tools: { Edit: 40, Read: 30, apply_patch: 25 },
          files: { "main.rs": 14, "lib.rs": 6, "Cargo.toml": 2 },
        },
  );

  return {
    small: { summary: summarize(small, { period: "30d", today }), handle: null },
    "long-names": { summary: summarize(longNames, { period: "30d", today }), handle: null },
    big: { summary: summarize(big, { period: "90d", today }), handle: "a-rather-long-handle" },
    short: { summary: summarize(short, { period: "30d", today }), handle: "ada" },
  };
}
