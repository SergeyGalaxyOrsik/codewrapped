/**
 * Public API prices in USD per million tokens, used to estimate what the
 * same usage would cost at pay-as-you-go API rates. Always shown as an
 * estimate: subscription plans are billed differently.
 *
 * Checked on 2026-11-08 against:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   (cache reads and writes per https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
 * - OpenAI: https://developers.openai.com/api/docs/pricing (standard tier)
 * - Z.ai (GLM): https://docs.z.ai/guides/overview/pricing
 * - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing (peak price; off-peak is half)
 * - Moonshot (Kimi): https://platform.kimi.ai/docs/pricing/chat
 *
 * Retired ids with no published price (deepseek-chat, deepseek-reasoner,
 * kimi-k2.5, kimi-k2-*-preview, kimi-k2-thinking) are left out on purpose.
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

/**
 * Providers that bill a cache miss as plain input and have no separate cache
 * write charge: a write costs input, a long write `long` (Kimi 1 hour TTL).
 */
function flat(input: number, cacheRead: number, output: number, long = input): Rate {
  return { input, output, cacheRead, cacheWrite: input, cacheWriteLong: long };
}

const GLM_5_1 = { base: flat(1.4, 0.26, 4.4) };
const GLM_4_6 = { base: flat(0.6, 0.11, 2.2) };
const FREE = { base: flat(0, 0, 0) };
const DEEPSEEK_FLASH = { base: flat(0.3, 0.006, 1.2) };
const DEEPSEEK_PRO = { base: flat(1.32, 0.044, 3.96) };

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

  // Z.ai GLM. Cached input storage is free for now, so a cache write costs input.
  "glm-5.3": GLM_5_1,
  "glm-5.3-flash": { base: flat(0.15, 0.03, 0.5) },
  "glm-5.3-flashx": { base: flat(0.37, 0.075, 1.25) },
  "glm-5.2": GLM_5_1,
  "glm-5.1": GLM_5_1,
  "glm-5": { base: flat(1, 0.2, 3.2) },
  "glm-4.7": GLM_4_6,
  "glm-4.7-flashx": { base: flat(0.07, 0.01, 0.4) },
  "glm-4.7-flash": FREE,
  "glm-4.6": GLM_4_6,
  "glm-4.5": GLM_4_6,
  "glm-4.5-x": { base: flat(2.2, 0.45, 8.9) },
  "glm-4.5-air": { base: flat(0.2, 0.03, 1.1) },
  "glm-4.5-airx": { base: flat(1.1, 0.22, 4.5) },
  "glm-4.5-flash": FREE,

  // DeepSeek. deepseek-v4-flash is a legacy id billed at the Flash price.
  "deepseek-flash": DEEPSEEK_FLASH,
  "deepseek-v4-flash": DEEPSEEK_FLASH,
  "deepseek-v4.1-flash": DEEPSEEK_FLASH,
  "deepseek-v4.1-flash-1017": DEEPSEEK_FLASH,
  "deepseek-v4-pro": DEEPSEEK_PRO,
  "deepseek-v4-pro-0813": DEEPSEEK_PRO,

  // Moonshot Kimi. K3 bills cache writes by TTL: 5 minutes at input, 1 hour at 2x.
  "kimi-k3.1-pro": { base: flat(2, 0.2, 10, 4) },
  "kimi-k3.1-pro-highspeed": { base: flat(4, 0.2, 20, 8) },
  "kimi-k3": { base: flat(3, 0.3, 15, 6) },
  "kimi-k2.7-code": { base: flat(0.95, 0.19, 4) },
  "kimi-k2.7-code-highspeed": { base: flat(1.9, 0.38, 8) },
  "kimi-k2.6": { base: flat(0.95, 0.16, 4) },
};

/**
 * Strips router and provider prefixes and version suffixes so that, for example,
 * "us.anthropic.claude-haiku-4-5-20251001-v1:0" and "claude-haiku-4-5[1m]"
 * both become "claude-haiku-4-5".
 */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  // Router and provider prefixes: "openrouter/z-ai/glm-4.6" -> "glm-4.6".
  id = id.slice(id.lastIndexOf("/") + 1);
  const claudeAt = id.indexOf("claude-");
  if (claudeAt > 0) id = id.slice(claudeAt);
  id = id.replace(/\[[^\]]*\]$/, "");
  id = id.replace(/-v\d+(:\d+)?$/, "");
  id = id.replace(/@\d{8}$/, "");
  id = id.replace(/-\d{8}$/, "");
  return id;
}

export function priceFor(model: string): ModelPrice | undefined {
  const id = normalizeModelId(model);
  return Object.hasOwn(PRICES, id) ? PRICES[id] : undefined;
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

/**
 * Cost of one request. A harness that records its own cost wins over the
 * table. A recorded 0 usually means a subscription or free plan, not that
 * the tokens are free at API prices, so the table is used when it knows the
 * model.
 */
export function usageCost(model: string, u: RequestUsage, reportedUsd?: number | null): number | null {
  if (typeof reportedUsd === "number" && Number.isFinite(reportedUsd) && reportedUsd > 0) return reportedUsd;
  return requestCost(model, u) ?? (reportedUsd === 0 ? 0 : null);
}
