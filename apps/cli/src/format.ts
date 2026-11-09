import { MAX_LINE_BYTES, type ParseWarnings } from "@codewrapped/parser";
import { describeAutomated, formatDuration, formatShare, harnessSplit, SOURCE_NAMES, SOURCES, sourceLabel, WEEKDAYS, type Source, type Summary } from "@codewrapped/stats";
import { bold, compact, dim, hours, int, pad, padStart, ribbon, safeDeep, safeText, shortName, tildify, usd } from "./ui";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;

/** "a, b and c". */
export const listText = (items: string[]) => items.join(", ").replace(/, ([^,]*)$/, " and $1");

export function periodLabel(s: Summary): string {
  return s.range.days === 1 ? "today" : `last ${s.range.days} days`;
}

function column(title: string, rows: Array<[string, string]>, nameWidth: number): string[] {
  const valueWidth = Math.max(0, ...rows.map(([, v]) => v.length));
  const lines = [dim(title)];
  for (const [name, value] of rows) lines.push(`${pad(shortName(name, nameWidth), nameWidth)}  ${padStart(value, valueWidth)}`);
  return lines;
}

function sideBySide(columns: string[][], gap = 4): string[] {
  const widths = columns.map((c) => Math.max(...c.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length)));
  const height = Math.max(...columns.map((c) => c.length));
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(
      columns
        .map((c, j) => (j === columns.length - 1 ? (c[i] ?? "") : pad(c[i] ?? "", widths[j]! + gap)))
        .join("")
        .trimEnd(),
    );
  }
  return out;
}

export function formatSummary(summary: Summary): string {
  const s = safeDeep(summary);
  const t = s.totals;
  const lines: string[] = [];
  const label = periodLabel(s);
  lines.push(ribbon(`━━━━━━━━━━━━━━━━━━  ${label}  ━━━━━━━━━━━━━━━━━━`));
  lines.push(dim(`${s.range.start} to ${s.range.end}`));
  lines.push("");

  if (t.activeMinutes === 0 && t.sessions === 0 && t.tokens.headline === 0) {
    lines.push("No agent activity in this period.");
    return lines.join("\n");
  }

  const cost = t.costUsd > 0 ? `, ${bold(usd(t.costUsd))} at API prices (est.)` : "";
  lines.push(`  ${bold(compact(t.tokens.headline))} tokens${cost}`);
  lines.push(`  ${bold(hours(t.activeMinutes))} with coding agents`);
  if (t.peakSessions > 1) {
    lines.push(`  ${hours(t.agentMinutes)} of agent time, up to ${t.peakSessions} sessions at once`);
  }
  const streak = s.longestStreakDays > 1 ? `, ${s.longestStreakDays}-day streak` : "";
  lines.push(`  ${plural(t.sessions, "session")}, ${plural(t.messages, "prompt")}${streak}`);
  const facts: string[] = [];
  if (s.longestSessionMinutes > 0) facts.push(`Longest session ${formatDuration(s.longestSessionMinutes)}`);
  if (s.busiestWeekday !== null && s.busiestHour !== null) {
    facts.push(`busiest on ${WEEKDAYS[s.busiestWeekday]} at ${String(s.busiestHour).padStart(2, "0")}:00`);
  }
  if (facts.length > 0) lines.push(`  ${facts.join(", ")}.`);
  lines.push("");

  const columns: string[][] = [];
  if (s.topRepos.length > 0) columns.push(column("Repositories", s.topRepos.map((r) => [r.name, `${compact(r.tokens)} tokens`]), 18));
  if (s.topFiles.length > 0) columns.push(column("Most edited", s.topFiles.slice(0, 3).map((f) => [f.name, int(f.count)]), 20));
  if (s.topTools.length > 0) columns.push(column("Tools", s.topTools.slice(0, 3).map((f) => [f.name, int(f.count)]), 16));
  if (columns.length > 0) {
    for (const l of sideBySide(columns)) lines.push(`  ${l}`);
    lines.push("");
  }

  const split = s.source === "all" ? harnessSplit(s.bySource, "activeMinutes") : [];
  if (split.length > 1) {
    const name = (h: (typeof split)[number]) => (h.source === "other" ? h.name : sourceLabel(h.source));
    lines.push(`  ${dim("Agents")}  ${split.map((h) => `${name(h)} ${formatShare(h.share)}`).join(", ")} of active time`);
  }
  const models = s.models.filter((m) => m.share >= 0.01).slice(0, 4);
  if (models.length > 0) {
    lines.push(`  ${dim("Models")}  ${models.map((m) => `${m.model} ${pct(m.share)}`).join(", ")}`);
  }
  if (t.unpricedTokens > 0) {
    lines.push(dim(`          ${compact(t.unpricedTokens)} tokens from models with no known price are not in the cost.`));
  }
  const auto = t.automated;
  if (auto.sessions > 0) {
    lines.push(dim(`  ${describeAutomated(auto)}`));
    if (!auto.included) lines.push(dim("  Add --include-automated to count them."));
  }
  lines.push("");
  lines.push(`  ${bold(`${s.archetype.name}.`)} ${s.archetype.sentence}`);
  return lines.join("\n");
}

/** Adapters report a database they could not open as this unknown event. */
const UNREADABLE_DATABASE = /^[^:]+:\(unreadable database: (.*)\)$/;
const LISTED_FILES = 3;

/** What was left out of the stats, one sentence per line. */
export function warningLines(w: Record<Source, ParseWarnings>): string[] {
  const lines: string[] = [];
  const files: string[] = [];
  let bad = 0;
  let long = 0;
  let unknown = 0;
  for (const s of SOURCES) {
    bad += w[s].badLines;
    long += w[s].longLines ?? 0;
    for (const f of w[s].unreadableFiles ?? []) files.push(`${tildify(f.file)} (${safeText(f.reason)})`);
    for (const [event, n] of Object.entries(w[s].unknownEvents)) {
      const db = UNREADABLE_DATABASE.exec(event);
      if (db) lines.push(`Could not read the ${SOURCE_NAMES[s]} database (${safeText(db[1]!)}), so it is not counted.`);
      else unknown += n;
    }
  }
  if (files.length > 0) {
    const more = files.length > LISTED_FILES ? ` and ${int(files.length - LISTED_FILES)} more` : "";
    const which = files.length === 1 ? "this file" : "these files";
    lines.push(`Could not read ${which}, so ${files.length === 1 ? "it is" : "they are"} not counted: ${files.slice(0, LISTED_FILES).join(", ")}${more}.`);
  }
  const parts: string[] = [];
  if (bad > 0) parts.push(`${int(bad)} unreadable ${bad === 1 ? "line" : "lines"}`);
  if (long > 0) parts.push(`${int(long)} ${long === 1 ? "line" : "lines"} over ${MAX_LINE_BYTES / 1024 / 1024} MB`);
  if (unknown > 0) parts.push(`${int(unknown)} unknown ${unknown === 1 ? "event" : "events"}`);
  if (parts.length > 0) lines.push(`Skipped ${listText(parts)}.`);
  return lines;
}
