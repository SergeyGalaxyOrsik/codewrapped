import { SOURCE_NAMES, SOURCES, type Source } from "./types";

export type ArchetypeMetrics = {
  activeMinutes: number;
  /** Active minutes between 22:00 and 04:00 local time. */
  nightMinutes: number;
  /** Active minutes on Saturday and Sunday. */
  weekendMinutes: number;
  minutesBySource: Partial<Record<Source, number>>;
  toolCalls: number;
  shellCalls: number;
  readCalls: number;
  editCalls: number;
  topFile: { name: string; count: number } | null;
  fileEdits: number;
  longestSessionMinutes: number;
  activeDays: number;
  periodDays: number;
};

export type ArchetypeId =
  | "night-shift"
  | "shell-first"
  | "reader"
  | "one-file-fixer"
  | "marathoner"
  | "weekend-builder"
  | "two-agents"
  | "steady";

export type Archetype = {
  id: ArchetypeId;
  name: string;
  /** One plain sentence, without the name. */
  sentence: string;
};

export type ArchetypeOptions = { hideFiles?: boolean };

/** Tunable thresholds. Rules below a minimum sample size are skipped. */
export const ARCHETYPE_THRESHOLDS = {
  minActiveMinutes: 60,
  minToolCalls: 20,
  minFileEdits: 10,
  nightShare: 0.4,
  shellShare: 0.4,
  readToEditRatio: 3,
  topFileShare: 0.25,
  marathonMinutes: 180,
  weekendShare: 0.35,
  sourceShare: 0.25,
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

type Rule = {
  id: ArchetypeId;
  name: string;
  /** Returns the sentence when the rule matches, or null. */
  match: (m: ArchetypeMetrics, o: ArchetypeOptions) => string | null;
};

const T = ARCHETYPE_THRESHOLDS;

/** Checked in order. The first match wins. */
export const ARCHETYPE_RULES: readonly Rule[] = [
  {
    id: "night-shift",
    name: "Night shift",
    match: (m) => {
      if (m.activeMinutes < T.minActiveMinutes) return null;
      const share = m.nightMinutes / m.activeMinutes;
      return share > T.nightShare ? `${pct(share)} of your agent time was between 22:00 and 04:00.` : null;
    },
  },
  {
    id: "shell-first",
    name: "Shell first",
    match: (m) => {
      if (m.toolCalls < T.minToolCalls) return null;
      const share = m.shellCalls / m.toolCalls;
      return share > T.shellShare ? `${pct(share)} of tool calls were shell commands.` : null;
    },
  },
  {
    id: "reader",
    name: "Reader",
    match: (m) => {
      if (m.toolCalls < T.minToolCalls || m.readCalls === 0) return null;
      if (m.editCalls === 0) return `Your agents read or searched ${m.readCalls} times and edited nothing.`;
      const ratio = m.readCalls / m.editCalls;
      return ratio >= T.readToEditRatio
        ? `Your agents read or searched ${Math.floor(ratio)} times for every edit.`
        : null;
    },
  },
  {
    id: "one-file-fixer",
    name: "One-file fixer",
    match: (m, o) => {
      if (!m.topFile || m.fileEdits < T.minFileEdits) return null;
      const share = m.topFile.count / m.fileEdits;
      if (share <= T.topFileShare) return null;
      const target = o.hideFiles ? "a single file" : m.topFile.name;
      return `${pct(share)} of your edits went to ${target}.`;
    },
  },
  {
    id: "marathoner",
    name: "Marathoner",
    match: (m) =>
      m.longestSessionMinutes > T.marathonMinutes
        ? `Your longest session ran ${formatDuration(m.longestSessionMinutes)}.`
        : null,
  },
  {
    id: "weekend-builder",
    name: "Weekend builder",
    match: (m) => {
      if (m.activeMinutes < T.minActiveMinutes) return null;
      const share = m.weekendMinutes / m.activeMinutes;
      return share > T.weekendShare ? `${pct(share)} of your agent time was on Saturday and Sunday.` : null;
    },
  },
  {
    id: "two-agents",
    name: "Two agents",
    match: (m) => {
      if (m.activeMinutes < T.minActiveMinutes) return null;
      const [a, b] = SOURCES.map((src) => ({ name: SOURCE_NAMES[src], share: (m.minutesBySource[src] ?? 0) / m.activeMinutes }))
        .sort((x, y) => y.share - x.share);
      return a && b && a.share > T.sourceShare && b.share > T.sourceShare
        ? `${a.name} had ${pct(a.share)} of your time, ${b.name} ${pct(b.share)}.`
        : null;
    },
  },
  {
    id: "steady",
    name: "Steady",
    match: (m) => `You worked with agents on ${m.activeDays} of ${m.periodDays} days.`,
  },
];

export function pickArchetype(m: ArchetypeMetrics, o: ArchetypeOptions = {}): Archetype {
  for (const rule of ARCHETYPE_RULES) {
    const sentence = rule.match(m, o);
    if (sentence) return { id: rule.id, name: rule.name, sentence };
  }
  // Unreachable: "steady" always matches.
  return { id: "steady", name: "Steady", sentence: "" };
}
