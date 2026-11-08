import { countMinutes, decodeMask } from "@codewrapped/stats";
import { describe, expect, it } from "vitest";
import { DayBuilder, type Session } from "../src/builder";
import { LocalClock } from "../src/clock";

/** A session with one event per minute from `from` to `to` (HH:MM, UTC). */
function session(from: string, to: string): Session {
  const start = Date.parse(`2026-03-02T${from}:00Z`);
  const end = Date.parse(`2026-03-02T${to}:00Z`);
  const events = [];
  for (let t = start; t <= end; t += 60_000) events.push({ t, repo: "p" });
  return { events, active: true, automated: false, prompts: [] };
}

function build(...sessions: Session[]) {
  const b = new DayBuilder("claude", new LocalClock("UTC"));
  for (const s of sessions) b.addSession(s);
  const rows = b.result();
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("DayBuilder time", () => {
  it("counts overlapping sessions once in the mask and twice in agent time", () => {
    const row = build(session("10:00", "10:20"), session("10:10", "10:30"));
    expect(countMinutes(decodeMask(row.activeMask))).toBe(30);
    expect(row.agentMinutes).toBe(40);
    expect(row.peakSessions).toBe(2);
    expect(row.sessions).toBe(2);
  });

  it("finds the peak of several sessions", () => {
    const row = build(session("09:00", "12:00"), session("10:00", "10:30"), session("10:15", "10:45"), session("11:00", "11:10"));
    expect(row.peakSessions).toBe(3);
  });

  it("does not count back-to-back sessions as parallel", () => {
    const row = build(session("10:00", "10:20"), session("10:20", "10:40"));
    expect(row.peakSessions).toBe(1);
    expect(countMinutes(decodeMask(row.activeMask))).toBe(40);
  });

  it("ignores sessions without activity", () => {
    const b = new DayBuilder("claude", new LocalClock("UTC"));
    b.addSession({ ...session("10:00", "10:20"), active: false });
    expect(b.result()).toEqual([]);
  });
});
