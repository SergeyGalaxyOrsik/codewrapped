import { describe, expect, it } from "vitest";
import { displayToolName, formatCompact, formatHours, formatShare, formatUsd, truncateMiddle } from "../src/index";

describe("format", () => {
  it("compacts to 3 significant figures", () => {
    expect(formatCompact(940)).toBe("940");
    expect(formatCompact(1_820)).toBe("1.82K");
    expect(formatCompact(41_234_567)).toBe("41.2M");
    expect(formatCompact(512_300_000)).toBe("512M");
    expect(formatCompact(10_460_000_000)).toBe("10.5B");
    expect(formatCompact(999_600)).toBe("1M");
    expect(formatCompact(2_000_000)).toBe("2M");
  });

  it("formats money and hours", () => {
    expect(formatUsd(4.123)).toBe("$4.12");
    expect(formatUsd(12_480.4)).toBe("$12,480");
    expect(formatHours(45)).toBe("45 min");
    expect(formatHours(7_200)).toBe("120 h");
    expect(formatShare(0.65)).toBe("65%");
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
  });

  it("truncates in the middle and keeps the extension", () => {
    expect(truncateMiddle("page.tsx", 20)).toBe("page.tsx");
    const long = "AutomationRunHistoryTableWithFilters.integration.test.tsx";
    const short = truncateMiddle(long, 24);
    expect(short).toHaveLength(24);
    expect(short.startsWith("Automation")).toBe(true);
    expect(short.endsWith(".tsx")).toBe(true);
    expect(short).toContain("...");
    expect(truncateMiddle("a-very-long-name-without-any-extension-at-all", 16)).toHaveLength(16);
  });

  it("shortens MCP tool names", () => {
    expect(displayToolName("mcp__claude-in-chrome__computer")).toBe("claude-in-chrome: computer");
    expect(displayToolName("Bash")).toBe("Bash");
  });
});

