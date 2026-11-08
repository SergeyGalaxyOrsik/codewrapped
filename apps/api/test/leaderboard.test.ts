import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PublicProfile } from "@codewrapped/stats";
import { accounts, dailyStats, profiles, users } from "../src/db/schema";
import { githubCreatedAt } from "../src/lib/github";
import { boardRange, holdFor, rank, score } from "../src/lib/leaderboard";
import { flagDay } from "../src/lib/plausibility";
import { day, setup } from "./helpers";

type Board = { entries: Array<{ rank: number; handle: string; value: number; xHandle: string | null }>; participants: number; label: string; range: { start: string; end: string } };
const json = async <T>(res: Response) => (await res.json()) as T;

/** A user who opted in and synced the given days. */
async function player(t: Awaited<ReturnType<typeof setup>>, id: string, days: ReturnType<typeof day>[], opts: { optIn?: boolean; githubCreatedAt?: Date | null } = {}) {
  await t.createUser(id, id, opts);
  const token = await t.login(id);
  if (days.length > 0) expect((await t.sync(token, days, `machine-${id}`)).status).toBe(200);
  if (opts.optIn ?? true) expect((await t.req("PATCH", "/me/leaderboard", { user: id, body: { enabled: true } })).status).toBe(200);
  return token;
}

describe("board ranges", () => {
  it("are the current Monday-to-Sunday week and calendar month", () => {
    expect(boardRange("week", "2026-11-08")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(boardRange("week", "2026-11-09")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(boardRange("month", "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(boardRange("month", "2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("scoring", () => {
  it("counts wall-clock minutes once across machines, the longest streak and tokens", () => {
    const s = score([
      day("2026-11-02", "claude", { from: 600, to: 659, tokens: 10 }),
      day("2026-11-02", "codex", { from: 630, to: 689, tokens: 5 }),
      day("2026-11-03", "claude", { tokens: 1 }),
      day("2026-11-05", "claude", { tokens: 1 }),
    ]);
    expect(s).toEqual({ minutes: 90 + 60 + 60, streak: 2, tokens: 17 });
  });

  it("shares a rank on ties", () => {
    const c = (handle: string, minutes: number) => ({ userId: handle, handle, displayName: null, avatarUrl: null, xHandle: null, optedIn: true, eligible: true, hold: null, scores: { minutes, streak: 0, tokens: 0 } });
    expect(rank([c("a", 10), c("b", 30), c("c", 30), c("d", 0)], "hours").map((r) => [r.handle, r.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
    ]);
  });
});

describe("plausibility", () => {
  it("flags days with impossible token rates or parallelism", () => {
    expect(flagDay(day("2026-11-02", "claude", { tokens: 60 * 200_000 }))).toBeNull();
    expect(flagDay(day("2026-11-02", "claude", { tokens: 60 * 300_000 }))).toMatch(/tokens per active minute/);
    const crowded = day("2026-11-02", "claude");
    crowded.peakSessions = 80;
    expect(flagDay(crowded)).toMatch(/sessions at once/);
  });
});

describe("leaderboards", () => {
  it("rank only people who opted in, by hours, streak or tokens, within this week", async () => {
    const t = await setup();
    await player(t, "ada", [day("2026-11-06", "claude", { from: 0, to: 299, tokens: 100 }), day("2026-10-20", "claude", { from: 0, to: 1000 })]);
    await player(t, "bob", [day("2026-11-05", "claude", { tokens: 5000 }), day("2026-11-06", "claude", { tokens: 5000 }), day("2026-11-07", "claude", { tokens: 5000 })]);
    await player(t, "cyd", [day("2026-11-07", "claude", { from: 0, to: 999 })], { optIn: false });

    const hours = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"));
    expect(hours.label).toBe("Self-reported from local logs");
    expect(hours.range).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    // ada: 300 minutes this week (her October day is outside); bob: 3 x 60.
    expect(hours.entries.map((e) => [e.handle, e.value])).toEqual([
      ["ada", 300],
      ["bob", 180],
    ]);
    const streak = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=streak"));
    expect(streak.entries[0]).toMatchObject({ handle: "bob", value: 3 });
    const tokens = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=tokens"));
    expect(tokens.entries[0]).toMatchObject({ handle: "bob", value: 15000 });
    const month = await json<Board>(await t.req("GET", "/leaderboard?period=month&metric=hours"));
    expect(month.entries[0]!.value).toBe(300);
    expect((await t.req("GET", "/leaderboard?metric=cost")).status).toBe(400);
  });

  it("keep young GitHub accounts and flagged days off until trusted", async () => {
    const t = await setup();
    await player(t, "ada", [day("2026-11-06", "claude")]);
    await player(t, "new", [day("2026-11-06", "claude", { from: 0, to: 600 })], { githubCreatedAt: new Date("2026-10-01T00:00:00Z") });
    await player(t, "cheat", [day("2026-11-06", "claude", { from: 0, to: 9, tokens: 10 * 1_000_000 })]);
    const [flagged] = await t.db.select({ flag: dailyStats.flag }).from(dailyStats).where(eq(dailyStats.userId, "cheat"));
    expect(flagged!.flag).toMatch(/tokens per active minute/);

    const before = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"));
    expect(before.entries.map((e) => e.handle)).toEqual(["ada"]);

    await t.db.update(profiles).set({ leaderboardTrusted: true }).where(eq(profiles.userId, "new"));
    await t.sync(await t.login("ada"), []); // any sync drops the board cache
    const after = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"));
    expect(after.entries.map((e) => e.handle)).toEqual(["new", "ada"]);
  });

  it("tell you why your days wait for review", async () => {
    const t = await setup();
    await player(t, "new", [day("2026-11-06", "claude")], { githubCreatedAt: new Date("2026-10-01T00:00:00Z") });
    await player(t, "cheat", [day("2026-11-06", "claude", { from: 0, to: 9, tokens: 10 * 1_000_000 })]);
    type Me = { eligible: boolean; hold: unknown; rank: number | null };
    const mine = async (user: string) => json<Me>(await t.req("GET", "/leaderboard/me?period=week&metric=hours", { user }));
    expect(await mine("new")).toMatchObject({ eligible: false, rank: null, hold: { reason: "account_too_new", ranksFrom: "2026-11-30" } });
    expect(await mine("cheat")).toMatchObject({
      eligible: false,
      hold: { reason: "flagged_days", days: [{ day: "2026-11-06", flag: expect.stringMatching(/tokens per active minute/) }] },
    });
  });

  it("ask GitHub for the account age of people who signed up before it was recorded", async () => {
    const asked: string[] = [];
    const t = await setup({
      githubCreatedAt: async (userId) => {
        asked.push(userId);
        return userId === "early" ? new Date("2019-05-01T00:00:00Z") : null;
      },
    });
    await player(t, "early", [day("2026-11-06", "claude")], { githubCreatedAt: null });
    await player(t, "unknown", [day("2026-11-06", "claude")], { githubCreatedAt: null });
    const board = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"));
    expect(board.entries).toEqual([]);

    const me = await json<{ rank: number | null; hold: unknown }>(await t.req("GET", "/leaderboard/me?period=week&metric=hours", { user: "early" }));
    expect(me).toMatchObject({ rank: 1, hold: null });
    const [row] = await t.db.select({ at: users.githubCreatedAt }).from(users).where(eq(users.id, "early"));
    expect(row!.at?.toISOString()).toBe("2019-05-01T00:00:00.000Z");
    expect((await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"))).entries.map((e) => e.handle)).toEqual(["early"]);

    // GitHub had no answer: say so, and do not ask again on the next request.
    const other = await json<{ hold: unknown }>(await t.req("GET", "/leaderboard/me?period=week&metric=hours", { user: "unknown" }));
    expect(other.hold).toEqual({ reason: "account_age_unknown" });
    await t.req("GET", "/me", { user: "unknown" });
    expect(asked).toEqual(["early", "unknown"]);
  });

  it("pin your own rank, and store an optional X handle", async () => {
    const t = await setup();
    await player(t, "ada", [day("2026-11-06", "claude", { from: 0, to: 99 })]);
    await player(t, "bob", [day("2026-11-06", "claude", { from: 0, to: 9 })]);
    const me = await json<{ optedIn: boolean; rank: number; participants: number }>(await t.req("GET", "/leaderboard/me?period=week&metric=hours", { user: "bob" }));
    expect(me).toMatchObject({ optedIn: true, rank: 2, participants: 2 });

    expect((await t.req("PATCH", "/me/leaderboard", { user: "bob", body: { xHandle: "@bob_codes" } })).status).toBe(200);
    expect((await t.req("PATCH", "/me/leaderboard", { user: "bob", body: { xHandle: "not a handle!" } })).status).toBe(400);
    const board = await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"));
    expect(board.entries.find((e) => e.handle === "bob")?.xHandle).toBe("bob_codes");

    await t.req("PATCH", "/me/leaderboard", { user: "bob", body: { enabled: false } });
    expect((await json<Board>(await t.req("GET", "/leaderboard?period=week&metric=hours"))).entries.map((e) => e.handle)).toEqual(["ada"]);
  });

  it("show a percentile on the profile only once 200 people are active this month", async () => {
    const t = await setup();
    await t.createUser("top", "top");
    const insertUsers = async (n: number, offset: number) => {
      for (let i = 0; i < n; i++) {
        const id = `u${offset + i}`;
        await t.createUser(id, id);
        const d = day("2026-11-03", "claude", { from: 0, to: 9 + ((offset + i) % 50) });
        await t.db.insert(dailyStats).values({ userId: id, machineId: "m", source: "claude", day: d.day, data: d, schemaVersion: 1 });
      }
    };
    const top = day("2026-11-03", "claude", { from: 0, to: 600 });
    await t.db.insert(dailyStats).values({ userId: "top", machineId: "m", source: "claude", day: top.day, data: top, schemaVersion: 1 });

    await insertUsers(150, 0);
    expect((await json<PublicProfile>(await t.req("GET", "/u/top"))).standing).toBeNull();

    await insertUsers(60, 150);
    const fresh = await setupFrom(t);
    expect((await json<PublicProfile>(await fresh.request("/u/top"))).standing).toEqual({ percentile: 1, period: "month" });
  }, 60_000);
});

/** Same database, new app, empty caches. */
async function setupFrom(t: Awaited<ReturnType<typeof setup>>) {
  const { createApp } = await import("../src/app");
  return createApp({ db: t.db, webUrl: "https://web.test", getUserId: async () => null, now: () => t.clock.now });
}

describe("holds", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("name the first reason a user waits, oldest flagged day first and once per day", () => {
    expect(holdFor(null, [], now)).toEqual({ reason: "account_age_unknown" });
    expect(holdFor(new Date("2026-10-01T00:00:00Z"), [], now)).toEqual({ reason: "account_too_new", ranksFrom: "2026-11-30" });
    const flags = [
      { day: "2026-11-06", flag: "b" },
      { day: "2026-11-03", flag: "a" },
      { day: "2026-11-06", flag: "b" },
    ];
    expect(holdFor(new Date("2020-01-01T00:00:00Z"), flags, now)).toEqual({
      reason: "flagged_days",
      days: [
        { day: "2026-11-03", flag: "a" },
        { day: "2026-11-06", flag: "b" },
      ],
    });
    expect(holdFor(new Date("2020-01-01T00:00:00Z"), [], now)).toBeNull();
  });
});

describe("GitHub account age", () => {
  it("is asked by numeric account id, with the token, and without it when the token is revoked", async () => {
    const t = await setup();
    await t.createUser("u1", "someone", { githubCreatedAt: null });
    await t.db.insert(accounts).values({ id: "a1", accountId: "4242", providerId: "github", userId: "u1", accessToken: "gho_test" });
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fake = (status: number[]) =>
      (async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: (init?.headers as Record<string, string>).authorization });
        const s = status.shift()!;
        return new Response(JSON.stringify(s === 200 ? { created_at: "2018-03-04T05:06:07Z" } : {}), { status: s });
      }) as typeof fetch;

    expect((await githubCreatedAt(t.db, "u1", fake([200])))?.toISOString()).toBe("2018-03-04T05:06:07.000Z");
    expect(calls).toEqual([{ url: "https://api.github.com/user/4242", auth: "Bearer gho_test" }]);

    calls.length = 0;
    expect(await githubCreatedAt(t.db, "u1", fake([401, 200]))).not.toBeNull();
    expect(calls.map((c) => c.auth)).toEqual(["Bearer gho_test", undefined]);

    expect(await githubCreatedAt(t.db, "u1", fake([404]))).toBeNull();
    expect(await githubCreatedAt(t.db, "nobody", fake([200]))).toBeNull();
  });
});
