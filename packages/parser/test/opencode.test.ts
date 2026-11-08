import { cp, mkdtemp, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ADAPTER, parseFiles } from "../src/index";

const t0 = Date.parse("2026-01-14T10:00:00Z");
const min = 60_000;

/** A small opencode database in WAL mode. The connection stays open, like a running opencode. */
async function liveDatabase() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "codewrapped-oc-")));
  const db = new DatabaseSync(join(dir, "opencode.db"));
  db.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0;");
  db.exec(`
    create table session (id text primary key, parent_id text, directory text not null, version text not null, permission text, time_created integer not null);
    create table session_message (id text primary key, session_id text not null, type text not null, data text not null);
    create table message (id text primary key, session_id text not null, time_created integer not null, data text not null);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, data text not null);
    create table credential (id text primary key, value text not null);
  `);
  const session = db.prepare("insert into session values (?, ?, ?, ?, ?, ?)");
  const message = db.prepare("insert into message values (?, ?, ?, ?)");
  const part = db.prepare("insert into part values (?, ?, ?, ?, ?)");
  db.prepare("insert into credential values (?, ?)").run("c1", "never-read");

  session.run("ses_a", null, "/home/dev/shop", "1.19.5", null, t0);
  session.run("ses_child", "ses_a", "/home/dev/shop", "1.19.5", null, t0 + 2 * min);
  // What `opencode run` sets: nobody is there to answer questions or approve a plan.
  const run = JSON.stringify(["question", "plan_enter", "plan_exit"].map((permission) => ({ permission, action: "deny", pattern: "*" })));
  session.run("ses_run", null, "/home/dev/bot", "1.19.5", run, t0 + 10 * min);
  db.prepare("insert into session_message values (?, ?, ?, ?)").run("sm_1", "ses_v2", "assistant", "{}");
  message.run("msg_1", "ses_a", t0, JSON.stringify({ role: "user", time: { created: t0 } }));
  const assistant = (created: number, tokens: object, cost: number, cwd = "/home/dev/shop") =>
    JSON.stringify({ role: "assistant", modelID: "glm-4.6", providerID: "zai", path: { cwd, root: "/" }, cost, tokens, time: { created, completed: created + 30_000 } });
  message.run("msg_2", "ses_a", t0 + min, assistant(t0 + min, { input: 600, output: 60, reasoning: 30, cache: { read: 3000, write: 0 } }, 0.25));
  // A failed request: no tokens, not counted.
  message.run("msg_3", "ses_a", t0 + 90_000, assistant(t0 + 90_000, { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 0));
  const tool = (tool: string, input: object, at: number) =>
    JSON.stringify({ type: "tool", tool, callID: `call_${tool}`, state: { status: "completed", input, time: { start: at, end: at + 1000 } } });
  part.run("prt_1", "msg_2", "ses_a", t0 + min, tool("bash", { command: "cd src && grep -rn todo ." }, t0 + min + 1000));
  part.run("prt_2", "msg_2", "ses_a", t0 + min, tool("edit", { filePath: "/home/dev/shop/src/cart.ts" }, t0 + min + 2000));
  part.run("prt_3", "msg_2", "ses_a", t0 + min, tool("todowrite", { todos: [] }, t0 + min + 3000));
  // Two steps. The message keeps only the last step's tokens; the steps add up to the real total.
  part.run("prt_4", "msg_2", "ses_a", t0 + min, JSON.stringify({ type: "step-finish", tokens: { input: 400, output: 40, reasoning: 20, cache: { read: 2000, write: 0 } }, cost: 0.1 }));
  part.run("prt_5", "msg_2", "ses_a", t0 + min, JSON.stringify({ type: "step-finish", tokens: { input: 600, output: 60, reasoning: 30, cache: { read: 3000, write: 0 } }, cost: 0.15 }));
  // A subagent session from the task tool: its prompt is written by the parent agent.
  message.run("msg_4", "ses_child", t0 + 2 * min, JSON.stringify({ role: "user", time: { created: t0 + 2 * min } }));
  message.run("msg_5", "ses_child", t0 + 3 * min, assistant(t0 + 3 * min, { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, 0));
  message.run("msg_6", "ses_run", t0 + 10 * min, JSON.stringify({ role: "user", time: { created: t0 + 10 * min } }));
  message.run("msg_7", "ses_run", t0 + 11 * min, assistant(t0 + 11 * min, { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }, 0.01, "/home/dev/bot"));
  return { dir, db };
}

const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  delete process.env.CODEWRAPPED_SQLITE;
});

describe("opencode adapter", () => {
  it("reads a live database through a copy, the same with node:sqlite and sql.js", async () => {
    const { dir, db } = await liveDatabase();
    open.push(db);
    const files = await ADAPTER.opencode.listFiles([dir]);
    expect(files.map((f) => f.slice(dir.length))).toEqual(["/opencode.db"]);
    expect(await ADAPTER.opencode.countSessions([dir], files)).toBe(2);
    const before = await stat(join(dir, "opencode.db-wal"));
    expect(before.size).toBeGreaterThan(0);

    const native = await parseFiles({ files: { opencode: files }, timeZone: "UTC" });
    process.env.CODEWRAPPED_SQLITE = "sql.js";
    const wasm = await parseFiles({ files: { opencode: files }, timeZone: "UTC" });
    expect(wasm.aggregates).toEqual(native.aggregates);

    const after = await stat(join(dir, "opencode.db-wal"));
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    expect(native.warnings.opencode.unknownEvents).toEqual({ "opencode:(2.x session_message rows, not read yet)": 1 });

    const row = native.aggregates[0]!;
    expect(row.source).toBe("opencode");
    expect(row.sessions).toBe(1);
    expect(row.messages).toBe(1);
    expect(row.automated).toMatchObject({ sessions: 1, messages: 1 });
    // Steps summed; from 1.3.16 on reasoning is apart from output and billed as output.
    expect(row.tokens).toEqual({ input: 1110, output: 165, cacheRead: 5000, cacheWrite: 0 });
    expect(row.models["glm-4.6"]).toEqual({ tokens: 1275, cacheRead: 5000, costUsd: expect.any(Number) });
    // Recorded costs win; the subagent's recorded $0 falls back to GLM 4.6 prices.
    expect(row.models["glm-4.6"]!.costUsd).toBeCloseTo(0.25 + 0.01 + (10 * 0.6 + 5 * 2.2) / 1e6, 9);
    expect(row.tools).toEqual({ bash: 1, edit: 1, todowrite: 1 });
    expect(row.toolCategories).toEqual({ search: 1, edit: 1, plan: 1 });
    expect(row.files).toEqual({ "cart.ts": 1 });
    expect(row.repos.shop!.tokens).toBe(1165);
    expect(row.repos.bot!.tokens).toBe(110);
  });
});

describe("opencode legacy JSON", () => {
  const fixtures = join(import.meta.dirname, "../fixtures/opencode");

  it("reads storage/ files and lets the database win for the same ids", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "codewrapped-oc-json-")));
    await cp(fixtures, dir, { recursive: true });
    const jsonOnly = await ADAPTER.opencode.listFiles([dir]);
    expect(jsonOnly.map((f) => f.slice(dir.length)).sort()).toEqual([
      "/storage/message/ses_old/msg_old1.json",
      "/storage/message/ses_old/msg_old2.json",
      "/storage/part/msg_old2/prt_old1.json",
      "/storage/part/msg_old2/prt_old2.json",
      "/storage/session/global/ses_old.json",
    ]);
    expect(await ADAPTER.opencode.countSessions([dir], jsonOnly)).toBe(1);
    const json = await parseFiles({ files: { opencode: jsonOnly }, timeZone: "UTC" });
    const row = json.aggregates[0]!;
    expect(row).toMatchObject({ day: "2025-12-01", sessions: 1, messages: 1, tools: { read: 1 }, toolCategories: { read: 1 } });
    // 1.1.x: output already holds reasoning, so reasoning is not added again.
    expect(row.tokens).toEqual({ input: 300, output: 40, cacheRead: 0, cacheWrite: 0 });

    // After the move to SQLite the same session is in the database too. It counts once.
    const db = new DatabaseSync(join(dir, "opencode.db"));
    open.push(db);
    db.exec(`
      create table session (id text primary key, parent_id text, directory text not null, version text not null, permission text, time_created integer not null);
      create table message (id text primary key, session_id text not null, data text not null);
      create table part (id text primary key, message_id text not null, session_id text not null, data text not null);
    `);
    db.prepare("insert into session values (?, ?, ?, ?, ?, ?)").run("ses_old", null, "/home/dev/shop", "1.1.60", null, Date.parse("2025-12-01T09:00:00Z"));
    const both = await ADAPTER.opencode.listFiles([dir]);
    const merged = await parseFiles({ files: { opencode: both }, timeZone: "UTC" });
    expect(merged.aggregates).toEqual(json.aggregates);
  });
});
