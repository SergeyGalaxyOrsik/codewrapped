import type { Period } from "./types";

const DAY_MS = 86_400_000;

function toMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromMs(toMs(day) + n * DAY_MS);
}

/** Inclusive number of days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS) + 1;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(toMs(day)).getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/**
 * First day of a period ending on `today` (inclusive), or null for "all".
 * "year" is the calendar year so far.
 */
export function periodStart(period: Period, today: string): string | null {
  switch (period) {
    case "7d":
      return addDays(today, -6);
    case "30d":
      return addDays(today, -29);
    case "90d":
      return addDays(today, -89);
    case "year":
      return `${today.slice(0, 4)}-01-01`;
    case "all":
      return null;
  }
}
