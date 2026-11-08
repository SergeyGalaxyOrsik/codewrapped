import { describe, expect, it } from "vitest";
import { countMinutes, decodeMask, mergeAggregates, summarize } from "../src/index";
import { agg, automated } from "./helpers";

const TODAY = "2026-11-08"; // a Sunday

describe("mergeAggregates", () => {
  const laptop = agg("2026-11-02", "claude", {
    hours: { 10: 30 },
    messages: 3,
    tokens: { input: 100, output: 10 },
    tools: { Bash: 2 },
    files: { "a.ts": 1 },
    models: { "claude-opus-5-5": { tokens: 110, cacheRead: 5, costUsd: 0.5 } },
    longestSessionMinutes: 30,
    peakSessions: 2,
  });
  const desktop = agg("2026-11-02", "claude", {
    hours: { 10: 15, 11: 20 },
    messages: 1,
    tokens: { input: 50 },
    tools: { Bash: 1, Read: 4 },
    files: { "a.ts": 2 },
    models: {
      "claude-opus-5-5": { tokens: 50, cacheRead: 0, costUsd: 0.25 },
      mystery: { tokens: 7, cacheRead: 0, costUsd: null },
    },
    longestSessionMinutes: 35,
    peakSessions: 3,
  });
  const codex = agg("2026-11-02", "codex", { hours: { 9: 5 } });

  it("sums rows from several machines and does not depend on order", () => {
    const merged = mergeAggregates([laptop, codex, desktop]);
    expect(merged).toEqual(mergeAggregates([desktop, laptop, codex]));
    expect(merged.map((r) => r.source)).toEqual(["claude", "codex"]);
    const claude = merged[0]!;
    expect(claude.sessions).toBe(2);
    expect(claude.messages).toBe(4);
    expect(claude.tokens).toEqual({ input: 150, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(claude.tools).toEqual({ Bash: 3, Read: 4 });
    expect(claude.files).toEqual({ "a.ts": 3 });
    expect(claude.models).toEqual({
      "claude-opus-5-5": { tokens: 160, cacheRead: 5, costUsd: 0.75 },
      mystery: { tokens: 7, cacheRead: 0, costUsd: null },
    });
  });

  it("ORs the minute masks and sums agent time", () => {
    const claude = mergeAggregates([laptop, desktop])[0]!;
    // 10:00-10:29 on one machine and 10:00-10:14 plus 11:00-11:19 on the other.
    expect(countMinutes(decodeMask(claude.activeMask))).toBe(50);
    expect(claude.agentMinutes).toBe(65);
  });

  it("keeps the larger peak and the longest single session", () => {
    const claude = mergeAggregates([laptop, desktop])[0]!;
    expect(claude.peakSessions).toBe(3);
    expect(claude.longestSessionMinutes).toBe(35);
  });

  it("does not change its input", () => {
    const copy = structuredClone(laptop);
    mergeAggregates([laptop, desktop]);
    expect(laptop).toEqual(copy);
  });
});

describe("summarize periods", () => {
  const rows = [
    agg("2026-10-01", "claude", { hours: { 10: 60 } }),
    agg("2026-11-01", "claude", { hours: { 10: 30 } }),
    agg("2026-11-02", "claude", { hours: { 10: 10 } }),
    agg("2026-11-08", "codex", { hours: { 10: 5 } }),
  ];

  it("cuts 7 days ending today, inclusive", () => {
    const s = summarize(rows, { period: "7d", today: TODAY });
    expect(s.range).toEqual({ start: "2026-11-02", end: TODAY, days: 7 });
    expect(s.totals.activeMinutes).toBe(15);
    expect(s.truncated).toBe(false);
  });

  it("says when logs start later than the period", () => {
    const s = summarize(rows.slice(1), { period: "90d", today: TODAY });
    expect(s.truncated).toBe(true);
    expect(s.firstDataDay).toBe("2026-11-01");
    expect(s.range).toEqual({ start: "2026-11-01", end: TODAY, days: 8 });
  });

  it("starts 'all' at the first day with data and 'year' on January 1", () => {
    expect(summarize(rows, { period: "all", today: TODAY }).range.start).toBe("2026-10-01");
    const year = summarize([agg("2025-12-31", "claude", { hours: { 1: 9 } }), ...rows], {
      period: "year",
      today: TODAY,
    });
    expect(year.range.start).toBe("2026-01-01");
    expect(year.totals.activeMinutes).toBe(105);
  });

  it("filters by source", () => {
    const s = summarize(rows, { period: "all", today: TODAY, source: "codex" });
    expect(s.totals.activeMinutes).toBe(5);
    expect(s.firstDataDay).toBe(TODAY);
  });

  it("handles no data", () => {
    const s = summarize([], { period: "30d", today: TODAY });
    expect(s.totals.activeMinutes).toBe(0);
    expect(s.busiestHour).toBeNull();
    expect(s.archetype.id).toBe("steady");
    expect(s.range.days).toBe(30);
  });
});

describe("summarize time", () => {
  // Two Claude sessions on two machines and one Codex session, all 10:00-10:29.
  const rows = [
    agg("2026-11-06", "claude", { hours: { 10: 30 }, peakSessions: 1 }),
    agg("2026-11-06", "claude", { hours: { 10: 30 }, peakSessions: 1 }),
    agg("2026-11-06", "codex", { ranges: [[610, 639]], peakSessions: 1 }),
  ];
  const s = summarize(rows, { period: "7d", today: TODAY });

  it("counts wall-clock time once across sources and machines", () => {
    // 10:00-10:39 is the union.
    expect(s.totals.activeMinutes).toBe(40);
    expect(s.totals.agentMinutes).toBe(90);
    expect(s.bySource.claude.activeMinutes).toBe(30);
    expect(s.bySource.claude.agentMinutes).toBe(60);
    expect(s.bySource.codex.activeMinutes).toBe(30);
  });

  it("builds hours and the heatmap from the union", () => {
    expect(s.busiestHour).toBe(10);
    expect(s.heatmap[4]![10]).toBe(40); // Friday
    expect(s.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(40);
  });
});

describe("summarize totals", () => {
  it("leaves cache reads out of the headline and keeps them in cost", () => {
    const s = summarize(
      [
        agg("2026-11-07", "claude", {
          hours: { 9: 10 },
          tokens: { input: 10, output: 20, cacheRead: 1000, cacheWrite: 40 },
          models: {
            "claude-opus-5-5": { tokens: 63, cacheRead: 900, costUsd: 1.5 },
            unknown: { tokens: 7, cacheRead: 100, costUsd: null },
          },
        }),
      ],
      { period: "7d", today: TODAY },
    );
    expect(s.totals.tokens).toEqual({ input: 10, output: 20, cacheRead: 1000, cacheWrite: 40, headline: 70 });
    expect(s.totals.costUsd).toBe(1.5);
    expect(s.totals.unpricedTokens).toBe(7);
    expect(s.models.map((m) => [m.model, m.share])).toEqual([
      ["claude-opus-5-5", 0.9],
      ["unknown", 0.1],
    ]);
  });

  it("reports the highest peak of parallel sessions", () => {
    const s = summarize(
      [agg("2026-11-06", "claude", { hours: { 9: 10 }, peakSessions: 4 }), agg("2026-11-07", "codex", { hours: { 9: 10 }, peakSessions: 2 })],
      { period: "7d", today: TODAY },
    );
    expect(s.totals.peakSessions).toBe(4);
  });

  it("finds the longest streak, busiest hour and weekday", () => {
    const s = summarize(
      [
        agg("2026-11-02", "claude", { hours: { 14: 20 } }), // Monday
        agg("2026-11-03", "claude", { hours: { 14: 20, 9: 5 } }),
        agg("2026-11-04", "codex", { hours: { 22: 50 } }), // Wednesday
        agg("2026-11-06", "claude", { hours: { 14: 5 } }),
      ],
      { period: "7d", today: TODAY },
    );
    expect(s.longestStreakDays).toBe(3);
    expect(s.busiestHour).toBe(22);
    expect(s.busiestWeekday).toBe(2);
    expect(s.heatmap[0]![14]).toBe(20);
    expect(s.heatmap[4]![14]).toBe(5);
    expect(s.totals.activeDays).toBe(4);
  });

  it("hides files and repositories when asked", () => {
    const rows = [
      agg("2026-11-07", "claude", {
        hours: { 9: 90 },
        files: { "secret-plan.md": 30 },
        tools: { Edit: 30 },
        repos: { "acme-internal": { minutes: 90, tokens: 5000 } },
      }),
    ];
    const shown = summarize(rows, { period: "7d", today: TODAY });
    expect(shown.topFiles).toEqual([{ name: "secret-plan.md", count: 30 }]);
    expect(shown.topRepos).toEqual([{ name: "acme-internal", tokens: 5000, minutes: 90 }]);
    expect(shown.archetype.sentence).toContain("secret-plan.md");

    const hidden = summarize(rows, { period: "7d", today: TODAY, hideFiles: true, hideRepos: true });
    expect(hidden.topFiles).toEqual([]);
    expect(hidden.topRepos).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain("secret-plan");
    expect(JSON.stringify(hidden)).not.toContain("acme-internal");
  });
});

describe("automated runs", () => {
  // Interactive 10:00-10:29. A script runs 10:20-10:59, in parallel with the person at 10:20-10:29.
  const rows = [
    agg("2026-11-06", "claude", {
      hours: { 10: 30 },
      messages: 4,
      automated: automated([[620, 659]], { sessions: 2, messages: 2, peakSessionsAll: 3, longestSessionMinutes: 40, repoMinutes: { bot: 40 } }),
      repos: { bot: { minutes: 0, tokens: 900 } },
    }),
  ];

  it("are left out of time, sessions and prompts by default", () => {
    const s = summarize(rows, { period: "7d", today: TODAY });
    expect(s.totals.activeMinutes).toBe(30);
    expect(s.totals.sessions).toBe(1);
    expect(s.totals.messages).toBe(4);
    expect(s.totals.peakSessions).toBe(1);
    // The repository still shows: tokens from automated runs always count.
    expect(s.topRepos).toEqual([{ name: "bot", tokens: 900, minutes: 0 }]);
    expect(s.totals.automated).toEqual({
      included: false,
      sessions: 2,
      messages: 2,
      activeMinutes: 40,
      addedMinutes: 30,
      agentMinutes: 40,
    });
  });

  it("are folded back in with includeAutomated", () => {
    const s = summarize(rows, { period: "7d", today: TODAY, includeAutomated: true });
    expect(s.totals.activeMinutes).toBe(60);
    expect(s.totals.agentMinutes).toBe(70);
    expect(s.totals.sessions).toBe(3);
    expect(s.totals.messages).toBe(6);
    expect(s.totals.peakSessions).toBe(3);
    expect(s.longestSessionMinutes).toBe(40);
    expect(s.topRepos).toEqual([{ name: "bot", tokens: 900, minutes: 40 }]);
    expect(s.totals.automated.included).toBe(true);
  });

  it("count toward active days only when included", () => {
    const onlyAuto = [agg("2026-11-07", "claude", { automated: automated([[60, 69]]) })];
    expect(summarize(onlyAuto, { period: "7d", today: TODAY }).totals.activeDays).toBe(0);
    expect(summarize(onlyAuto, { period: "7d", today: TODAY, includeAutomated: true }).totals.activeDays).toBe(1);
  });
});

describe("repositories", () => {
  it("are ranked by tokens and summed across machines", () => {
    const rows = [
      agg("2026-11-06", "claude", { hours: { 9: 10 }, repos: { web: { minutes: 10, tokens: 500 }, api: { minutes: 60, tokens: 200 } } }),
      agg("2026-11-06", "claude", { hours: { 9: 10 }, repos: { api: { minutes: 30, tokens: 400 } } }),
      agg("2026-11-07", "codex", { hours: { 9: 10 }, repos: { cli: { minutes: 5, tokens: 100 } } }),
    ];
    const s = summarize(rows, { period: "7d", today: TODAY });
    expect(s.topRepos).toEqual([
      { name: "api", tokens: 600, minutes: 90 },
      { name: "web", tokens: 500, minutes: 10 },
      { name: "cli", tokens: 100, minutes: 5 },
    ]);
  });
});
