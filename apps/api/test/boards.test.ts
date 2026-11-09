import { describe, expect, it, vi } from "vitest";
import { Boards } from "../src/lib/boards";
import type { Candidate } from "../src/lib/leaderboard";

const candidate = (handle: string): Candidate => ({
  userId: handle,
  handle,
  displayName: null,
  avatarUrl: null,
  xHandle: null,
  optedIn: true,
  eligible: true,
  hold: null,
  scores: { minutes: 1, streak: 1, tokens: 1 },
});

/** A board whose builds finish only when the test says so, labeled by build number. */
function harness(refreshMs = 0) {
  const pending: Array<() => void> = [];
  let builds = 0;
  let range = { start: "2026-11-01", end: "2026-11-30" };
  const boards = new Boards({
    build: async () => {
      const n = ++builds;
      await new Promise<void>((resolve) => pending.push(resolve));
      return [candidate(`build-${n}`)];
    },
    range: () => range,
    refreshMs,
    maxAgeMs: 60_000,
  });
  const finish = async () => {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()!();
  };
  return {
    boards,
    finish,
    builds: () => builds,
    setRange: (r: typeof range) => (range = r),
    handles: async (p: Promise<Candidate[]>) => (await p).map((c) => c.handle),
  };
}

describe("boards", () => {
  it("build once for any number of concurrent readers", async () => {
    const h = harness();
    const readers = Array.from({ length: 20 }, () => h.boards.get("month"));
    await h.finish();
    const lists = await Promise.all(readers);
    expect(h.builds()).toBe(1);
    expect(new Set(lists.map((l) => l[0]!.handle))).toEqual(new Set(["build-1"]));
  });

  it("keep serving the last board while a change rebuilds it in the background", async () => {
    const h = harness();
    const first = h.boards.get("month");
    await h.finish();
    await first;

    h.boards.markStale();
    h.boards.markStale();
    expect(await h.handles(h.boards.get("month"))).toEqual(["build-1"]);
    await h.finish();
    await vi.waitFor(async () => expect(await h.handles(h.boards.get("month"))).toEqual(["build-2"]));
    expect(h.builds()).toBe(2);
  });

  it("rebuild at most once per refresh interval however often things change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      let builds = 0;
      const boards = new Boards({
        build: async () => [candidate(`build-${++builds}`)],
        range: () => ({ start: "2026-11-01", end: "2026-11-30" }),
        refreshMs: 30_000,
        maxAgeMs: 60 * 60_000,
      });
      await boards.get("month");
      for (let i = 0; i < 50; i++) {
        boards.markStale();
        await boards.get("month");
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(builds).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(builds).toBe(2);
      expect((await boards.get("month"))[0]!.handle).toBe("build-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("give profiles the last board or nothing, and never build for them", async () => {
    const h = harness();
    expect(h.boards.peek("month")).toBeNull();
    expect(h.builds()).toBe(0);
    const first = h.boards.get("month");
    await h.finish();
    await first;
    h.boards.markStale();
    expect(h.boards.peek("month")?.[0]?.handle).toBe("build-1");
  });

  it("wait for a board with every earlier change when asked for a fresh one", async () => {
    const h = harness(60_000);
    const first = h.boards.get("month");
    await h.finish();
    await first;
    h.boards.markStale();
    const fresh = h.boards.fresh("month");
    await h.finish();
    expect(await h.handles(fresh)).toEqual(["build-2"]);
  });

  it("start over when the period rolls into a new range", async () => {
    const h = harness();
    const first = h.boards.get("month");
    await h.finish();
    await first;
    h.setRange({ start: "2026-12-01", end: "2026-12-31" });
    expect(h.boards.peek("month")).toBeNull();
    const next = h.boards.get("month");
    await h.finish();
    expect(await h.handles(next)).toEqual(["build-2"]);
  });
});
