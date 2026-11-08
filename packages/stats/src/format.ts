/** Number and text formatting shared by the CLI, the card and the web. */

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 3 significant figures with a unit: 1.82B, 41.2M, 238M, 940. */
export function formatCompact(n: number): string {
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units) {
    if (n >= size * 0.9995) {
      const v = n / size;
      const digits = v < 9.995 ? 2 : v < 99.95 ? 1 : 0;
      return `${Number(v.toFixed(digits))}${unit}`;
    }
  }
  return formatInt(n);
}

/** $4.12, $41, $12,480. */
export function formatUsd(n: number): string {
  if (n >= 10) return `$${formatInt(n)}`;
  return `$${n.toFixed(2)}`;
}

/** Whole hours from 1 hour up, minutes below. */
export function durationParts(minutes: number): { value: string; unit: "h" | "min" } {
  if (minutes < 60) return { value: formatInt(minutes), unit: "min" };
  return { value: formatInt(minutes / 60), unit: "h" };
}

export function formatHours(minutes: number): string {
  const p = durationParts(minutes);
  return `${p.value} ${p.unit}`;
}

/** "1 session", "291 sessions". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

/**
 * Shortens a name to `max` characters by cutting the middle, and keeps the
 * file extension: AutomationRunHistoryTable.test.tsx -> AutomationRu...test.tsx
 */
export function truncateMiddle(name: string, max: number): string {
  if (name.length <= max) return name;
  const keep = Math.max(4, max - 3);
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? "";
  const tail = Math.min(keep - 1, Math.max(ext.length, Math.floor(keep * 0.45)));
  const head = keep - tail;
  return `${name.slice(0, head)}...${name.slice(name.length - tail)}`;
}

/** mcp__claude-in-chrome__computer -> claude-in-chrome: computer */
export function displayToolName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]}: ${mcp[2]}` : name;
}
