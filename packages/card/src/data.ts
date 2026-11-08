import { site, type Theme } from "@codewrapped/brand";
import {
  displayToolName,
  durationParts,
  formatCompact,
  formatHours,
  formatInt,
  formatShare,
  formatUsd,
  plural,
  truncateMiddle,
  WEEKDAYS,
  type PublicSummary,
} from "@codewrapped/stats";

/** A local summary or a public one with hidden sections set to null. */
export type CardSummary = PublicSummary;

export type CardOptions = {
  theme?: Theme;
  /** Public handle without the @, or null for a local card. */
  handle?: string | null;
  /** Percentile among codewrapped users this month, from the public profile. */
  standing?: { percentile: number; period: "month" } | null;
};

export type CardStat = { value: string; label: string };

/** Everything the card shows, already formatted. Layouts only arrange it. */
export type CardData = {
  theme: Theme;
  handle: string | null;
  /** "Top 4% this month", shown next to the handle. */
  standing: string | null;
  /** "last 30 days". Carried by the ribbon. */
  period: string;
  /** "Oct 10 to Nov 8, 2026". */
  range: string;
  /** Headline tokens: input, output and cache writes. */
  hero: { value: string; unit: string };
  /** "with Claude Code and Codex". Names only the agents that were used. */
  heroLabel: string;
  /** "120 h of agent time, up to 4 sessions at once", or null without parallel work. */
  parallel: string | null;
  stats: CardStat[];
  /** Top repositories by tokens; else most edited files; else models. */
  ranked: { title: string; rows: Array<{ name: string; count: string }> } | null;
  tools: Array<{ name: string; count: string; share: number }>;
  /** 7 x 24 heat steps 0-4, Monday first. Null when hidden. */
  heatmap: number[][] | null;
  busiest: string | null;
  archetype: { name: string; sentence: string };
  command: string;
  url: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(day: string, withYear: boolean): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function formatRange(start: string, end: string): string {
  if (start === end) return shortDate(end, true);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${shortDate(start, !sameYear)} to ${shortDate(end, true)}`;
}

export function periodLabel(s: CardSummary): string {
  if (s.period === "all") return "all time";
  if (s.period === "year" && !s.truncated) return `${s.range.end.slice(0, 4)} so far`;
  return s.range.days === 1 ? "today" : `last ${s.range.days} days`;
}

/**
 * Heat step 0-4 per cell: the higher of its quartile among non-empty cells
 * and its share of the busiest cell. Quartiles give a heavy user contrast;
 * the share keeps a light user's few even cells from all looking faint.
 */
export function heatSteps(heatmap: number[][]): number[][] {
  const values = heatmap.flat().filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length === 0) return heatmap.map((row) => row.map(() => 0));
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))]!;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const max = values[values.length - 1]!;
  return heatmap.map((row) =>
    row.map((v) => {
      if (v <= 0) return 0;
      const quartile = v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4;
      const share = Math.ceil((v / max) * 4);
      return Math.max(quartile, share);
    }),
  );
}

function agentsLabel(s: CardSummary): string {
  const claude = s.bySource.claude.activeMinutes > 0;
  const codex = s.bySource.codex.activeMinutes > 0;
  if (claude && codex) return "with Claude Code and Codex";
  if (claude) return "with Claude Code";
  if (codex) return "with Codex";
  return "with coding agents";
}

export function cardData(s: CardSummary, opts: CardOptions = {}): CardData {
  const t = s.totals;
  const handle = opts.handle ?? null;
  const time = durationParts(t.activeMinutes);

  const stats: CardStat[] = [{ value: `${time.value} ${time.unit}`, label: "with agents" }];
  if (t.costUsd !== null && t.costUsd > 0) stats.push({ value: formatUsd(t.costUsd), label: "at API prices (est.)" });
  stats.push({
    value: formatInt(t.sessions),
    label: `${t.sessions === 1 ? "session" : "sessions"}${s.longestStreakDays > 1 ? `, ${s.longestStreakDays}-day streak` : ""}`,
  });

  const maxTool = s.topTools[0]?.count ?? 0;
  return {
    theme: opts.theme ?? "light",
    handle,
    standing: handle && opts.standing ? `Top ${opts.standing.percentile}% this month` : null,
    period: periodLabel(s),
    range: formatRange(s.range.start, s.range.end),
    hero: { value: formatCompact(t.tokens.headline), unit: "tokens" },
    heroLabel: agentsLabel(s),
    parallel:
      t.peakSessions > 1
        ? `${formatHours(t.agentMinutes)} of agent time, up to ${t.peakSessions} sessions at once`
        : null,
    stats,
    ranked:
      s.topRepos.length > 0
        ? { title: "Repositories", rows: s.topRepos.map((r) => ({ name: r.name, count: formatCompact(r.tokens) })) }
        : s.topFiles.length > 0
          ? { title: "Most edited", rows: s.topFiles.slice(0, 3).map((f) => ({ name: f.name, count: formatInt(f.count) })) }
          : s.models && s.models.length > 0
            ? { title: "Models", rows: s.models.slice(0, 3).map((m) => ({ name: m.model, count: formatShare(m.share) })) }
            : null,
    tools: s.topTools.slice(0, 3).map((f) => ({
      name: displayToolName(f.name),
      count: formatInt(f.count),
      share: maxTool > 0 ? f.count / maxTool : 0,
    })),
    heatmap: s.heatmap ? heatSteps(s.heatmap) : null,
    busiest:
      s.busiestWeekday !== null && s.busiestHour !== null
        ? `${WEEKDAYS[s.busiestWeekday]}s at ${String(s.busiestHour).padStart(2, "0")}:00`
        : null,
    archetype: {
      name: s.archetype.name,
      // A long file name in the sentence is shortened the same way as in the list.
      sentence:
        s.archetype.id === "one-file-fixer" && s.topFiles[0]
          ? s.archetype.sentence.replace(s.topFiles[0].name, truncateMiddle(s.topFiles[0].name, 28))
          : s.archetype.sentence,
    },
    command: site.command,
    url: handle ? `${site.host}/@${handle}` : site.host,
  };
}

export { plural };
