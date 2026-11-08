import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cliTokens, dailyStats, deviceCodes, profiles } from "../src/db/schema";
import type { PublicProfile } from "@codewrapped/stats";
import { day, setup, WEB } from "./helpers";

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

describe("device login", () => {
  it("issues a token once after approval, and stores only its hash", async () => {
    const t = await setup();
    await t.createUser("u1", "Ada");
    const start = await json<{ deviceCode: string; userCode: string; verifyUrl: string; interval: number }>(
      await t.req("POST", "/cli/device", { body: { machineLabel: "Ada's laptop" } }),
    );
    expect(start.userCode).toMatch(/^[A-Z]{4}-\d{4}$/);
    expect(start.verifyUrl).toBe(`${WEB}/device?code=${start.userCode}`);

    const pending = await t.req("POST", "/cli/token", { body: { deviceCode: start.deviceCode } });
    expect(pending.status).toBe(400);
    expect((await json<{ error: { code: string } }>(pending)).error.code).toBe("authorization_pending");

    // Polling faster than the interval is told to slow down.
    const fast = await t.req("POST", "/cli/token", { body: { deviceCode: start.deviceCode } });
    expect((await json<{ error: { code: string } }>(fast)).error.code).toBe("slow_down");

    // The approval page needs a session and shows the machine.
    expect((await t.req("GET", `/cli/device/${start.userCode}`)).status).toBe(401);
    const info = await json(await t.req("GET", `/cli/device/${start.userCode.toLowerCase()}`, { user: "u1" }));
    expect(info.machineLabel).toBe("Ada's laptop");
    expect((await t.req("POST", `/cli/device/${start.userCode}/approve`, { user: "u1" })).status).toBe(200);

    t.clock.now = new Date(t.clock.now.getTime() + 6000);
    const ok = await json<{ token: string; handle: string }>(await t.req("POST", "/cli/token", { body: { deviceCode: start.deviceCode } }));
    expect(ok.token).toMatch(/^cw_/);
    expect(ok.handle).toBe("ada");

    t.clock.now = new Date(t.clock.now.getTime() + 6000);
    const again = await t.req("POST", "/cli/token", { body: { deviceCode: start.deviceCode } });
    expect((await json<{ error: { code: string } }>(again)).error.code).toBe("invalid_grant");

    const stored = await t.db.select().from(cliTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(ok.token.slice(3, 20));
    expect(JSON.stringify(await t.db.select().from(deviceCodes))).not.toContain(start.deviceCode);
  });

  it("expires codes and honors a denial", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const a = await json<{ deviceCode: string; userCode: string }>(await t.req("POST", "/cli/device", { body: { machineLabel: "x" } }));
    await t.req("POST", `/cli/device/${a.userCode}/deny`, { user: "u1" });
    expect((await json<{ error: { code: string } }>(await t.req("POST", "/cli/token", { body: { deviceCode: a.deviceCode } }))).error.code).toBe("access_denied");

    const b = await json<{ deviceCode: string; userCode: string }>(await t.req("POST", "/cli/device", { body: { machineLabel: "x" } }));
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    expect((await json<{ error: { code: string } }>(await t.req("POST", "/cli/token", { body: { deviceCode: b.deviceCode } }))).error.code).toBe("expired_token");
    expect((await t.req("POST", `/cli/device/${b.userCode}/approve`, { user: "u1" })).status).toBe(404);
  });
});

describe("sync", () => {
  it("is idempotent: re-sending the same days changes nothing", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    const days = [day("2026-11-06", "claude"), day("2026-11-07", "claude"), day("2026-11-07", "codex")];
    expect((await t.sync(token, days)).status).toBe(200);
    const first = await json<PublicProfile>(await t.req("GET", "/u/ada?period=7d"));
    expect((await t.sync(token, days)).status).toBe(200);
    const second = await json<PublicProfile>(await t.req("GET", "/u/ada?period=7d"));

    const [{ n }] = (await t.db.select({ n: count() }).from(dailyStats)) as [{ n: number }];
    expect(n).toBe(3);
    expect(second.summary).toEqual(first.summary);
    expect(second.summary.totals.tokens.headline).toBe(3000);
  });

  it("replaces a re-synced day and adds up machines", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const laptop = await t.login("u1", "laptop");
    const desktop = await t.login("u1", "desktop");
    await t.sync(laptop, [day("2026-11-07", "claude", { tokens: 100 })], "machine-laptop");
    await t.sync(laptop, [day("2026-11-07", "claude", { tokens: 250 })], "machine-laptop");
    // Same day on another machine, overlapping in time: 10:30-11:29 against 10:00-10:59.
    await t.sync(desktop, [day("2026-11-07", "claude", { tokens: 50, from: 630, to: 689 })], "machine-desktop");
    const p = await json<PublicProfile>(await t.req("GET", "/u/ada?period=7d"));
    expect(p.summary.totals.tokens.headline).toBe(300);
    expect(p.summary.totals.activeMinutes).toBe(90);
    expect(p.summary.totals.agentMinutes).toBe(120);
  });

  it("uses the synced timezone for today", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    // 12:00 UTC on Nov 8 is already Nov 9 in Kiritimati (UTC+14).
    await t.sync(token, [day("2026-11-09", "claude")], "machine-aaaa", "Pacific/Kiritimati");
    const p = await json<PublicProfile>(await t.req("GET", "/u/ada?period=7d"));
    expect(p.summary.range.end).toBe("2026-11-09");
    expect(p.summary.totals.sessions).toBe(1);
  });

  it("rejects bad payloads with a clear message", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    const bad = { ...day("2026-11-07", "claude"), activeMask: "AAAA" };
    const res = await t.sync(token, [bad]);
    expect(res.status).toBe(400);
    expect((await json<{ error: { message: string } }>(res)).error.message).toMatch(/days\.0\.activeMask/);

    const huge = await t.req("POST", "/sync", { token, body: "x".repeat(1024 * 1024 + 10) });
    expect(huge.status).toBe(413);

    expect((await t.req("POST", "/sync", { body: { machineId: "machine-aaaa", timeZone: "UTC", days: [] } })).status).toBe(401);
  });

  it("limits requests per token", async () => {
    const t = await setup({ syncLimit: { requests: 2, windowMs: 60_000 } });
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    expect((await t.sync(token, [])).status).toBe(200);
    expect((await t.sync(token, [])).status).toBe(200);
    const limited = await t.sync(token, []);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("visibility", () => {
  it("hides files and repositories by default and shows them when turned on", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    await t.sync(token, [day("2026-11-07", "claude", { files: { "plan.md": 40 }, repos: { "acme-internal": 1 } })]);

    const hidden = await t.req("GET", "/u/ada");
    const body = await hidden.text();
    expect(body).not.toContain("plan.md");
    expect(body).not.toContain("acme-internal");
    expect(JSON.parse(body).summary.topFiles).toEqual([]);

    const set = await t.req("PATCH", "/me/visibility", { user: "u1", body: { files: true, repos: true, cost: false, tools: false } });
    expect(set.status).toBe(200);
    // The cache is dropped on change.
    const shown = await json<PublicProfile>(await t.req("GET", "/u/ada"));
    expect(shown.summary.topFiles[0]?.name).toBe("plan.md");
    expect(shown.summary.topRepos[0]?.name).toBe("acme-internal");
    expect(shown.summary.totals.costUsd).toBeNull();
    expect(shown.summary.models?.every((m) => m.costUsd === null)).toBe(true);
    expect(shown.allTime.costUsd).toBeNull();
    expect(shown.summary.topTools).toEqual([]);
  });

  it("drops the heatmap and calendar when hidden", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    await t.sync(token, [day("2026-11-07", "claude")]);
    expect((await json<PublicProfile>(await t.req("GET", "/u/ada"))).calendar).toEqual([{ day: "2026-11-07", minutes: 60 }]);
    await t.req("PATCH", "/me/visibility", { user: "u1", body: { heatmap: false } });
    const p = await json<PublicProfile>(await t.req("GET", "/u/ada"));
    expect(p.calendar).toBeNull();
    expect(p.summary.heatmap).toBeNull();
    expect(p.summary.busiestHour).toBeNull();
  });

  it("rejects unknown keys", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    expect((await t.req("PATCH", "/me/visibility", { user: "u1", body: { email: true } })).status).toBe(400);
  });
});

describe("tokens", () => {
  it("stop working once revoked, and only the owner can revoke", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    await t.createUser("u2", "bob");
    const token = await t.login("u1", "laptop");
    const list = await json<{ tokens: Array<{ id: string; machineLabel: string }> }>(await t.req("GET", "/me/tokens", { user: "u1" }));
    expect(list.tokens.map((x) => x.machineLabel)).toEqual(["laptop"]);
    const id = list.tokens[0]!.id;

    expect((await t.req("DELETE", `/me/tokens/${id}`, { user: "u2" })).status).toBe(404);
    expect((await t.sync(token, [])).status).toBe(200);

    expect((await t.req("DELETE", `/me/tokens/${id}`, { user: "u1" })).status).toBe(204);
    const res = await t.sync(token, []);
    expect(res.status).toBe(401);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("token_revoked");
    expect((await json<{ tokens: unknown[] }>(await t.req("GET", "/me/tokens", { user: "u1" }))).tokens).toEqual([]);
  });

  it("can be revoked by the CLI itself on logout", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    expect((await t.req("DELETE", "/cli/token", { token })).status).toBe(204);
    expect((await t.sync(token, [])).status).toBe(401);
  });
});

describe("account", () => {
  it("changes the handle once, and keeps it unique", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    await t.createUser("u2", "bob");
    expect((await t.req("PATCH", "/me/profile", { user: "u1", body: { handle: "Bob" } })).status).toBe(409);
    expect((await t.req("PATCH", "/me/profile", { user: "u1", body: { handle: "-bad-" } })).status).toBe(400);
    expect((await t.req("PATCH", "/me/profile", { user: "u1", body: { handle: "ada-codes" } })).status).toBe(200);
    expect((await t.req("GET", "/u/ada-codes")).status).toBe(200);
    expect((await t.req("GET", "/u/ada")).status).toBe(404);
    const again = await t.req("PATCH", "/me/profile", { user: "u1", body: { handle: "ada-again" } });
    expect((await json<{ error: { code: string } }>(again)).error.code).toBe("handle_locked");
    const me = await json<{ profile: { canChangeHandle: boolean } }>(await t.req("GET", "/me", { user: "u1" }));
    expect(me.profile.canChangeHandle).toBe(false);
  });

  it("gives a second user with the same login a different handle", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    await t.req("PATCH", "/me/profile", { user: "u1", body: { handle: "ada-old" } });
    await t.createUser("u2", "ada-old");
    const [p] = await t.db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.userId, "u2"));
    expect(p!.handle).toBe("ada-old-2");
  });

  it("deletes data, and deletes the account with everything in it", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    const token = await t.login("u1");
    await t.sync(token, [day("2026-11-07", "claude")]);
    const del = await json<{ deletedDays: number }>(await t.req("DELETE", "/me/data", { user: "u1" }));
    expect(del.deletedDays).toBe(1);
    expect((await json<PublicProfile>(await t.req("GET", "/u/ada"))).summary.totals.tokens.headline).toBe(0);

    await t.sync(token, [day("2026-11-07", "claude")]);
    expect((await t.req("DELETE", "/me", { user: "u1" })).status).toBe(204);
    expect((await t.req("GET", "/u/ada")).status).toBe(404);
    expect(await t.db.select().from(dailyStats)).toEqual([]);
    expect(await t.db.select().from(cliTokens)).toEqual([]);
    expect((await t.sync(token, [])).status).toBe(401);
  });
});

describe("http", () => {
  it("allows only the web origin", async () => {
    const t = await setup();
    const ok = await t.req("GET", "/health", { headers: { origin: WEB } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const www = await t.req("GET", "/health", { headers: { origin: "https://www.web.test" } });
    expect(www.headers.get("access-control-allow-origin")).toBe("https://www.web.test");
    const other = await t.req("GET", "/health", { headers: { origin: "https://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const lookalike = await t.req("GET", "/health", { headers: { origin: "https://web.test.evil.test" } });
    expect(lookalike.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("validates the period", async () => {
    const t = await setup();
    await t.createUser("u1", "ada");
    expect((await t.req("GET", "/u/ada?period=2w")).status).toBe(400);
    expect((await t.req("GET", "/u/@ADA?period=all")).status).toBe(200);
  });
});
