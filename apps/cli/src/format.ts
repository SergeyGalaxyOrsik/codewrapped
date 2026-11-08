import { formatDuration, WEEKDAYS, type Summary } from "@codewrapped/stats";
import { bold, compact, dim, hours, int, pad, padStart, ribbon, shortName, usd } from "./ui";

export const SOURCE_NAMES = { claude: "Claude Code", codex: "Codex" } as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;

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

export function formatSummary(s: Summary): string {
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

  if (s.source === "all" && s.bySource.claude.activeMinutes > 0 && s.bySource.codex.activeMinutes > 0) {
    const total = s.bySource.claude.activeMinutes + s.bySource.codex.activeMinutes;
    lines.push(
      `  ${dim("Agents")}  ${SOURCE_NAMES.claude} ${pct(s.bySource.claude.activeMinutes / total)}, ${SOURCE_NAMES.codex} ${pct(s.bySource.codex.activeMinutes / total)} of active time`,
    );
  }
  const models = s.models.filter((m) => m.share >= 0.01).slice(0, 4);
  if (models.length > 0) {
    lines.push(`  ${dim("Models")}  ${models.map((m) => `${m.model} ${pct(m.share)}`).join(", ")}`);
  }
  if (t.unpricedTokens > 0) {
    lines.push(dim(`          ${compact(t.unpricedTokens)} tokens from models with no known price are not in the cost.`));
  }
  const auto = t.automated;
  if (!auto.included && auto.sessions > 0) {
    lines.push(
      dim(`  Not in hours: ${hours(auto.addedMinutes)} of automated runs (${plural(auto.sessions, "session")}). Add --include-automated to count them.`),
    );
  }
  lines.push("");
  lines.push(`  ${bold(`${s.archetype.name}.`)} ${s.archetype.sentence}`);
  return lines.join("\n");
}
