import { emptyAggregate } from "@codewrapped/stats";
import { describe, expect, it } from "vitest";
import { chunk, daysToUpload, stripForUpload, syncedDays } from "../src/commands/sync";

const day = (d: string, source: "claude" | "opencode" = "claude") => emptyAggregate(d, source);

describe("daysToUpload", () => {
  const days = ["2026-10-01", "2026-10-10", "2026-10-15", "2026-11-01", "2026-11-08"].map((d) => day(d));

  it("uploads everything the first time", () => {
    expect(daysToUpload(days, undefined, "2026-11-08")).toHaveLength(5);
  });

  it("re-sends recent days but never replaces old synced days", () => {
    // Synced up to Oct 15 before. Oct 1 and Oct 10 are older than 27 days and already online.
    const picked = daysToUpload(days, { claude: "2026-10-15" }, "2026-11-08").map((d) => d.day);
    expect(picked).toEqual(["2026-10-15", "2026-11-01", "2026-11-08"]);
  });

  it("uploads days after the last sync even when they are old", () => {
    const picked = daysToUpload(days, { claude: "2026-10-05" }, "2026-11-08").map((d) => d.day);
    expect(picked).toEqual(["2026-10-10", "2026-10-15", "2026-11-01", "2026-11-08"]);
  });
});

describe("harnesses added later", () => {
  it("upload their whole history once, even after other harnesses synced", () => {
    const mixed = [day("2026-06-01", "opencode"), day("2026-10-01"), day("2026-11-08"), day("2026-11-08", "opencode")];
    const picked = daysToUpload(mixed, { claude: "2026-11-01" }, "2026-11-08").map((d) => `${d.source} ${d.day}`);
    expect(picked).toEqual(["opencode 2026-06-01", "claude 2026-11-08", "opencode 2026-11-08"]);
  });

  it("read a 0.1 config as synced for Claude Code and Codex only", () => {
    const base = "https://api.example.com";
    expect(syncedDays({ machineId: "m", lastSyncedDay: { [base]: "2026-11-01" } }, base)).toEqual({ claude: "2026-11-01", codex: "2026-11-01" });
    expect(syncedDays({ machineId: "m", lastSyncedDays: { [base]: { pi: "2026-11-02" } } }, base)).toEqual({ pi: "2026-11-02" });
    expect(syncedDays({ machineId: "m" }, base)).toBeUndefined();
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
