import { homedir } from "node:os";
import { displayToolName, formatCompact, formatHours, formatInt, formatUsd, truncateMiddle } from "@codewrapped/stats";

const enabled = (stream: NodeJS.WriteStream) =>
  !process.env.NO_COLOR && process.env.TERM !== "dumb" && (stream.isTTY || Boolean(process.env.FORCE_COLOR));

const color = enabled(process.stdout);
const wrap = (open: string, close: string) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const bold = wrap("1", "22");
export const dim = wrap("2", "22");
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "");
/** Brand ribbon red. Only used for the ribbon line, never for errors. */
export const ribbon = wrap(truecolor ? "38;2;229;50;45" : "31", "39");

// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Removes control characters and bidi overrides, so a name from a log file
 * or a message from the server cannot move the cursor, recolor the terminal,
 * set the window title or reorder the text around it.
 */
export function safeText(s: string): string {
  return s.replace(UNPRINTABLE, "");
}

/** A copy with safeText applied to every string, keys included. */
export function safeDeep<T>(value: T): T {
  if (typeof value === "string") return safeText(value) as T;
  if (Array.isArray(value)) return value.map(safeDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [safeText(k), safeDeep(v)])) as T;
  }
  return value;
}

export function tildify(p: string): string {
  const home = homedir();
  return safeText(p.startsWith(home) ? `~${p.slice(home.length)}` : p);
}

export const int = formatInt;
export const compact = formatCompact;
export const usd = formatUsd;
export const hours = formatHours;

/** Shortens names such as mcp__claude-in-chrome__computer for display. */
export function shortName(name: string, max: number): string {
  return truncateMiddle(displayToolName(name), max);
}

/** Visible length, ignoring ANSI codes. */
export function visible(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visible(s)));
}

export function padStart(s: string, width: number): string {
  return " ".repeat(Math.max(0, width - visible(s))) + s;
}
