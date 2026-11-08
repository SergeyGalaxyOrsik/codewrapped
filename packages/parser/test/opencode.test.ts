import { mkdtemp, realpath, stat } from "node:fs/promises";
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
    create table session (id text primary key, parent_id text, directory text not null, time_created integer not null);
    create table message (id text primary key, session_id text not null, time_created integer not null, data text not null);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, data text not null);
    create table credential (id text primary key, value text not null);
  `);
  const session = db.prepare("insert into session values (?, ?, ?, ?)");
  const message = db.prepare("insert into message values (?, ?, ?, ?)");
  const part = db.prepare("insert into part values (?, ?, ?, ?, ?)");
  db.prepare("insert into credential values (?, ?)").run("c1", "never-read");

  session.run("ses_a", null, "/home/dev/shop", t0);
  session.run("ses_child", "ses_a", "/home/dev/shop", t0 + 2 * min);
  message.run("msg_1", "ses_a", t0, JSON.stringify({ role: "user", time: { created: t0 } }));
  const assistant = (created: number, tokens: object, cost: number) =>
    JSON.stringify({ role: "assistant", modelID: "glm-4.6", providerID: "zai", path: { cwd: "/home/dev/shop", root: "/" }, cost, tokens, time: { created, completed: created + 30_000 } });
  message.run("msg_2", "ses_a", t0 + min, assistant(t0 + min, { input: 1000, output: 100, reasoning: 50, cache: { read: 5000, write: 0 } }, 0.25));
  // A failed request: no tokens, not counted.
  message.run("msg_3", "ses_a", t0 + 90_000, assistant(t0 + 90_000, { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 0));
  const tool = (tool: string, input: object, at: number) =>
    JSON.stringify({ type: "tool", tool, callID: `call_${tool}`, state: { status: "completed", input, time: { start: at, end: at + 1000 } } });
  part.run("prt_1", "msg_2", "ses_a", t0 + min, tool("bash", { command: "cd src && grep -rn todo ." }, t0 + min + 1000));
  part.run("prt_2", "msg_2", "ses_a", t0 + min, tool("edit", { filePath: "/home/dev/shop/src/cart.ts" }, t0 + min + 2000));
  part.run("prt_3", "msg_2", "ses_a", t0 + min, tool("todowrite", { todos: [] }, t0 + min + 3000));
  part.run("prt_4", "msg_2", "ses_a", t0 + min, JSON.stringify({ type: "step-finish", tokens: { input: 1000 }, cost: 0.25 }));
  // A subagent session from the task tool: its prompt is written by the parent agent.
  message.run("msg_4", "ses_child", t0 + 2 * min, JSON.stringify({ role: "user", time: { created: t0 + 2 * min } }));
  message.run("msg_5", "ses_child", t0 + 3 * min, assistant(t0 + 3 * min, { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, 0));
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
    const before = await stat(join(dir, "opencode.db-wal"));
    expect(before.size).toBeGreaterThan(0);

    const native = await parseFiles({ files: { opencode: files }, timeZone: "UTC" });
    process.env.CODEWRAPPED_SQLITE = "sql.js";
    const wasm = await parseFiles({ files: { opencode: files }, timeZone: "UTC" });
    expect(wasm.aggregates).toEqual(native.aggregates);

    const after = await stat(join(dir, "opencode.db-wal"));
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    expect(await ADAPTER.opencode.countSessions([dir], files)).toBe(1);

    const row = native.aggregates[0]!;
    expect(row.source).toBe("opencode");
    expect(row.sessions).toBe(1);
    expect(row.messages).toBe(1);
    // Reasoning is billed as output.
    expect(row.tokens).toEqual({ input: 1010, output: 155, cacheRead: 5000, cacheWrite: 0 });
    expect(row.models["glm-4.6"]).toEqual({ tokens: 1165, cacheRead: 5000, costUsd: expect.any(Number) });
    // The recorded $0.25 wins; the subagent's recorded $0 falls back to GLM 4.6 prices.
    expect(row.models["glm-4.6"]!.costUsd).toBeCloseTo(0.25 + (10 * 0.6 + 5 * 2.2) / 1e6, 9);
    expect(row.tools).toEqual({ bash: 1, edit: 1, todowrite: 1 });
    expect(row.toolCategories).toEqual({ search: 1, edit: 1, plan: 1 });
    expect(row.files).toEqual({ "cart.ts": 1 });
    expect(row.repos.shop!.tokens).toBe(1165);
  });
});
