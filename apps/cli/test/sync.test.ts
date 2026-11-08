import { emptyAggregate } from "@codewrapped/stats";
import { describe, expect, it } from "vitest";
import { chunk, daysToUpload, stripForUpload } from "../src/commands/sync";

const day = (d: string) => emptyAggregate(d, "claude");

describe("daysToUpload", () => {
  const days = ["2026-10-01", "2026-10-10", "2026-10-15", "2026-11-01", "2026-11-08"].map(day);

  it("uploads everything the first time", () => {
    expect(daysToUpload(days, undefined, "2026-11-08")).toHaveLength(5);
  });

  it("re-sends recent days but never replaces old synced days", () => {
    // Synced up to Oct 15 before. Oct 1 and Oct 10 are older than 27 days and already online.
    const picked = daysToUpload(days, "2026-10-15", "2026-11-08").map((d) => d.day);
    expect(picked).toEqual(["2026-10-15", "2026-11-01", "2026-11-08"]);
  });

  it("uploads days after the last sync even when they are old", () => {
    const picked = daysToUpload(days, "2026-10-05", "2026-11-08").map((d) => d.day);
    expect(picked).toEqual(["2026-10-10", "2026-10-15", "2026-11-01", "2026-11-08"]);
  });
});

describe("upload payload", () => {
  it("drops file and repository names when asked", () => {
    const d = day("2026-11-08");
    d.files = { "a.ts": 1 };
    d.repos = { web: { minutes: 1, tokens: 1 } };
    d.automated.repoMinutes = { web: 1 };
    const [s] = stripForUpload([d], { hideFiles: true, hideRepos: true });
    expect(s!.files).toEqual({});
    expect(s!.repos).toEqual({});
    expect(s!.automated.repoMinutes).toEqual({});
  });

  it("splits large uploads under the size limit", () => {
    const many = Array.from({ length: 1000 }, (_, i) => {
      const d = day("2026-01-01");
      d.files = Object.fromEntries(Array.from({ length: 40 }, (_, j) => [`file-${i}-${j}.ts`, j]));
      return d;
    });
    const parts = chunk(many);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toHaveLength(1000);
    for (const p of parts) {
      expect(JSON.stringify(p).length).toBeLessThan(1024 * 1024);
      expect(p.length).toBeLessThanOrEqual(400);
    }
  });
});
