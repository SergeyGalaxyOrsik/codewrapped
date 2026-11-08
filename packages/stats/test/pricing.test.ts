import { describe, expect, it } from "vitest";
import { normalizeModelId, priceFor, requestCost } from "../src/index";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 };

describe("pricing", () => {
  it("normalizes model ids from different providers", () => {
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModelId("us.anthropic.claude-opus-5-5-v1:0")).toBe("claude-opus-5-5");
    expect(normalizeModelId("claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
    expect(normalizeModelId("claude-sonnet-5@20260101")).toBe("claude-sonnet-5");
    expect(normalizeModelId("gpt-6.1-sol")).toBe("gpt-6.1-sol");
  });

  it("does not confuse a model with a newer point release", () => {
    expect(priceFor("claude-opus-5")!.base.input).toBe(5);
    expect(priceFor("claude-opus-5-5")!.base.input).toBe(4);
  });

  it("prices Anthropic cache reads and writes", () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, 1.25x and 2x writes.
    const usd = requestCost("claude-opus-5-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      cacheWriteLong: 1_000_000,
    });
    expect(usd).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 10);
  });

  it("doubles the price in fast mode where it exists", () => {
    expect(requestCost("claude-opus-5-5", { ...zero, output: 1_000_000, fast: true })).toBe(40);
    expect(requestCost("claude-sonnet-5-5", { ...zero, output: 1_000_000, fast: true })).toBe(10);
  });

  it("uses the long context rate above the threshold", () => {
    expect(requestCost("claude-haiku-5-5", { ...zero, input: 100_000 })).toBeCloseTo(0.01, 10);
    expect(requestCost("claude-haiku-5-5", { ...zero, input: 100_001 })).toBeCloseTo(0.0500005, 10);
    // OpenAI counts cached tokens toward the 272K threshold too.
    expect(requestCost("gpt-6.1-sol", { ...zero, input: 100_000, cacheRead: 200_000 })).toBeCloseTo(0.4 + 0.04, 10);
  });

  it("returns null for unknown models", () => {
    expect(requestCost("some-local-model", { ...zero, input: 1000 })).toBeNull();
  });
});
