import { copyFile, mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ADAPTER, findLogFolders, parseFiles } from "../src/index";

const t0 = Date.parse("2026-01-14T10:00:00Z");
const sec = 1000;
const min = 60_000;

/** Tables as ZCode 3.17 creates them (schema.baseline.sql), trimmed to what matters here. */
const SCHEMA = `
  create table session (
    id text primary key, project_id text not null, workspace_id text, parent_id text, slug text not null,
    directory text not null, path text, title text not null, version text not null, permission text,
    time_created integer not null, time_updated integer not null, time_archived integer,
    task_type text not null default 'interactive', time_deleted integer, last_outcome text);
  create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null, sequence integer);
  create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null, sequence integer);
  create table session_task_link (id text primary key, parent_session_id text, child_session_id text not null, role text not null, path text not null, status text not null, time_created integer not null, time_updated integer not null);
  create table model_usage (id text primary key, session_id text not null, input_tokens integer not null default 0);
  create table credential_like (id text primary key, value text not null);
`;

const real = { origin: "real_user", kind: "user_prompt", uiVisibility: "visible", providerVisibility: "visible", transcriptVisibility: "visible" };
const reminder = { origin: "agent_runtime", kind: "system_reminder", uiVisibility: "hidden", providerVisibility: "visible", transcriptVisibility: "visible" };
const tokens = (input: number, output: number, read = 0, write = 0) => ({ input, output, reasoning: 0, cache: { read, write } });

/** A ZCode database in WAL mode with its connection left open, like a running ZCode. */
async function liveDatabase(dir: string, name = "db.sqlite") {
  await mkdir(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, name));
  db.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0;");
  db.exec(SCHEMA);
  const session = db.prepare(
    "insert into session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, task_type) values (?, 'prj', ?, ?, ?, 'x', '3.17.2', ?, ?, ?)",
  );
  const message = db.prepare("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)");
  const part = db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)");
  const addSession = (id: string, parent: string | null, created: number, taskType = "interactive", dirName = "/home/dev/shop") =>
    session.run(id, parent, id, dirName, created, created, taskType);
  const user = (id: string, s: string, created: number, extra: object = { semantics: real }) =>
    message.run(id, s, created, created, JSON.stringify({ role: "user", time: { created }, agent: "zcode-agent", ...extra }));
  const assistant = (id: string, s: string, created: number, tok: object, extra: object = {}) =>
    message.run(
      id,
      s,
      created,
      created,
      JSON.stringify({
        role: "assistant",
        time: { created, completed: created + 30 * sec },
        parentID: "msg_u1",
        modelId: "GLM-5.3",
        providerId: "zai",
        mode: "build",
        agent: "zcode-agent",
        path: { cwd: "/home/dev/shop/src", root: "/home/dev/shop" },
        cost: 0,
        tokens: tok,
        finish: "tool-calls",
        ...extra,
      }),
    );
  const tool = (id: string, msg: string, s: string, name: string, input: object, at: number, callID = `call_${id}`) =>
    part.run(id, msg, s, at, at, JSON.stringify({ type: "tool", callID, tool: name, state: { status: "completed", input, output: "secret output", title: "", metadata: {}, time: { start: at, end: at + sec } } }));

  // The main session: a prompt, a hidden reminder, two model steps.
  addSession("ses_main", null, t0);
  user("msg_u1", "ses_main", t0);
  user("msg_r1", "ses_main", t0 + 10 * sec, { semantics: reminder, synthetic: true });
  // ZCode's input holds cache reads and writes: 5000 = 500 new + 4000 read + 500 written. Output already holds reasoning.
  assistant("msg_a1", "ses_main", t0 + 20 * sec, { ...tokens(5000, 300, 4000, 500), reasoning: 120 });
  part.run("prt_a1_text", "msg_a1", "ses_main", t0, t0, JSON.stringify({ type: "text", text: "a reply that is never read" }));
  part.run("prt_a1_step", "msg_a1", "ses_main", t0, t0, JSON.stringify({ type: "step-finish", reason: "tool-calls", cost: 0, tokens: tokens(5000, 300, 4000, 500) }));
  tool("prt_a1_1", "msg_a1", "ses_main", "Bash", { command: "cd src && rg -n todo .", description: "search" }, t0 + 25 * sec);
  tool("prt_a1_2", "msg_a1", "ses_main", "Edit", { file_path: "/home/dev/shop/src/cart.ts", old_string: "a", new_string: "b" }, t0 + 27 * sec);
  tool("prt_a1_3", "msg_a1", "ses_main", "ApplyPatch", { patch_text: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch" }, t0 + 29 * sec);
  tool("prt_a1_4", "msg_a1", "ses_main", "TodoWrite", { todos: [] }, t0 + 31 * sec);
  // Some providers number call ids per reply, so two real calls can share one.
  tool("prt_a1_5", "msg_a1", "ses_main", "mcp__github__search_code", { q: "x" }, t0 + 33 * sec, "call_0");
  // A step whose message lost its tokens: the step-finish part has them.
  assistant("msg_a2", "ses_main", t0 + 60 * sec, tokens(0, 0));
  part.run("prt_a2_step", "msg_a2", "ses_main", t0, t0, JSON.stringify({ type: "step-finish", reason: "stop", cost: 0, tokens: tokens(1000, 50, 800) }));
  // A row from before modelId: the legacy field.
  message.run("msg_a3", "ses_main", t0 + 2 * min, t0, JSON.stringify({ role: "assistant", time: { created: t0 + 2 * min }, modelID: "glm-4.6", tokens: tokens(100, 20), cost: 0 }));

  // A subagent: folded into the main session, its prompt is the parent agent's.
  addSession("ses_sub", "ses_main", t0 + 30 * sec, "subagent_child");
  user("msg_s1", "ses_sub", t0 + 30 * sec);
  assistant("msg_s2", "ses_sub", t0 + 40 * sec, tokens(100, 10));
  tool("prt_s2_1", "msg_s2", "ses_sub", "Read", { file_path: "/home/dev/shop/README.md" }, t0 + 45 * sec, "call_0");

  // A workflow child linked through session_task_link only.
  addSession("ses_wf", null, t0 + 3 * min, "workflow_child");
  db.prepare("insert into session_task_link values ('lnk1', 'ses_main', 'ses_wf', 'child', '/', 'completed', ?, ?)").run(t0, t0);
  assistant("msg_w1", "ses_wf", t0 + 3 * min, tokens(40, 4));

  // A child from before task types: interactive by default, no copied history, so a subagent.
  addSession("ses_old_child", "ses_main", t0 + 4 * min);
  message.run("msg_o1", "ses_old_child", t0 + 4 * min, t0, JSON.stringify({ role: "user", time: { created: t0 + 4 * min } }));
  assistant("msg_o2", "ses_old_child", t0 + 4 * min + 10 * sec, tokens(50, 5));

  // A fork: copies of the parent's messages, then work of its own.
  const forkAt = t0 + 10 * min;
  addSession("ses_fork", "ses_main", forkAt, "fork");
  const origin = (messageId: string) => ({ metadata: { forkOrigin: { sessionId: "ses_main", messageId } } });
  user("msg_f_u1", "ses_fork", t0, { semantics: real, ...origin("msg_u1") });
  assistant("msg_f_a1", "ses_fork", t0 + 20 * sec, tokens(5000, 300, 4000, 500), origin("msg_a1"));
  tool("prt_f_a1_1", "msg_f_a1", "ses_fork", "Bash", { command: "cd src && rg -n todo ." }, t0 + 25 * sec, "call_copy");
  // An older copy without forkOrigin: its time is from before the fork.
  assistant("msg_f_a2", "ses_fork", t0 + 60 * sec, tokens(1000, 50, 800));
  user("msg_f_notice", "ses_fork", forkAt, { semantics: { ...reminder, kind: "fork_notice" }, synthetic: true, source: "fork" });
  user("msg_f_u2", "ses_fork", forkAt + min);
  assistant("msg_f_a3", "ses_fork", forkAt + 2 * min, tokens(300, 30));

  db.prepare("insert into model_usage values ('mu1', 'ses_main', 999999)").run();
  db.prepare("insert into credential_like values ('c1', 'never-read')").run();
  return db;
}

async function tempDir(prefix: string) {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  delete process.env.CODEWRAPPED_SQLITE;
});

describe("zcode adapter", () => {
  it("reads a live database through a copy, the same with node:sqlite and sql.js", async () => {
    const home = await tempDir("codewrapped-zc-");
    const dbDir = join(home, ".zcode", "cli", "db");
    open.push(await liveDatabase(dbDir));
    // A backup the restore plugin leaves next to the database is not read.
    await copyFile(join(dbDir, "db.sqlite"), join(dbDir, "db.sqlite.bak-20260114"));

    const files = await ADAPTER.zcode.listFiles([dbDir]);
    expect(files).toEqual([join(dbDir, "db.sqlite")]);
    // main, fork, and the old child, which only parsing can tell from a fork.
    expect(await ADAPTER.zcode.countSessions([dbDir], files)).toBe(3);
    const before = await stat(join(dbDir, "db.sqlite-wal"));
    expect(before.size).toBeGreaterThan(0);

    const native = await parseFiles({ files: { zcode: files }, timeZone: "UTC" });
    process.env.CODEWRAPPED_SQLITE = "sql.js";
    const wasm = await parseFiles({ files: { zcode: files }, timeZone: "UTC" });
    expect(wasm.aggregates).toEqual(native.aggregates);
    const after = await stat(join(dbDir, "db.sqlite-wal"));
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    expect(native.warnings.zcode).toMatchObject({ files: 1, badLines: 0, unknownEvents: {} });

    const row = native.aggregates.find((a) => a.source === "zcode")!;
    expect(native.aggregates).toHaveLength(1);
    // The main session with its subagents, and the fork.
    expect(row.sessions).toBe(2);
    // One typed prompt in each; reminders, fork notices, copies and subagent prompts are not prompts.
    expect(row.messages).toBe(2);
    expect(row.automated.sessions).toBe(0);
    // Cache taken out of input; fork copies skipped; subagents, workflow child and old child added.
    expect(row.tokens).toEqual({
      input: 500 + 200 + 100 + 100 + 40 + 50 + 300,
      output: 300 + 50 + 20 + 10 + 4 + 5 + 30,
      cacheRead: 4000 + 800,
      cacheWrite: 500,
    });
    expect(Object.keys(row.models).sort()).toEqual(["GLM-5.3", "glm-4.6"]);
    // ZCode writes cost 0, so GLM 5.3 prices are used.
    expect(row.models["GLM-5.3"]!.costUsd).toBeGreaterThan(0);
    expect(row.tools).toEqual({ Bash: 1, Edit: 1, ApplyPatch: 1, TodoWrite: 1, mcp__github__search_code: 1, Read: 1 });
    expect(row.toolCategories).toEqual({ search: 1, edit: 2, plan: 1, mcp: 1, read: 1 });
    expect(row.files).toEqual({ "cart.ts": 1, "a.ts": 1, "b.ts": 1 });
    expect(Object.keys(row.repos)).toEqual(["shop"]);
  });

  it("counts a database found twice, or copied, once", async () => {
    const home = await tempDir("codewrapped-zc-dup-");
    const a = join(home, "a");
    open.push(await liveDatabase(a));
    const b = join(home, "b");
    await mkdir(b);
    for (const suffix of ["", "-wal", "-shm"]) await copyFile(join(a, "db.sqlite") + suffix, join(b, "db.sqlite") + suffix);
    const once = await parseFiles({ files: { zcode: await ADAPTER.zcode.listFiles([a]) }, timeZone: "UTC" });
    const twice = await parseFiles({ files: { zcode: await ADAPTER.zcode.listFiles([a, b, a]) }, timeZone: "UTC" });
    expect(twice.aggregates).toEqual(once.aggregates);
  });

  it("reports a database that is not ZCode's instead of throwing", async () => {
    const dir = await tempDir("codewrapped-zc-bad-");
    const other = new DatabaseSync(join(dir, "db.sqlite"));
    other.exec("create table notes (id text)");
    other.close();
    await writeFile(join(dir, "broken.sqlite"), "not a database");
    const files = [join(dir, "db.sqlite"), join(dir, "broken.sqlite")];
    const { aggregates, warnings } = await parseFiles({ files: { zcode: files }, timeZone: "UTC" });
    expect(aggregates).toEqual([]);
    expect(Object.keys(warnings.zcode.unknownEvents)).toEqual(["zcode:(not a ZCode session database)", expect.stringMatching(/^zcode:\(unreadable database/)]);
  });
});

describe("zcode discovery", () => {
  it("follows ZCODE_SESSION_DB_PATH, storage.sessionDbPath and ~/.zcode", async () => {
    const home = await tempDir("codewrapped-zc-home-");
    const sqlite = async (p: string) => {
      await mkdir(join(p, ".."), { recursive: true });
      const db = new DatabaseSync(p);
      db.exec(SCHEMA);
      db.close();
    };
    await sqlite(join(home, "env", "mine.sqlite"));
    await sqlite(join(home, "cfg", "sessions.sqlite"));
    await sqlite(join(home, ".zcode", "cli", "db", "db.sqlite"));
    await writeFile(join(home, ".zcode", "cli", "config.json"), JSON.stringify({ storage: { sessionDbPath: "~/cfg/sessions.sqlite" }, model: { main: "x" } }));

    const f = await findLogFolders({ ZCODE_SESSION_DB_PATH: "~/env/mine.sqlite" }, home);
    expect(f.dirs.zcode).toEqual([join(home, "env", "mine.sqlite"), join(home, "cfg", "sessions.sqlite"), join(home, ".zcode", "cli", "db")]);
    const files = await ADAPTER.zcode.listFiles(f.dirs.zcode);
    expect(files.map((p) => p.slice(home.length))).toEqual(["/.zcode/cli/db/db.sqlite", "/cfg/sessions.sqlite", "/env/mine.sqlite"]);

    // A relative path depends on each workspace's cwd and is skipped.
    const relative = await findLogFolders({ ZCODE_SESSION_DB: "db/local.sqlite" }, home);
    expect(relative.dirs.zcode).toEqual([join(home, "cfg", "sessions.sqlite"), join(home, ".zcode", "cli", "db")]);
  });

  it("lets --zcode-dir name ~/.zcode, its db folder or the file", async () => {
    const home = await tempDir("codewrapped-zc-flag-");
    const dbDir = join(home, "data", ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "db.sqlite"));
    db.exec(SCHEMA);
    db.close();
    const file = join(dbDir, "db.sqlite");
    for (const flag of [join(home, "data", ".zcode"), dbDir, file]) {
      const f = await findLogFolders({}, home, { dirs: { zcode: [flag] } });
      expect(await ADAPTER.zcode.listFiles(f.dirs.zcode)).toEqual([file]);
    }
    expect(await ADAPTER.zcode.looksLike(join(home, "data", ".zcode"))).toBe(true);
    expect(await ADAPTER.zcode.looksLike(home)).toBe(false);
  });
});
