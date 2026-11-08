import { describe, expect, it } from "vitest";
import { ARCHETYPE_RULES, formatDuration, pickArchetype, type ArchetypeMetrics } from "../src/index";

const base: ArchetypeMetrics = {
  activeMinutes: 600,
  nightMinutes: 0,
  weekendMinutes: 0,
  minutesBySource: { claude: 600, codex: 0 },
  toolCalls: 100,
  shellCalls: 10,
  readCalls: 20,
  editCalls: 20,
  topFile: { name: "page.tsx", count: 5 },
  fileEdits: 100,
  longestSessionMinutes: 60,
  activeDays: 18,
  periodDays: 30,
};

const pick = (m: Partial<ArchetypeMetrics>, o = {}) => pickArchetype({ ...base, ...m }, o);

describe("archetypes", () => {
  it("are checked in the documented order", () => {
    expect(ARCHETYPE_RULES.map((r) => r.id)).toEqual([
      "night-shift",
      "shell-first",
      "reader",
      "one-file-fixer",
      "marathoner",
      "weekend-builder",
      "two-agents",
      "steady",
    ]);
  });

  it("Night shift: over 40% of time between 22:00 and 04:00", () => {
    expect(pick({ nightMinutes: 241 })).toEqual({
      id: "night-shift",
      name: "Night shift",
      sentence: "40% of your agent time was between 22:00 and 04:00.",
    });
    expect(pick({ nightMinutes: 240 }).id).toBe("steady");
  });

  it("Shell first: over 40% of tool calls", () => {
    expect(pick({ shellCalls: 41 }).sentence).toBe("41% of tool calls were shell commands.");
    expect(pick({ shellCalls: 40 }).id).toBe("steady");
  });

  it("Reader: 3 reads or searches per edit", () => {
    expect(pick({ readCalls: 60 }).sentence).toBe("Your agents read or searched 3 times for every edit.");
    expect(pick({ readCalls: 59 }).id).toBe("steady");
    expect(pick({ readCalls: 30, editCalls: 0 }).sentence).toBe("Your agents read or searched 30 times and edited nothing.");
  });

  it("One-file fixer: top file over 25% of edits, file name hidden on request", () => {
    expect(pick({ topFile: { name: "page.tsx", count: 26 } }).sentence).toBe("26% of your edits went to page.tsx.");
    expect(pick({ topFile: { name: "page.tsx", count: 26 } }, { hideFiles: true }).sentence).toBe(
      "26% of your edits went to a single file.",
    );
    expect(pick({ topFile: { name: "page.tsx", count: 25 } }).id).toBe("steady");
  });

  it("Marathoner: a session over 3 hours", () => {
    expect(pick({ longestSessionMinutes: 252 }).sentence).toBe("Your longest session ran 4 h 12 min.");
    expect(pick({ longestSessionMinutes: 180 }).id).toBe("steady");
  });

  it("Weekend builder: over 35% of time on Saturday and Sunday", () => {
    expect(pick({ weekendMinutes: 216 }).id).toBe("weekend-builder");
    expect(pick({ weekendMinutes: 210 }).id).toBe("steady");
  });

  it("Two agents: both over 25% of active time", () => {
    expect(pick({ minutesBySource: { claude: 360, codex: 240 } }).sentence).toBe("Claude Code had 60% of your time, Codex 40%.");
    expect(pick({ minutesBySource: { claude: 450, codex: 150 } }).id).toBe("steady");
  });

  it("Steady is the fallback", () => {
    expect(pick({}).sentence).toBe("You worked with agents on 18 of 30 days.");
  });

  it("the first match wins", () => {
    expect(pick({ nightMinutes: 300, shellCalls: 90, longestSessionMinutes: 400 }).id).toBe("night-shift");
    expect(pick({ shellCalls: 90, readCalls: 0, longestSessionMinutes: 400 }).id).toBe("shell-first");
  });

  it("needs a minimum sample before a share-based rule can match", () => {
    expect(pick({ activeMinutes: 30, nightMinutes: 30, minutesBySource: { claude: 30, codex: 0 } }).id).toBe("steady");
    expect(pick({ toolCalls: 5, shellCalls: 5 }).id).toBe("steady");
    expect(pick({ fileEdits: 4, topFile: { name: "a", count: 4 } }).id).toBe("steady");
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(754)).toBe("12 h 34 min");
  });
});
