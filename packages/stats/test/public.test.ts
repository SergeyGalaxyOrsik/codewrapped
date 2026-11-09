import { describe, expect, it } from "vitest";
import { buildPublicProfile, DEFAULT_VISIBILITY, type Visibility } from "../src/index";
import { agg } from "./helpers";

const TODAY = "2026-11-08"; // a Sunday
const owner = { handle: "dev", displayName: null, avatarUrl: null, joinedAt: "2026-11-01" };
const ALL: Visibility = { files: true, repos: true, cost: true, models: true, tools: true, heatmap: true };
const NONE: Visibility = { files: false, repos: false, cost: false, models: false, tools: false, heatmap: false };

// A shell-heavy week, mostly at night, with names that must not leak when hidden.
const rows = [
  agg("2026-11-03", "claude", {
    hours: { 23: 60, 0: 30 },
    tools: { Bash: 40, Read: 5, Edit: 5 },
    toolCategories: { shell: 40, read: 5, edit: 5 },
    files: { "secret-plan.md": 5 },
    repos: { "acme-internal": { minutes: 90, tokens: 5000 } },
    models: { "claude-opus-5-5": { tokens: 5000, cacheRead: 0, costUsd: 12.5 } },
    tokens: { input: 4000, output: 1000 },
  }),
];

const profile = (vis: Visibility) => buildPublicProfile(owner, vis, rows, "7d", TODAY);

describe("public profile", () => {
  it("shows tool use when tools are visible", () => {
    const { summary } = profile(ALL);
    expect(summary.toolCategories).toMatchObject({ shell: 40, read: 5, edit: 5 });
    expect(summary.totals.toolCalls).toBe(50);
    expect(summary.topTools.map((t) => t.name)).toEqual(["Bash", "Edit", "Read"]);
  });

  it("hides every trace of tool use when tools are hidden", () => {
    const { summary } = profile({ ...ALL, tools: false, heatmap: false });
    expect(summary.topTools).toEqual([]);
    expect(summary.toolCategories).toBeNull();
    expect(summary.totals.toolCalls).toBeNull();
    expect(summary.archetype.id).not.toMatch(/shell-first|reader/);
    expect(summary.archetype.sentence).not.toMatch(/tool|shell|read or searched/i);
  });

  it("does not name the time of day when the heatmap is hidden", () => {
    expect(profile(ALL).summary.archetype.id).toBe("night-shift");
    const { summary } = profile({ ...ALL, heatmap: false });
    expect(summary.archetype.id).not.toMatch(/night-shift|weekend-builder/);
    expect(summary.archetype.sentence).not.toMatch(/22:00|Saturday/);
  });

  it("leaks no hidden name, cost or count with everything hidden", () => {
    const p = profile(NONE);
    const json = JSON.stringify(p);
    for (const secret of ["secret-plan", "acme-internal", "claude-opus", "Bash", "shell", "12.5"]) expect(json).not.toContain(secret);
    expect(p.summary.models).toBeNull();
    expect(p.summary.totals.costUsd).toBeNull();
    expect(p.allTime.costUsd).toBeNull();
    expect(p.summary.topFiles).toEqual([]);
    expect(p.summary.topRepos).toEqual([]);
    expect(p.summary.heatmap).toBeNull();
    expect(p.calendar).toBeNull();
  });

  it("defaults to hiding files and repositories", () => {
    const json = JSON.stringify(profile(DEFAULT_VISIBILITY));
    expect(json).not.toContain("secret-plan");
    expect(json).not.toContain("acme-internal");
  });
});
