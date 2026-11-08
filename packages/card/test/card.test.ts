import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fontFiles } from "@codewrapped/brand";
import { describe, expect, it } from "vitest";
import { samples } from "../scripts/samples";
import { cardData, cardSvg, formatRange, heatSteps, type FontData } from "../src/index";

const today = "2026-11-08";
const cases = samples(today);

async function loadFonts(): Promise<FontData[]> {
  const dir = join(import.meta.dirname, "../../brand/fonts");
  return Promise.all(
    fontFiles.map(async (f) => ({ name: f.family, weight: f.weight, style: "normal" as const, data: await readFile(join(dir, f.file)) })),
  );
}

describe("cardData", () => {
  it("names only the agents that were used and drops the parallel line without parallel work", () => {
    const d = cardData(cases.small!.summary);
    expect(d.heroLabel).toBe("with Claude Code");
    expect(d.parallel).toBeNull();
    expect(d.hero).toEqual({ value: "1.2M", unit: "tokens" });
    expect(d.stats[0]).toEqual({ value: "2 h", label: "with agents" });
  });

  it("lists repositories by tokens, and files when repositories are hidden", () => {
    const s = cases.short!.summary;
    expect(cardData(s).ranked).toEqual({ title: "Most edited", rows: expect.any(Array) });
  });

  it("shows the period the logs actually cover", () => {
    expect(cardData(cases.short!.summary).period).toBe("last 23 days");
  });

  it("formats big numbers", () => {
    const d = cardData(cases.big!.summary, { handle: "ada" });
    expect(d.hero).toEqual({ value: "10.5B", unit: "tokens" });
    expect(d.stats.map((s) => s.value)).toEqual(["1,242 h", "$12,480", "1,260"]);
    expect(d.parallel).toMatch(/up to 14 sessions at once$/);
    expect(d.url).toBe("codewrapped.app/@ada");
  });

  it("shortens a long file name inside the archetype sentence", () => {
    const d = cardData(cases["long-names"]!.summary);
    expect(d.archetype.name).toBe("One-file fixer");
    expect(d.archetype.sentence).not.toContain("AutomationRunHistoryTableWithFilters");
    expect(d.archetype.sentence).toMatch(/\.tsx\.$/);
  });

  it("formats date ranges", () => {
    expect(formatRange("2026-10-10", "2026-11-08")).toBe("Oct 10 to Nov 8, 2026");
    expect(formatRange("2025-12-20", "2026-01-08")).toBe("Dec 20, 2025 to Jan 8, 2026");
  });
});

describe("heatSteps", () => {
  it("leaves empty cells at 0 and gives the busiest cell the top step", () => {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    grid[0]![1] = 1;
    grid[0]![2] = 10;
    grid[3]![9] = 100;
    const steps = heatSteps(grid);
    expect(steps[0]![0]).toBe(0);
    expect(steps[3]![9]).toBe(4);
    expect(steps[0]![1]).toBeLessThan(steps[0]![2]!);
  });

  it("shows a light user's even cells clearly", () => {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    grid[1]![10] = 40;
    grid[2]![10] = 40;
    expect(heatSteps(grid)[1]![10]).toBe(4);
  });
});

describe("cardSvg", () => {
  it("renders both sizes and themes for every edge case", async () => {
    const fonts = await loadFonts();
    for (const format of ["landscape", "story"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const c of Object.values(cases)) {
          const svg = await cardSvg(c.summary, { format, theme, handle: c.handle, fonts });
          expect(svg.startsWith("<svg")).toBe(true);
          expect(svg).toContain(format === "story" ? 'width="1080"' : 'width="1200"');
        }
      }
    }
  }, 60_000);
});
