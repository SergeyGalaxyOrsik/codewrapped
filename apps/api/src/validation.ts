import { z } from "zod";
import { MASK_BASE64_LENGTH, SOURCES, decodeMask } from "@codewrapped/stats";

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

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a date");

export const DailyAggregateSchema = z.object({
  day,
  // Only harnesses with a shipped adapter. Deploy the API before a CLI that sends a new one.
  source: z.enum(SOURCES),
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
  days: z.array(DailyAggregateSchema).max(400),
});

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
