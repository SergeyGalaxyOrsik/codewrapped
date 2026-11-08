import { and, count, eq, gt, gte, isNull, lte, max, min, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { buildPublicProfile, PERIODS, todayIn, type Period, type PublicProfile } from "@codewrapped/stats";
import type { Db } from "./db";
import { cliTokens, dailyStats, DEFAULT_VISIBILITY, deviceCodes, profiles, users, type Visibility } from "./db/schema";
import { TtlCache } from "./lib/cache";
import { randomId, randomToken, sha256, userCode } from "./lib/crypto";
import { fail } from "./lib/errors";
import { handleTaken } from "./lib/profiles";
import { RateLimiter } from "./lib/ratelimit";
import {
  BOARD_METRICS,
  BOARD_PERIODS,
  boardRange,
  MIN_ACCOUNT_AGE_DAYS,
  percentile,
  rank,
  score,
  type BoardMetric,
  type BoardPeriod,
  type Candidate,
} from "./lib/leaderboard";
import { flagDay } from "./lib/plausibility";
import { HANDLE_RE, SyncBody } from "./validation";

export type AppDeps = {
  db: Db;
  webUrl: string;
  /** The signed-in user's id from the session cookie, or null. */
  getUserId: (req: Request) => Promise<string | null>;
  /** Better Auth's request handler, mounted at /auth/*. */
  authHandler?: (req: Request) => Promise<Response>;
  now?: () => Date;
  syncLimit?: { requests: number; windowMs: number };
};

const DEVICE_TTL_MS = 10 * 60_000;
const DEVICE_INTERVAL_S = 5;
const MAX_SYNC_BYTES = 1024 * 1024;

type Vars = { userId: string; tokenId: string };

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const cache = new TtlCache<PublicProfile>(5 * 60_000);
  const boards = new TtlCache<Candidate[]>(5 * 60_000);
  const syncLimiter = new RateLimiter(deps.syncLimit?.requests ?? 30, deps.syncLimit?.windowMs ?? 10 * 60_000);
  const app = new Hono<{ Variables: Vars }>();

  app.use(
    "*",
    cors({
      origin: deps.webUrl,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.onError((err, c) => {
    console.error(err);
    return fail(c, 500, "internal", "Something went wrong on our side. Try again in a minute.");
  });

  app.get("/health", async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  if (deps.authHandler) {
    const handler = deps.authHandler;
    app.on(["GET", "POST"], "/auth/*", (c) => handler(c.req.raw));
  }

  // ---- auth helpers ----

  const requireSession = async (c: Context<{ Variables: Vars }>, next: () => Promise<void>) => {
    const userId = await deps.getUserId(c.req.raw);
    if (!userId) return fail(c, 401, "unauthorized", "Sign in on the website first.");
    c.set("userId", userId);
    await next();
  };

  const requireToken = async (c: Context<{ Variables: Vars }>, next: () => Promise<void>) => {
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return fail(c, 401, "unauthorized", 'No token. Run "npx codewrapped login".');
    const [row] = await db
      .select({ id: cliTokens.id, userId: cliTokens.userId, lastUsedAt: cliTokens.lastUsedAt })
      .from(cliTokens)
      .where(and(eq(cliTokens.tokenHash, sha256(token)), isNull(cliTokens.revokedAt)))
      .limit(1);
    if (!row) return fail(c, 401, "token_revoked", 'This computer is no longer connected. Run "npx codewrapped login".');
    // Write last-used at most once a minute.
    if (!row.lastUsedAt || now().getTime() - row.lastUsedAt.getTime() > 60_000) {
      await db.update(cliTokens).set({ lastUsedAt: now() }).where(eq(cliTokens.id, row.id));
    }
    c.set("userId", row.userId);
    c.set("tokenId", row.id);
    await next();
  };

  const bust = async (userId: string) => cache.bust(`${userId}:`);

  // ---- device login ----

  app.post("/cli/device", async (c) => {
    const body = z
      .object({ machineLabel: z.string().min(1).max(100), machineId: z.string().max(64).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "invalid_request", "Send machineLabel, the name of this computer.");
    const deviceCode = randomToken("dc_");
    let code = userCode();
    for (let i = 0; i < 5; i++) {
      const [taken] = await db.select({ c: deviceCodes.userCode }).from(deviceCodes).where(eq(deviceCodes.userCode, code));
      if (!taken) break;
      code = userCode();
    }
    await db.insert(deviceCodes).values({
      deviceCodeHash: sha256(deviceCode),
      userCode: code,
      machineLabel: body.data.machineLabel,
      machineId: body.data.machineId ?? null,
      intervalSeconds: DEVICE_INTERVAL_S,
      expiresAt: new Date(now().getTime() + DEVICE_TTL_MS),
    });
    return c.json({
      deviceCode,
      userCode: code,
      verifyUrl: `${deps.webUrl}/device?code=${code}`,
      interval: DEVICE_INTERVAL_S,
      expiresIn: DEVICE_TTL_MS / 1000,
    });
  });

  /** Polled by the CLI. Errors follow RFC 8628 so clients know whether to keep polling. */
  app.post("/cli/token", async (c) => {
    const body = z.object({ deviceCode: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "invalid_request", "Send the deviceCode from /cli/device.");
    const hash = sha256(body.data.deviceCode);
    const [dc] = await db.select().from(deviceCodes).where(eq(deviceCodes.deviceCodeHash, hash)).limit(1);
    if (!dc || dc.status === "consumed") return fail(c, 400, "invalid_grant", 'This code is not valid. Run "npx codewrapped login" again.');
    if (dc.expiresAt < now()) return fail(c, 400, "expired_token", 'The code expired. Run "npx codewrapped login" again.');
    if (dc.status === "denied") return fail(c, 400, "access_denied", "The login was declined in the browser.");
    const tooSoon = dc.lastPolledAt && now().getTime() - dc.lastPolledAt.getTime() < dc.intervalSeconds * 1000;
    await db.update(deviceCodes).set({ lastPolledAt: now() }).where(eq(deviceCodes.deviceCodeHash, hash));
    if (dc.status === "pending") {
      return tooSoon
        ? fail(c, 400, "slow_down", `Poll at most every ${dc.intervalSeconds} seconds.`)
        : fail(c, 400, "authorization_pending", "Waiting for approval in the browser.");
    }
    // Approved: issue the token once and mark the code used.
    const consumed = await db
      .update(deviceCodes)
      .set({ status: "consumed" })
      .where(and(eq(deviceCodes.deviceCodeHash, hash), eq(deviceCodes.status, "approved")))
      .returning({ userId: deviceCodes.userId });
    const userId = consumed[0]?.userId;
    if (!userId) return fail(c, 400, "invalid_grant", 'This code was already used. Run "npx codewrapped login" again.');
    const token = randomToken("cw_");
    await db.insert(cliTokens).values({
      id: randomId(),
      userId,
      tokenHash: sha256(token),
      machineLabel: dc.machineLabel,
      machineId: dc.machineId,
    });
    const [p] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.userId, userId));
    return c.json({ token, handle: p?.handle ?? null });
  });

  const pendingDevice = async (code: string) => {
    const [dc] = await db
      .select()
      .from(deviceCodes)
      .where(and(eq(deviceCodes.userCode, code.toUpperCase()), eq(deviceCodes.status, "pending"), gt(deviceCodes.expiresAt, now())))
      .limit(1);
    return dc ?? null;
  };

  app.get("/cli/device/:code", requireSession, async (c) => {
    const dc = await pendingDevice(c.req.param("code") ?? "");
    if (!dc) return fail(c, 404, "not_found", "This code is not valid or expired. Run \"npx codewrapped login\" again.");
    return c.json({ userCode: dc.userCode, machineLabel: dc.machineLabel, createdAt: dc.createdAt.toISOString() });
  });

  for (const action of ["approve", "deny"] as const) {
    app.post(`/cli/device/:code/${action}`, requireSession, async (c) => {
      const dc = await pendingDevice(c.req.param("code") ?? "");
      if (!dc) return fail(c, 404, "not_found", "This code is not valid or expired. Run \"npx codewrapped login\" again.");
      await db
        .update(deviceCodes)
        .set(action === "approve" ? { status: "approved", userId: c.get("userId") } : { status: "denied" })
        .where(eq(deviceCodes.deviceCodeHash, dc.deviceCodeHash));
      return c.json({ ok: true });
    });
  }

  /** Used by "codewrapped logout" to revoke its own token. */
  app.delete("/cli/token", requireToken, async (c) => {
    await db.update(cliTokens).set({ revokedAt: now() }).where(eq(cliTokens.id, c.get("tokenId")));
    return c.body(null, 204);
  });

  // ---- sync ----

  app.post(
    "/sync",
    bodyLimit({
      maxSize: MAX_SYNC_BYTES,
      onError: (c) => fail(c, 413, "payload_too_large", "Send at most 1 MB per request. The CLI splits uploads for you."),
    }),
    requireToken,
    async (c) => {
      const wait = syncLimiter.take(c.get("tokenId"), now().getTime());
      if (wait > 0) {
        c.header("Retry-After", String(wait));
        return fail(c, 429, "rate_limited", `Too many syncs. Try again in ${wait} seconds.`);
      }
      const parsed = SyncBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return fail(c, 400, "invalid_payload", `The upload was rejected at ${issue?.path.join(".") || "body"}: ${issue?.message}. Update the CLI and try again.`);
      }
      const { machineId, timeZone, days } = parsed.data;
      const userId = c.get("userId");
      if (days.length > 0) {
        // One row per user, machine, source and day. Re-sending a day replaces it.
        await db
          .insert(dailyStats)
          .values(
            days.map((d) => ({ userId, machineId, source: d.source, day: d.day, data: d, schemaVersion: d.schemaVersion, flag: flagDay(d), updatedAt: now() })),
          )
          .onConflictDoUpdate({
            target: [dailyStats.userId, dailyStats.machineId, dailyStats.source, dailyStats.day],
            set: { data: sql`excluded.data`, schemaVersion: sql`excluded.schema_version`, flag: sql`excluded.flag`, updatedAt: sql`excluded.updated_at` },
          });
      }
      const [profile] = await db
        .update(profiles)
        .set({ timeZone, updatedAt: now() })
        .where(eq(profiles.userId, userId))
        .returning({ handle: profiles.handle });
      await bust(userId);
      boards.bust("");
      return c.json({ received: days.length, profileUrl: profile ? `${deps.webUrl}/@${profile.handle}` : null });
    },
  );

  // ---- leaderboards ----

  const today = () => now().toISOString().slice(0, 10);

  /** Everyone with synced days in the range, scored. Opt-in and eligibility are decided per board. */
  const candidates = async (period: BoardPeriod): Promise<Candidate[]> => {
    const { start, end } = boardRange(period, today());
    const key = `${start}:${end}`;
    const hit = boards.get(key);
    if (hit) return hit;
    const rows = await db
      .select({
        userId: dailyStats.userId,
        data: dailyStats.data,
        flag: dailyStats.flag,
        handle: profiles.handle,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        xHandle: profiles.xHandle,
        optedIn: profiles.leaderboard,
        trusted: profiles.leaderboardTrusted,
        githubCreatedAt: users.githubCreatedAt,
      })
      .from(dailyStats)
      .innerJoin(profiles, eq(profiles.userId, dailyStats.userId))
      .innerJoin(users, eq(users.id, dailyStats.userId))
      .where(and(gte(dailyStats.day, start), lte(dailyStats.day, end)));
    const minCreated = now().getTime() - MIN_ACCOUNT_AGE_DAYS * 86_400_000;
    const byUser = new Map<string, { first: (typeof rows)[number]; days: (typeof rows)[number]["data"][]; flagged: boolean }>();
    for (const r of rows) {
      const u = byUser.get(r.userId) ?? { first: r, days: [], flagged: false };
      u.days.push(r.data);
      u.flagged ||= r.flag !== null;
      byUser.set(r.userId, u);
    }
    const list: Candidate[] = [...byUser.values()].map(({ first, days, flagged }) => {
      const oldEnough = first.githubCreatedAt !== null && first.githubCreatedAt.getTime() <= minCreated;
      return {
        userId: first.userId,
        handle: first.handle,
        displayName: first.displayName,
        avatarUrl: first.avatarUrl,
        xHandle: first.xHandle,
        optedIn: first.optedIn,
        eligible: first.trusted || (oldEnough && !flagged),
        scores: score(days),
      };
    });
    boards.set(key, list);
    return list;
  };

  const boardQuery = (c: Context<{ Variables: Vars }>) => {
    const period = (c.req.query("period") ?? "week") as BoardPeriod;
    const metric = (c.req.query("metric") ?? "hours") as BoardMetric;
    if (!BOARD_PERIODS.includes(period) || !BOARD_METRICS.includes(metric)) return null;
    return { period, metric };
  };

  app.get("/leaderboard", async (c) => {
    const q = boardQuery(c);
    if (!q) return fail(c, 400, "invalid_board", `Use period ${BOARD_PERIODS.join(" or ")} and metric ${BOARD_METRICS.join(", ")}.`);
    const ranked = rank((await candidates(q.period)).filter((x) => x.optedIn && x.eligible), q.metric);
    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      ...q,
      range: boardRange(q.period, today()),
      label: "Self-reported from local logs",
      participants: ranked.length,
      entries: ranked.slice(0, 100).map((r) => ({
        rank: r.rank,
        handle: r.handle,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        xHandle: r.xHandle,
        value: r.value,
      })),
    });
  });

  app.get("/leaderboard/me", requireSession, async (c) => {
    const q = boardQuery(c);
    if (!q) return fail(c, 400, "invalid_board", `Use period ${BOARD_PERIODS.join(" or ")} and metric ${BOARD_METRICS.join(", ")}.`);
    const all = await candidates(q.period);
    const me = all.find((x) => x.userId === c.get("userId"));
    const [p] = await db.select({ optedIn: profiles.leaderboard }).from(profiles).where(eq(profiles.userId, c.get("userId")));
    const ranked = rank(all.filter((x) => x.optedIn && x.eligible), q.metric);
    const mine = ranked.find((x) => x.userId === c.get("userId"));
    return c.json({
      optedIn: p?.optedIn ?? false,
      eligible: me?.eligible ?? null,
      rank: mine?.rank ?? null,
      value: mine?.value ?? null,
      participants: ranked.length,
    });
  });

  /** "Top N%" this month by hours, among all eligible active users, opted in or not. */
  const standing = async (userId: string): Promise<PublicProfile["standing"]> => {
    const ranked = rank((await candidates("month")).filter((x) => x.eligible), "hours");
    const pct = percentile(ranked, userId);
    return pct === null ? null : { percentile: pct, period: "month" };
  };

  // ---- public profile ----

  app.get("/u/:handle", async (c) => {
    const period = (c.req.query("period") ?? "30d") as Period;
    if (!PERIODS.includes(period)) return fail(c, 400, "invalid_period", `Use one of ${PERIODS.join(", ")}.`);
    const handle = c.req.param("handle").replace(/^@/, "").toLowerCase();
    const [p] = await db.select().from(profiles).where(sql`lower(${profiles.handle}) = ${handle}`).limit(1);
    if (!p) return fail(c, 404, "not_found", "No profile with this handle.");
    const key = `${p.userId}:${period}`;
    let body = cache.get(key);
    if (!body) {
      const rows = await db.select({ data: dailyStats.data }).from(dailyStats).where(eq(dailyStats.userId, p.userId));
      body = buildPublicProfile(
        { handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, joinedAt: p.createdAt.toISOString() },
        { ...DEFAULT_VISIBILITY, ...p.visibility },
        rows.map((r) => r.data),
        period,
        todayIn(p.timeZone, now()),
      );
      body.standing = await standing(p.userId);
      cache.set(key, body);
    }
    c.header("Cache-Control", "public, max-age=60");
    return c.json(body);
  });

  // ---- signed-in user ----

  const me = new Hono<{ Variables: Vars }>();
  me.use("*", requireSession);

  me.get("/", async (c) => {
    const userId = c.get("userId");
    const [row] = await db
      .select({ name: users.name, email: users.email, profile: profiles })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId));
    if (!row?.profile) return fail(c, 404, "not_found", "No profile for this account.");
    const [stats] = await db
      .select({ days: count(), firstDay: min(dailyStats.day), lastDay: max(dailyStats.day) })
      .from(dailyStats)
      .where(eq(dailyStats.userId, userId));
    const p = row.profile;
    return c.json({
      name: row.name,
      email: row.email,
      profile: {
        handle: p.handle,
        canChangeHandle: p.handleChangedAt === null,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        timeZone: p.timeZone,
        visibility: { ...DEFAULT_VISIBILITY, ...p.visibility },
        leaderboard: p.leaderboard,
        xHandle: p.xHandle,
      },
      synced: stats ?? { days: 0, firstDay: null, lastDay: null },
    });
  });

  me.patch("/profile", async (c) => {
    const body = z
      .object({ handle: z.string().optional(), displayName: z.string().max(80).nullable().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "invalid_request", "Send handle or displayName.");
    const userId = c.get("userId");
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!p) return fail(c, 404, "not_found", "No profile for this account.");
    const set: Partial<typeof profiles.$inferInsert> = { updatedAt: now() };
    if (body.data.displayName !== undefined) set.displayName = body.data.displayName;
    const handle = body.data.handle?.trim().toLowerCase();
    if (handle && handle !== p.handle.toLowerCase()) {
      if (p.handleChangedAt) return fail(c, 409, "handle_locked", "You can change your handle once, and you already did.");
      if (!HANDLE_RE.test(handle)) return fail(c, 400, "invalid_handle", "Use 1 to 39 lowercase letters, digits or dashes, not starting or ending with a dash.");
      if (await handleTaken(db, handle)) return fail(c, 409, "handle_taken", "This handle is taken. Pick another.");
      set.handle = handle;
      set.handleChangedAt = now();
    }
    await db.update(profiles).set(set).where(eq(profiles.userId, userId));
    await bust(userId);
    return c.json({ ok: true, handle: set.handle ?? p.handle });
  });

  me.patch("/visibility", async (c) => {
    const body = z
      .object({
        files: z.boolean(),
        repos: z.boolean(),
        cost: z.boolean(),
        models: z.boolean(),
        tools: z.boolean(),
        heatmap: z.boolean(),
      })
      .partial()
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "invalid_request", "Send true or false for files, repos, cost, models, tools or heatmap.");
    const userId = c.get("userId");
    const [p] = await db.select({ visibility: profiles.visibility }).from(profiles).where(eq(profiles.userId, userId));
    if (!p) return fail(c, 404, "not_found", "No profile for this account.");
    const visibility: Visibility = { ...DEFAULT_VISIBILITY, ...p.visibility, ...body.data };
    await db.update(profiles).set({ visibility, updatedAt: now() }).where(eq(profiles.userId, userId));
    await bust(userId);
    return c.json({ visibility });
  });

  me.patch("/leaderboard", async (c) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        xHandle: z
          .string()
          .trim()
          .transform((s) => s.replace(/^@/, ""))
          .pipe(z.string().regex(/^[A-Za-z0-9_]{1,15}$/))
          .nullable()
          .optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "invalid_request", "Send enabled as true or false, and xHandle as 1 to 15 letters, digits or underscores.");
    const set: Partial<typeof profiles.$inferInsert> = { updatedAt: now() };
    if (body.data.enabled !== undefined) set.leaderboard = body.data.enabled;
    if (body.data.xHandle !== undefined) set.xHandle = body.data.xHandle || null;
    const [p] = await db
      .update(profiles)
      .set(set)
      .where(eq(profiles.userId, c.get("userId")))
      .returning({ leaderboard: profiles.leaderboard, xHandle: profiles.xHandle });
    boards.bust("");
    await bust(c.get("userId"));
    return c.json(p ?? { leaderboard: false, xHandle: null });
  });

  me.get("/tokens", async (c) => {
    const rows = await db
      .select({
        id: cliTokens.id,
        machineLabel: cliTokens.machineLabel,
        createdAt: cliTokens.createdAt,
        lastUsedAt: cliTokens.lastUsedAt,
      })
      .from(cliTokens)
      .where(and(eq(cliTokens.userId, c.get("userId")), isNull(cliTokens.revokedAt)))
      .orderBy(cliTokens.createdAt);
    return c.json({ tokens: rows });
  });

  me.delete("/tokens/:id", async (c) => {
    const revoked = await db
      .update(cliTokens)
      .set({ revokedAt: now() })
      .where(and(eq(cliTokens.id, c.req.param("id")), eq(cliTokens.userId, c.get("userId")), isNull(cliTokens.revokedAt)))
      .returning({ id: cliTokens.id });
    if (revoked.length === 0) return fail(c, 404, "not_found", "No connected computer with this id.");
    return c.body(null, 204);
  });

  me.delete("/data", async (c) => {
    const userId = c.get("userId");
    const deleted = await db.delete(dailyStats).where(eq(dailyStats.userId, userId)).returning({ day: dailyStats.day });
    await bust(userId);
    return c.json({ deletedDays: deleted.length });
  });

  me.delete("/", async (c) => {
    const userId = c.get("userId");
    // Profiles, tokens, stats, sessions and accounts go with the user (ON DELETE CASCADE).
    await db.delete(users).where(eq(users.id, userId));
    await bust(userId);
    return c.body(null, 204);
  });

  app.route("/me", me);
  return app;
}
