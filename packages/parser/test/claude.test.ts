import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countMinutes, decodeMask, hoursOf } from "@codewrapped/stats";
import { listJsonl, parseFiles } from "../src/index";

const root = join(import.meta.dirname, "../fixtures/claude/projects");

async function parse(timeZone: string) {
  const claudeFiles = await listJsonl(root);
  return parseFiles({ files: { claude: claudeFiles }, timeZone });
}

const day = (rows: Awaited<ReturnType<typeof parse>>["aggregates"], d: string) => {
  const row = rows.find((r) => r.day === d);
  if (!row) throw new Error(`no row for ${d}`);
  return row;
};

describe("claude parser", () => {
  it("reads nested subagent transcripts", async () => {
    expect((await listJsonl(root)).map((f) => f.slice(root.length))).toEqual([
      "/-home-dev-shop/sess-1.jsonl",
      "/-home-dev-shop/sess-1/subagents/agent-a1.jsonl",
    ]);
  });

  it("counts usage once per message id and keeps the largest value of each field", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    // msg_1 is streamed over two lines (output 5, then 40). msg_2 also appears
    // in the subagent file. msg_3 appears twice with the same uuid.
    expect(day(aggregates, "2026-01-14").tokens).toEqual({ input: 17, output: 50, cacheRead: 110, cacheWrite: 100 });
    expect(day(aggregates, "2026-01-15").tokens).toEqual({ input: 4, output: 3, cacheRead: 120, cacheWrite: 50 });
  });

  it("prices 5 minute and 1 hour cache writes separately", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    // msg_1: 10*2 + 40*10 + 100*2.5 = 670; msg_2: 5*2 + 7*10 + 110*0.2 = 102 (per MTok)
    // tokens leave out cache reads, which are kept apart.
    expect(day(aggregates, "2026-01-14").models["claude-sonnet-5-5"]).toEqual({ tokens: 162, cacheRead: 110, costUsd: 0.000772 });
    // msg_3: 3*2 + 2*10 + 120*0.2 + 50*4 = 250; msg_4: 1*2 + 1*10 = 12
    expect(day(aggregates, "2026-01-15").models["claude-sonnet-5-5"]!.costUsd).toBe(0.000262);
  });

  it("counts each tool call once and edits by basename", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    const d = day(aggregates, "2026-01-14");
    expect(d.tools).toEqual({ Edit: 1, Bash: 1, Read: 1 });
    expect(d.files).toEqual({ "page.tsx": 1 });
  });

  it("counts only prompts the user sent", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    // Not counted: tool results, the isMeta caveat, the task notification.
    expect(day(aggregates, "2026-01-14").messages).toBe(1);
    expect(day(aggregates, "2026-01-15").messages).toBe(1);
  });

  it("sums gaps up to 5 minutes and drops longer ones", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    const a = day(aggregates, "2026-01-14");
    const b = day(aggregates, "2026-01-15");
    // 22:50:00 to 23:03:00 UTC with no gap over 5 min is 13 min; the 27 min
    // pause is dropped; 23:30:00 to 23:30:30 adds 0.5 min.
    expect(a.agentMinutes + b.agentMinutes).toBe(13.5);
    expect(a.sessions + b.sessions).toBe(1);
    expect(a.longestSessionMinutes).toBe(13.5);
    expect(a.peakSessions).toBe(1);
  });

  it("marks every minute touched by activity in the mask", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    // 23:50 to 23:59 local on Jan 14. On Jan 15, 00:00 to 00:02 and the
    // 30 seconds at 00:30, which touch 4 minutes for 3.5 minutes of activity.
    expect(countMinutes(decodeMask(day(aggregates, "2026-01-14").activeMask))).toBe(10);
    expect(countMinutes(decodeMask(day(aggregates, "2026-01-15").activeMask))).toBe(4);
    expect(day(aggregates, "2026-01-15").agentMinutes).toBe(3.5);
  });

  it("splits days and hours in the local timezone", async () => {
    const berlin = (await parse("Europe/Berlin")).aggregates;
    // 23:00 UTC is midnight in Berlin.
    expect(hoursOf(decodeMask(day(berlin, "2026-01-14").activeMask))[23]).toBe(10);
    expect(day(berlin, "2026-01-14").agentMinutes).toBe(10);
    expect(hoursOf(decodeMask(day(berlin, "2026-01-15").activeMask))[0]).toBe(4);
    expect(day(berlin, "2026-01-14").sessions).toBe(1);

    const utc = (await parse("UTC")).aggregates;
    expect(utc.map((r) => r.day)).toEqual(["2026-01-14"]);
    const hours = hoursOf(decodeMask(utc[0]!.activeMask));
    expect(hours[22]).toBe(10);
    expect(hours[23]).toBe(4);
    expect(utc[0]!.messages).toBe(2);
  });

  it("counts minutes and tokens per repository, with agent worktrees in their repository", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    // msg_1 150 + msg_2 12 + msg_5 (subagent, in a worktree) 5.
    expect(day(aggregates, "2026-01-14").repos).toEqual({ shop: { minutes: 10, tokens: 167 } });
    expect(day(aggregates, "2026-01-15").repos).toEqual({ shop: { minutes: 3.5, tokens: 57 } });
  });

  it("skips unknown events and broken lines without failing", async () => {
    const { warnings } = await parse("Europe/Berlin");
    expect(warnings.claude.unknownEvents).toEqual({ "claude:hologram-sync": 1 });
    expect(warnings.claude.badLines).toBe(1);
  });

  it("stores no text or full paths", async () => {
    const { aggregates } = await parse("Europe/Berlin");
    const json = JSON.stringify(aggregates);
    expect(json).not.toContain("removed");
    expect(json).not.toContain("/home/dev");
  });
});
