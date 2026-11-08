import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { emptyAggregate, emptyMask, encodeMask, setRange, type DailyAggregate, type Source } from "@codewrapped/stats";
import { createApp } from "../src/app";
import { schema, type Db } from "../src/db";
import { users } from "../src/db/schema";
import { ensureProfile } from "../src/lib/profiles";

export const WEB = "https://web.test";

export async function setup(opts: { syncLimit?: { requests: number; windowMs: number } } = {}) {
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const db = drizzle(pg, { schema }) as unknown as Db;
  const clock = { now: new Date("2026-11-08T12:00:00Z") };
  // Tests sign in by header instead of a Better Auth cookie.
  const app = createApp({
    db,
    webUrl: WEB,
    getUserId: async (req) => req.headers.get("x-test-user"),
    now: () => clock.now,
    syncLimit: opts.syncLimit,
  });

  const req = (method: string, path: string, init: { body?: unknown; user?: string; token?: string; headers?: Record<string, string> } = {}) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-test-user": init.user } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });

  const createUser = async (id: string, githubLogin: string, opts: { githubCreatedAt?: Date } = {}) => {
    const githubCreatedAt = opts.githubCreatedAt ?? new Date("2020-01-01T00:00:00Z");
    await db.insert(users).values({ id, name: githubLogin, email: `${id}@example.test`, githubLogin, githubCreatedAt });
    await ensureProfile(db, { id, name: githubLogin, image: null, githubLogin });
  };

  /** Runs the whole device flow and returns a CLI token. */
  const login = async (userId: string, machineLabel = "laptop") => {
    const start = (await (await req("POST", "/cli/device", { body: { machineLabel } })).json()) as {
      deviceCode: string;
      userCode: string;
    };
    await req("POST", `/cli/device/${start.userCode}/approve`, { user: userId });
    const res = await req("POST", "/cli/token", { body: { deviceCode: start.deviceCode } });
    return ((await res.json()) as { token: string }).token;
  };

  const sync = (token: string, days: DailyAggregate[], machineId = "machine-aaaa", timeZone = "Europe/Berlin") =>
    req("POST", "/sync", { token, body: { machineId, timeZone, days } });

  return { db, app, req, clock, createUser, login, sync };
}

/** A day with active minutes from..to (inclusive minutes of the day). */
export function day(d: string, source: Source, p: { from?: number; to?: number; tokens?: number; files?: Record<string, number>; repos?: Record<string, number>; cost?: number } = {}): DailyAggregate {
  const r = emptyAggregate(d, source);
  const mask = emptyMask();
  const from = p.from ?? 600;
  const to = p.to ?? 659;
  setRange(mask, from, to);
  r.activeMask = encodeMask(mask);
  r.agentMinutes = to - from + 1;
  r.sessions = 1;
  r.peakSessions = 1;
  r.messages = 3;
  const tokens = p.tokens ?? 1000;
  r.tokens = { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 };
  r.models = { "claude-opus-5-5": { tokens, cacheRead: 0, costUsd: p.cost ?? 1 } };
  r.tools = { Bash: 5, Edit: 2 };
  r.files = p.files ?? { "page.tsx": 2 };
  r.repos = Object.fromEntries(Object.entries(p.repos ?? { "secret-repo": 1 }).map(([k, share]) => [k, { minutes: r.agentMinutes * share, tokens: tokens * share }]));
  return r;
}
