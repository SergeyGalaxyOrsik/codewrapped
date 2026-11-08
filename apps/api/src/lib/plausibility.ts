import { countMinutes, decodeMask, emptyMask, headlineTokens, orInto, type DailyAggregate } from "@codewrapped/stats";

/**
 * Limits a real day stays far below. Heavy real use with many parallel
 * sessions stays several times under the token rate.
 */
export const LIMITS = {
  /** Headline tokens per wall-clock active minute, interactive and automated together. */
  tokensPerActiveMinute: 250_000,
  maxParallelSessions: 50,
} as const;

/** Why a synced day looks implausible, or null. The minute mask already caps a day at 1440 minutes. */
export function flagDay(d: DailyAggregate): string | null {
  const wall = emptyMask();
  orInto(wall, decodeMask(d.activeMask));
  orInto(wall, decodeMask(d.automated.activeMask));
  const minutes = countMinutes(wall);
  const peak = Math.max(d.peakSessions, d.automated.peakSessionsAll);
  if (peak > LIMITS.maxParallelSessions) return `more than ${LIMITS.maxParallelSessions} sessions at once`;
  const agent = d.agentMinutes + d.automated.agentMinutes;
  if (agent > Math.max(minutes, 1) * LIMITS.maxParallelSessions) return "agent time far above wall-clock time";
  if (headlineTokens(d.tokens) > Math.max(minutes, 1) * LIMITS.tokensPerActiveMinute) return "too many tokens per active minute";
  return null;
}
