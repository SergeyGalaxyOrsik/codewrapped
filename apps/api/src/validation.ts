import { z } from "zod";
import { MASK_BASE64_LENGTH, decodeMask, type DailyAggregate } from "@codewrapped/stats";

const count = z.number().finite().nonnegative().max(1e13);
const name = z.string().min(1).max(200);
/** Keyed counts such as tools or files. Capped so one row stays small. */
const counts = z.record(name, count).refine((r) => Object.keys(r).length <= 500, "too many keys");

const mask = z
  .string()
  .length(MASK_BASE64_LENGTH)
  .refine((m) => {
    try {
      decodeMask(m);
      return true;
    } catch {
      return false;
    }
  }, "not a 1440 bit mask");

/** The earliest day a sync may hold. */
export const FIRST_DAY = "2024-01-01";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "not a date")
  .refine((d) => d >= FIRST_DAY, `before ${FIRST_DAY}`);

export const DailyAggregateSchema = z.object({
  day,
  /**
   * Any harness id. Rows of harnesses the registry does not know are stored
   * and shown once it does, so the CLI and the API can ship in any order.
   */
  source: z.string().regex(/^[a-z0-9-]{1,32}$/),
  sessions: count,
  messages: count,
  activeMask: mask,
  agentMinutes: count,
  peakSessions: count,
  longestSessionMinutes: count,
  tokens: z.object({ input: count, output: count, cacheRead: count, cacheWrite: count }),
  models: z
    .record(name, z.object({ tokens: count, cacheRead: count, costUsd: count.nullable() }))
    .refine((r) => Object.keys(r).length <= 100, "too many models"),
  tools: counts,
  toolCategories: z
    .record(name, count)
    .refine((r) => Object.keys(r).length <= 20, "too many categories")
    .optional(),
  files: counts,
  repos: z
    .record(name, z.object({ minutes: count, tokens: count }))
    .refine((r) => Object.keys(r).length <= 500, "too many repositories"),
  automated: z.object({
    sessions: count,
    messages: count,
    activeMask: mask,
    agentMinutes: count,
    longestSessionMinutes: count,
    peakSessionsAll: count,
    repoMinutes: counts,
  }),
  schemaVersion: z.literal(1),
});

export const SyncBody = z.object({
  machineId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  timeZone: z.string().min(1).max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "not a timezone"),
  /** Checked one by one in the handler: a bad row is skipped, never the whole upload. */
  days: z.array(z.unknown()).max(400),
});

/** A synced row. The source may be a harness this server does not know yet. */
export type SyncedDay = Omit<DailyAggregate, "source"> & { source: string };

export type SkippedDay = { index: number; day: string | null; source: string | null; reason: string };

/**
 * What one upload may add. `latestDay` is tomorrow in UTC, the furthest any timezone's today
 * reaches. `sources` are the harnesses the account already holds.
 */
export type SyncLimits = { latestDay: string; sources: ReadonlySet<string>; maxSources: number };

/**
 * Splits uploaded rows into valid ones and skipped ones with the first problem of each.
 * A day and source sent twice keeps the last copy, as a later sync of it would.
 */
export function checkDays(days: unknown[], limits: SyncLimits): { valid: SyncedDay[]; skipped: SkippedDay[] } {
  const byKey = new Map<string, { index: number; row: SyncedDay }>();
  const skipped: SkippedDay[] = [];
  const sources = new Set(limits.sources);
  days.forEach((raw, index) => {
    const parsed = DailyAggregateSchema.safeParse(raw);
    if (parsed.success) {
      const row = parsed.data as SyncedDay;
      const skip = (reason: string) => void skipped.push({ index, day: row.day, source: row.source, reason });
      if (row.day > limits.latestDay) return skip("day: in the future");
      if (!sources.has(row.source) && sources.size >= limits.maxSources) return skip(`source: at most ${limits.maxSources} harnesses per account`);
      sources.add(row.source);
      const key = `${row.day}/${row.source}`;
      const earlier = byKey.get(key);
      if (earlier) skipped.push({ index: earlier.index, day: row.day, source: row.source, reason: `row: day and source sent again at ${index}` });
      byKey.set(key, { index, row });
      return;
    }
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const issue = parsed.error.issues[0];
    skipped.push({
      index,
      day: typeof r.day === "string" ? r.day.slice(0, 10) : null,
      source: typeof r.source === "string" ? r.source.slice(0, 32) : null,
      reason: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`,
    });
  });
  const valid = [...byKey.values()].sort((a, b) => a.index - b.index).map((v) => v.row);
  return { valid, skipped: skipped.sort((a, b) => a.index - b.index) };
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
