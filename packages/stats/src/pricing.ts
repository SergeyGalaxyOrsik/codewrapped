/**
 * Public API prices in USD per million tokens, used to estimate what the
 * same usage would cost at pay-as-you-go API rates. Always shown as an
 * estimate: subscription plans are billed differently.
 *
 * Checked on 2026-11-08 against:
 * - Anthropic: Claude API pricing (claude-api skill model table, cached 2026-10-06,
 *   and its prompt-caching notes for cache read/write multipliers)
 * - OpenAI: https://developers.openai.com/api/docs/pricing (standard tier)
 *
 * Models that are not listed count tokens but get no cost.
 */
export const PRICING_CHECKED_ON = "2026-11-08";

export type Rate = {
  input: number;
  output: number;
  cacheRead: number;
  /** Short-lived cache write: Anthropic 5 minute TTL, OpenAI 30 minute. */
  cacheWrite: number;
  /** Long-lived cache write: Anthropic 1 hour TTL, OpenAI 12 hour. */
  cacheWriteLong: number;
};

export type ModelPrice = {
  base: Rate;
  /** Higher rate for requests whose prompt is above this many tokens. */
  longContext?: { aboveTokens: number; rate: Rate };
  /** Price multiplier for Anthropic fast mode. */
  fastMultiplier?: number;
};

/** Anthropic: cache read ~0.1x input unless set, writes 1.25x (5m) and 2x (1h). */
function anthropic(input: number, output: number, cacheRead = input * 0.1): Rate {
  return { input, output, cacheRead, cacheWrite: input * 1.25, cacheWriteLong: input * 2 };
}

function openai(input: number, cacheRead: number, cacheWrite: number, cacheWriteLong: number, output: number): Rate {
  return { input, output, cacheRead, cacheWrite, cacheWriteLong };
}

/** Keys are normalized model ids (see normalizeModelId). */
export const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-fable-5-1": { base: anthropic(10, 50, 0.25) },
  "claude-mythos-5-1": { base: anthropic(10, 50, 0.25) },
  "claude-fable-5": { base: anthropic(10, 50) },
  "claude-opus-5-5": { base: anthropic(4, 20, 0.2), fastMultiplier: 2 },
  "claude-opus-5": { base: anthropic(5, 25), fastMultiplier: 2 },
  "claude-opus-4-8": { base: anthropic(5, 25) },
  "claude-opus-4-7": { base: anthropic(5, 25) },
  "claude-opus-4-6": { base: anthropic(5, 25) },
  "claude-sonnet-5-5": { base: anthropic(2, 10, 0.2) },
  "claude-sonnet-5": { base: anthropic(2, 10) },
  "claude-sonnet-4-6": { base: anthropic(3, 15) },
  "claude-haiku-5-5": {
    base: anthropic(0.1, 0.5),
    longContext: { aboveTokens: 100_000, rate: anthropic(0.5, 2.5) },
  },
  "claude-haiku-4-5": { base: anthropic(1, 5) },

  // OpenAI (standard tier; long context is above 272K input tokens)
  "gpt-6-astra": {
    base: openai(10, 1, 12.5, 25, 50),
    longContext: { aboveTokens: 272_000, rate: openai(20, 2, 25, 50, 75) },
  },
  "gpt-6.1-sol": {
    base: openai(2, 0.1, 2.5, 5, 10),
    longContext: { aboveTokens: 272_000, rate: openai(4, 0.2, 5, 10, 15) },
  },
  "gpt-6.1-terra": {
    base: openai(1, 0.05, 1.25, 2.5, 5),
    longContext: { aboveTokens: 272_000, rate: openai(2, 0.1, 2.5, 5, 7.5) },
  },
};

/**
 * Strips provider prefixes and version suffixes so that, for example,
 * "us.anthropic.claude-haiku-4-5-20251001-v1:0" and "claude-haiku-4-5[1m]"
 * both become "claude-haiku-4-5".
 */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  const claudeAt = id.indexOf("claude-");
  if (claudeAt > 0) id = id.slice(claudeAt);
  id = id.replace(/\[[^\]]*\]$/, "");
  id = id.replace(/-v\d+(:\d+)?$/, "");
  id = id.replace(/@\d{8}$/, "");
  id = id.replace(/-\d{8}$/, "");
  return id;
}

export function priceFor(model: string): ModelPrice | undefined {
  return PRICES[normalizeModelId(model)];
}

/** Token usage of one API request, split by how it is billed. */
export type RequestUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong: number;
  fast?: boolean;
};

/** Estimated USD cost of one request, or null for an unknown model. */
export function requestCost(model: string, u: RequestUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const prompt = u.input + u.cacheRead + u.cacheWrite + u.cacheWriteLong;
  const rate =
    price.longContext && prompt > price.longContext.aboveTokens ? price.longContext.rate : price.base;
  const multiplier = u.fast && price.fastMultiplier ? price.fastMultiplier : 1;
  const usd =
    (u.input * rate.input +
      u.output * rate.output +
      u.cacheRead * rate.cacheRead +
      u.cacheWrite * rate.cacheWrite +
      u.cacheWriteLong * rate.cacheWriteLong) /
    1_000_000;
  return usd * multiplier;
}
