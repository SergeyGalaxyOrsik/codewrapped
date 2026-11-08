import { describe, expect, it } from "vitest";
import { LocalClock } from "../src/clock";

describe("LocalClock", () => {
  it("gives the local day and hour", () => {
    const berlin = new LocalClock("Europe/Berlin");
    expect(berlin.local(Date.parse("2026-01-14T22:59:59Z"))).toEqual({ day: "2026-01-14", hour: 23 });
    expect(berlin.local(Date.parse("2026-01-14T23:00:00Z"))).toEqual({ day: "2026-01-15", hour: 0 });
    const ny = new LocalClock("America/New_York");
    expect(ny.local(Date.parse("2026-01-15T03:00:00Z"))).toEqual({ day: "2026-01-14", hour: 22 });
  });

  it("splits a gap at local midnight", () => {
    const clock = new LocalClock("Europe/Berlin");
    const parts: Array<[string, number, number]> = [];
    clock.split(Date.parse("2026-01-14T22:58:00Z"), Date.parse("2026-01-14T23:02:00Z"), (t, m) =>
      parts.push([t.day, t.hour, m]),
    );
    expect(parts).toEqual([
      ["2026-01-14", 23, 2],
      ["2026-01-15", 0, 2],
    ]);
  });

  it("handles the spring DST jump", () => {
    // Berlin jumps from 02:00 to 03:00 local at 01:00 UTC on 2026-03-29.
    const clock = new LocalClock("Europe/Berlin");
    const parts: Array<[number, number]> = [];
    clock.split(Date.parse("2026-03-29T00:58:00Z"), Date.parse("2026-03-29T01:02:00Z"), (t, m) =>
      parts.push([t.hour, m]),
    );
    expect(parts).toEqual([
      [1, 2],
      [3, 2],
    ]);
  });

  it("handles half-hour offsets", () => {
    const kolkata = new LocalClock("Asia/Kolkata");
    expect(kolkata.local(Date.parse("2026-01-14T18:29:00Z"))).toEqual({ day: "2026-01-14", hour: 23 });
    expect(kolkata.local(Date.parse("2026-01-14T18:30:00Z"))).toEqual({ day: "2026-01-15", hour: 0 });
  });
});
