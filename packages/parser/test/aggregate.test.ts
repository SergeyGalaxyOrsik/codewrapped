import { describe, expect, it } from "vitest";
import { Aggregator, LocalClock } from "../src/index";

const t0 = Date.parse("2026-01-14T10:00:00Z");
const min = 60_000;
const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 };

describe("Aggregator", () => {
  it("prefers the cost a harness recorded and folds subagents into their root session", () => {
    const agg = new Aggregator("claude", new LocalClock("UTC"));
    agg.emit({ type: "session", session: "root" });
    agg.emit({ type: "session", session: "child", parent: "root" });
    agg.emit({ type: "tick", session: "root", t: t0, cwd: "/home/dev/shop", active: true });
    agg.emit({ type: "prompt", session: "root", t: t0 });
    agg.emit({ type: "tick", session: "child", t: t0 + 2 * min, cwd: "/home/dev/shop" });
    // The parent agent writes the subagent's prompt: not a person's prompt.
    agg.emit({ type: "prompt", session: "child", t: t0 + 2 * min });
    agg.emit({ type: "usage", session: "child", t: t0 + 3 * min, model: "claude-opus-5-5", usage, costUsd: 1.25, cwd: "/home/dev/shop" });
    agg.emit({ type: "usage", session: "root", t: t0 + 4 * min, model: "local-model", usage, cwd: "/home/dev/shop" });
    agg.emit({ type: "tick", session: "root", t: t0 + 4 * min, cwd: "/home/dev/shop" });

    const [row] = agg.result();
    expect(row!.sessions).toBe(1);
    expect(row!.messages).toBe(1);
    expect(row!.agentMinutes).toBe(4);
    expect(row!.models["claude-opus-5-5"]!.costUsd).toBe(1.25);
    expect(row!.models["local-model"]!.costUsd).toBeNull();
    expect(row!.repos.shop).toEqual({ minutes: 4, tokens: 2_000_000 });
  });

  it("drops sessions with nothing a person or model did", () => {
    const agg = new Aggregator("codex", new LocalClock("UTC"));
    agg.emit({ type: "tick", session: "s", t: t0, cwd: null });
    agg.emit({ type: "tick", session: "s", t: t0 + min, cwd: null });
    expect(agg.result()).toHaveLength(0);
  });
});
