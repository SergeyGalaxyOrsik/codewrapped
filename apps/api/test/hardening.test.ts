import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DailyAggregate } from "@codewrapped/stats";
import { deviceCodes, verifications } from "../src/db/schema";
import { purgeExpired } from "../src/lib/purge";
import { clientIp } from "../src/lib/ratelimit";
import { day, setup } from "./helpers";

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const code = async (res: Response) => (await json<{ error: { code: string } }>(res)).error.code;

describe("account limits", () => {
  it("keep the 10 newest connected computers and disconnect older ones", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const tokens: string[] = [];
    for (let i = 0; i < 11; i++) tokens.push(await t.login("u1", `laptop-${i}`));
    const listed = await json<{ tokens: Array<{ machineLabel: string }> }>(await t.req("GET", "/me/tokens", { user: "u1" }));
    expect(listed.tokens.map((x) => x.machineLabel)).toEqual(Array.from({ length: 10 }, (_, i) => `laptop-${i + 1}`));
    expect(await code(await t.sync(tokens[0]!, []))).toBe("token_revoked");
    expect((await t.sync(tokens[10]!, [])).status).toBe(200);
  });

  it("take data from at most 10 computers", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    for (let i = 0; i < 10; i++) expect((await t.sync(token, [day("2026-11-07", "claude")], `machine-${i}0000`)).status).toBe(200);
    const eleventh = await t.sync(token, [day("2026-11-07", "claude")], "machine-x0000");
    expect(eleventh.status).toBe(403);
    expect(await code(eleventh)).toBe("too_many_machines");
    expect((await t.sync(token, [day("2026-11-08", "claude")], "machine-00000")).status).toBe(200);
  });

  it("store at most 20 harnesses and skip rows of more", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    const rows = Array.from({ length: 21 }, (_, i) => ({ ...day("2026-11-07", "claude"), source: `agent-${i}` }) as unknown as DailyAggregate);
    const body = await json<{ received: number; skipped: Array<{ index: number; reason: string }> }>(await t.sync(token, rows));
    expect(body.received).toBe(20);
    expect(body.skipped).toEqual([{ index: 20, day: "2026-11-07", source: "agent-20", reason: expect.stringMatching(/^source/) }]);
    const again = await json<{ received: number }>(await t.sync(token, [day("2026-11-08", "claude")]));
    expect(again.received).toBe(0);
  });

  it("let one network start at most 10 logins in 10 minutes", async () => {
    const t = await setup();
    const start = (ip: string) => t.req("POST", "/cli/device", { body: { machineLabel: "x" }, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 10; i++) expect((await start(`198.51.100.${i}, 203.0.113.7`)).status).toBe(200);
    const limited = await start("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await start("203.0.113.8")).status).toBe(200);
    t.clock.now = new Date(t.clock.now.getTime() + 10 * 60_000);
    expect((await start("203.0.113.7")).status).toBe(200);
  });
});

describe("synced days", () => {
  type SyncResult = { received: number; skipped: Array<{ index: number; day: string; reason: string }> };

  it("are real calendar days from 2024 up to tomorrow in UTC", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    const days = ["2025-02-29", "2000-02-30", "0000-01-01", "2023-12-31", "2026-11-10", "9999-12-31", "2024-01-01", "2024-02-29", "2026-11-09"];
    const res = await t.sync(token, days.map((d) => day(d, "claude")), "machine-aaaa", "Pacific/Kiritimati");
    expect(res.status).toBe(200);
    const body = await json<SyncResult>(res);
    expect(body.received).toBe(3);
    expect(body.skipped.map((s) => [s.day, s.reason.split(":")[0]])).toEqual([
      ["2025-02-29", "day"],
      ["2000-02-30", "day"],
      ["0000-01-01", "day"],
      ["2023-12-31", "day"],
      ["2026-11-10", "day"],
      ["9999-12-31", "day"],
    ]);
    const p = await json<{ summary: { totals: { tokens: { headline: number } } } }>(await t.req("GET", "/u/ada?period=all"));
    expect(p.summary.totals.tokens.headline).toBe(3000);
  });

  it("sent twice in one upload keep the last copy", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    const res = await t.sync(token, [day("2026-11-07", "claude", { tokens: 1 }), day("2026-11-07", "codex"), day("2026-11-07", "claude", { tokens: 7 })]);
    expect(res.status).toBe(200);
    const body = await json<SyncResult>(res);
    expect(body.received).toBe(2);
    expect(body.skipped).toEqual([expect.objectContaining({ index: 0, day: "2026-11-07" })]);
    const p = await json<{ summary: { totals: { tokens: { headline: number } } } }>(await t.req("GET", "/u/ada?period=7d"));
    expect(p.summary.totals.tokens.headline).toBe(1007);
  });
});

describe("client address", () => {
  const req = (xff?: string) => new Request("http://api.test/", { headers: xff ? { "x-forwarded-for": xff } : {} });
  it("is the address the proxy appended, or the socket's", () => {
    expect(clientIp(req("1.1.1.1, 203.0.113.7"), "10.0.0.2")).toBe("203.0.113.7");
    expect(clientIp(req(), "10.0.0.2")).toBe("10.0.0.2");
    expect(clientIp(req(), undefined)).toBe("unknown");
  });
  it("groups IPv6 addresses by /64", () => {
    expect(clientIp(req("2001:db8:0:1::5"), undefined)).toBe("2001:db8:0:1::/64");
    expect(clientIp(req("2001:DB8:0000:0001:aaaa:bbbb:cccc:dddd"), undefined)).toBe("2001:db8:0:1::/64");
    expect(clientIp(req("::1"), undefined)).toBe("0:0:0:0::/64");
  });
});

describe("expired login state", () => {
  it("is deleted a day after it expires", async () => {
    const t = await setup();
    const now = t.clock.now;
    const row = (userCode: string, expiresAt: Date) => ({ deviceCodeHash: userCode, userCode, machineLabel: "x", intervalSeconds: 5, expiresAt });
    await t.db.insert(deviceCodes).values([row("OLD", new Date(now.getTime() - 25 * 3600_000)), row("RECENT", new Date(now.getTime() - 3600_000))]);
    await t.db.insert(verifications).values([
      { id: "v-old", identifier: "state", value: "x", expiresAt: new Date(now.getTime() - 1000) },
      { id: "v-live", identifier: "state", value: "x", expiresAt: new Date(now.getTime() + 600_000) },
    ]);
    expect(await purgeExpired(t.db, now)).toEqual({ deviceCodes: 1, verifications: 1 });
    expect((await t.db.select({ c: deviceCodes.userCode }).from(deviceCodes)).map((r) => r.c)).toEqual(["RECENT"]);
    expect(await t.db.select({ id: verifications.id }).from(verifications).where(eq(verifications.id, "v-live"))).toHaveLength(1);
  });
});
