import { and, count, desc, eq, gt, gte, isNull, lte, max, min, notInArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { addDays, buildPublicProfile, isKnownSource, knownRows, PERIODS, todayIn, type DailyAggregate, type Period, type PublicProfile } from "@codewrapped/stats";
import { webOrigins } from "./config";
import type { Db } from "./db";
import { cliTokens, dailyStats, DEFAULT_VISIBILITY, deviceCodes, profiles, users, type Visibility } from "./db/schema";
import { Boards, type BoardRange } from "./lib/boards";
import { TtlCache } from "./lib/cache";
import { randomId, randomToken, sha256, userCode } from "./lib/crypto";
import { fail } from "./lib/errors";
import { handleTaken } from "./lib/profiles";
import { clientIp, RateLimiter } from "./lib/ratelimit";
import {
  BOARD_METRICS,
  BOARD_PERIODS,
  boardRange,
  holdFor,
  percentile,
  rank,
  score,
  type BoardMetric,
  type BoardPeriod,
  type Candidate,
  type Ranked,
  type ScoredDay,
} from "./lib/leaderboard";
import { flagDay } from "./lib/plausibility";
import { checkDays, HANDLE_RE, SyncBody } from "./validation";

export type AppDeps = {
  db: Db;
  webUrl: string;
  /** The signed-in user's id from the session cookie, or null. */
  getUserId: (req: Request) => Promise<string | null>;
  /** Better Auth's request handler, mounted at /auth/*. */
  authHandler?: (req: Request) => Promise<Response>;
  now?: () => Date;
  /** When the user's GitHub account was created, for accounts made before that was recorded at sign-up. */
  githubCreatedAt?: (userId: string) => Promise<Date | null>;
  syncLimit?: { requests: number; windowMs: number };
  /** How often a changed leaderboard is rebuilt at most. */
  boardRefreshMs?: number;
};

const DEVICE_TTL_MS = 10 * 60_000;
const DEVICE_INTERVAL_S = 5;
const MAX_SYNC_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024;
/** Logging in again past this many connected computers disconnects the oldest. */
const MAX_LIVE_TOKENS = 10;
const MAX_MACHINES = 10;
const MAX_SOURCES = 20;
const USER_CODE_RE = /^[A-Z]{4}-\d{4}$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Vars = { userId: string; tokenId: string };

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);
  const cache = new TtlCache<PublicProfile>(5 * 60_000);
  /** Users GitHub was asked about lately, so a failing lookup is not repeated on every request. */
  const askedGithub = new TtlCache<true>(60 * 60_000);
  const syncLimiter = new RateLimiter(deps.syncLimit?.requests ?? 30, deps.syncLimit?.windowMs ?? 10 * 60_000);
  const deviceStartLimiter = new RateLimiter(10, 10 * 60_000);
  const codeTriesByUser = new RateLimiter(20, 10 * 60_000);
  const codeTriesByIp = new RateLimiter(50, 10 * 60_000);
  const app = new Hono<{ Variables: Vars }>();
  const allowedOrigins = webOrigins(deps.webUrl);

  app.use(
    "*",
    secureHeaders({
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      // Not same-origin: the website on the sibling subdomain still loads responses from here.
      crossOriginResourcePolicy: "same-site",
      xFrameOptions: "DENY",
    }),
  );

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Browsers send Origin with every request that can change state. The CLI sends none and signs in with a Bearer token, not a cookie.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (SAFE_METHODS.has(c.req.method) || origin === undefined || allowedOrigins.includes(origin)) return next();
    return fail(c, 403, "forbidden_origin", "This request came from another website.");
  });

  const smallBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => fail(c, 413, "payload_too_large", "Send at most 16 KB per request."),
  });
  app.use("*", (c, next) => (c.req.path === "/sync" ? next() : smallBody(c, next)));

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

  const ipOf = (c: Context) => clientIp(c.req.raw, (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress);

  const tooMany = (c: Context, wait: number, message: string) => {
    c.header("Retry-After", String(wait));
    return fail(c, 429, "rate_limited", `${message} Try again in ${wait} seconds.`);
  };

  // ---- device login ----

  app.post("/cli/device", async (c) => {
    const wait = deviceStartLimiter.take(ipOf(c), now().getTime());
    if (wait > 0) return tooMany(c, wait, "Too many logins from this network.");
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
    const newest = db
      .select({ id: cliTokens.id })
      .from(cliTokens)
      .where(and(eq(cliTokens.userId, userId), isNull(cliTokens.revokedAt)))
      .orderBy(desc(cliTokens.createdAt), desc(cliTokens.id))
      .limit(MAX_LIVE_TOKENS);
    await db
      .update(cliTokens)
      .set({ revokedAt: now() })
      .where(and(eq(cliTokens.userId, userId), isNull(cliTokens.revokedAt), notInArray(cliTokens.id, newest)));
    const [p] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.userId, userId));
    return c.json({ token, handle: p?.handle ?? null });
  });

  const pendingDevice = async (code: string) => {
    if (!USER_CODE_RE.test(code)) return null;
    const [dc] = await db
      .select()
      .from(deviceCodes)
      .where(and(eq(deviceCodes.userCode, code.toUpperCase()), eq(deviceCodes.status, "pending"), gt(deviceCodes.expiresAt, now())))
      .limit(1);
    return dc ?? null;
  };

  const notPending = (c: Context) => fail(c, 404, "not_found", 'This code is not valid or expired. Run "npx codewrapped login" again.');

  /** Codes are short enough to guess, so each account and each address gets few tries. */
  const limitCodeTries = async (c: Context<{ Variables: Vars }>, next: () => Promise<void>) => {
    const at = now().getTime();
    const wait = Math.max(codeTriesByUser.take(c.get("userId"), at), codeTriesByIp.take(ipOf(c), at));
    if (wait > 0) return tooMany(c, wait, "Too many codes tried.");
    await next();
  };

  app.get("/cli/device/:code", requireSession, limitCodeTries, async (c) => {
    const dc = await pendingDevice(c.req.param("code") ?? "");
    if (!dc) return notPending(c);
    return c.json({ userCode: dc.userCode, machineLabel: dc.machineLabel, createdAt: dc.createdAt.toISOString() });
  });

  for (const action of ["approve", "deny"] as const) {
    app.post(`/cli/device/:code/${action}`, requireSession, limitCodeTries, async (c) => {
      const dc = await pendingDevice(c.req.param("code") ?? "");
      if (!dc) return notPending(c);
      const decided = await db
        .update(deviceCodes)
        .set(action === "approve" ? { status: "approved", userId: c.get("userId") } : { status: "denied" })
        .where(and(eq(deviceCodes.deviceCodeHash, dc.deviceCodeHash), eq(deviceCodes.status, "pending"), gt(deviceCodes.expiresAt, now())))
        .returning({ status: deviceCodes.status });
      if (decided.length === 0) return notPending(c);
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
      const wait = syncLimiter.take(c.get("userId"), now().getTime());
      if (wait > 0) return tooMany(c, wait, "Too many syncs.");
      const parsed = SyncBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return fail(c, 400, "invalid_payload", `The upload was rejected at ${issue?.path.join(".") || "body"}: ${issue?.message}. Update the CLI and try again.`);
      }
      const { machineId, timeZone } = parsed.data;
      const userId = c.get("userId");
      const [stored] = await db
        .select({
          machines: sql<string[]>`coalesce(array_agg(distinct ${dailyStats.machineId}), '{}')`,
          sources: sql<string[]>`coalesce(array_agg(distinct ${dailyStats.source}), '{}')`,
        })
        .from(dailyStats)
        .where(eq(dailyStats.userId, userId));
      const machines = new Set(stored?.machines ?? []);
      if (!machines.has(machineId) && machines.size >= MAX_MACHINES) {
        return fail(c, 403, "too_many_machines", `This account already has data from ${MAX_MACHINES} computers. Delete your synced data in the settings on the website to start over.`);
      }
      // One bad or unknown row never costs the rest of the upload.
      const { valid: days, skipped } = checkDays(parsed.data.days, {
        latestDay: addDays(today(), 1),
        sources: new Set(stored?.sources ?? []),
        maxSources: MAX_SOURCES,
      });
      if (days.length > 0) {
        // One row per user, machine, source and day. Re-sending a day replaces it.
        await db
          .insert(dailyStats)
          .values(
            days.map((d) => ({
              userId,
              machineId,
              source: d.source,
              day: d.day,
              // Rows of harnesses the registry does not know are kept and only read once it does.
              data: d as DailyAggregate,
              schemaVersion: d.schemaVersion,
              flag: flagDay(d as DailyAggregate),
              updatedAt: now(),
            })),
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
      boards.markStale();
      return c.json({
        received: days.length,
        skipped: skipped.slice(0, 20),
        skippedCount: skipped.length,
        profileUrl: profile ? `${deps.webUrl}/@${profile.handle}` : null,
      });
    },
  );

  // ---- leaderboards ----

  /** Everyone with synced days in the range, scored. Opt-in and eligibility are decided per board. */
  const buildBoard = async (_period: BoardPeriod, { start, end }: BoardRange): Promise<Candidate[]> => {
    // Only the fields scoring reads: the whole row is many times larger.
    const rows = await db
      .select({
        userId: dailyStats.userId,
        day: dailyStats.day,
        source: dailyStats.source,
        activeMask: sql<string>`${dailyStats.data}->>'activeMask'`,
        tokens: sql<DailyAggregate["tokens"]>`${dailyStats.data}->'tokens'`,
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
    const byUser = new Map<string, { first: (typeof rows)[number]; days: ScoredDay[]; flags: Array<{ day: string; flag: string }> }>();
    // Harnesses the registry does not know yet never count toward a board.
    for (const r of rows) {
      if (!isKnownSource(r.source)) continue;
      const u = byUser.get(r.userId) ?? { first: r, days: [], flags: [] };
      u.days.push({ day: r.day, activeMask: r.activeMask, tokens: r.tokens });
      if (r.flag !== null) u.flags.push({ day: r.day, flag: r.flag });
      byUser.set(r.userId, u);
    }
    return [...byUser.values()].map(({ first, days, flags }) => {
      const hold = first.trusted ? null : holdFor(first.githubCreatedAt, flags, now());
      return {
        userId: first.userId,
        handle: first.handle,
        displayName: first.displayName,
        avatarUrl: first.avatarUrl,
        xHandle: first.xHandle,
        optedIn: first.optedIn,
        eligible: hold === null,
        hold,
        scores: score(days),
      };
    });
  };

  const boards = new Boards({
    build: buildBoard,
    range: (period) => boardRange(period, today()),
    refreshMs: deps.boardRefreshMs ?? 30_000,
    maxAgeMs: 5 * 60_000,
  });

  const boardQuery = (c: Context<{ Variables: Vars }>) => {
    const period = (c.req.query("period") ?? "week") as BoardPeriod;
    const metric = (c.req.query("metric") ?? "hours") as BoardMetric;
    if (!BOARD_PERIODS.includes(period) || !BOARD_METRICS.includes(metric)) return null;
    return { period, metric };
  };

  app.get("/leaderboard", async (c) => {
    const q = boardQuery(c);
    if (!q) return fail(c, 400, "invalid_board", `Use period ${BOARD_PERIODS.join(" or ")} and metric ${BOARD_METRICS.join(", ")}.`);
    const ranked = rank((await boards.get(q.period)).filter((x) => x.optedIn && x.eligible), q.metric);
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

  /**
   * Fills users.github_created_at when it is missing, which holds every account made
   * before the leaderboards back from ranking. At most one GitHub request per user an hour.
   */
  const fillGithubAge = async (userId: string): Promise<boolean> => {
    if (!deps.githubCreatedAt || askedGithub.get(userId)) return false;
    askedGithub.set(userId, true);
    const at = await deps.githubCreatedAt(userId).catch(() => null);
    if (!at) return false;
    await db
      .update(users)
      .set({ githubCreatedAt: at })
      .where(and(eq(users.id, userId), isNull(users.githubCreatedAt)));
    boards.markStale();
    return true;
  };

  app.get("/leaderboard/me", requireSession, async (c) => {
    const q = boardQuery(c);
    if (!q) return fail(c, 400, "invalid_board", `Use period ${BOARD_PERIODS.join(" or ")} and metric ${BOARD_METRICS.join(", ")}.`);
    let all = await boards.get(q.period);
    let me = all.find((x) => x.userId === c.get("userId"));
    if (me?.hold?.reason === "account_age_unknown" && (await fillGithubAge(me.userId))) {
      all = await boards.fresh(q.period);
      me = all.find((x) => x.userId === c.get("userId"));
    }
    const [p] = await db.select({ optedIn: profiles.leaderboard }).from(profiles).where(eq(profiles.userId, c.get("userId")));
    const ranked = rank(all.filter((x) => x.optedIn && x.eligible), q.metric);
    const mine = ranked.find((x) => x.userId === c.get("userId"));
    return c.json({
      optedIn: p?.optedIn ?? false,
      eligible: me?.eligible ?? null,
      hold: me?.hold ?? null,
      rank: mine?.rank ?? null,
      value: mine?.value ?? null,
      participants: ranked.length,
    });
  });

  const monthRanks = new WeakMap<Candidate[], Ranked[]>();
  /**
   * "Top N%" this month by hours, among all eligible active users, opted in or not.
   * Read from the last built board: a profile view never builds one.
   */
  const standing = (userId: string): PublicProfile["standing"] => {
    const board = boards.peek("month");
    if (!board) return null;
    let ranked = monthRanks.get(board);
    if (!ranked) {
      ranked = rank(board.filter((x) => x.eligible), "hours");
      monthRanks.set(board, ranked);
    }
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
        knownRows(rows.map((r) => r.data)),
        period,
        todayIn(p.timeZone, now()),
      );
      cache.set(key, body);
    }
    c.header("Cache-Control", "public, max-age=60");
    return c.json({ ...body, standing: standing(p.userId) });
  });

  // ---- signed-in user ----

  const me = new Hono<{ Variables: Vars }>();
  me.use("*", requireSession);

  me.get("/", async (c) => {
    const userId = c.get("userId");
    const [row] = await db
      .select({ name: users.name, email: users.email, githubCreatedAt: users.githubCreatedAt, profile: profiles })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId));
    if (!row?.profile) return fail(c, 404, "not_found", "No profile for this account.");
    if (row.githubCreatedAt === null) await fillGithubAge(userId);
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
    boards.markStale();
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
