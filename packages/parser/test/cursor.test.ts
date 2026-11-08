import { mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ADAPTER, cursorAppDirs, cursorToolCategory, findLogFolders, parseFiles } from "../src/index";

const t0 = Date.parse("2026-01-14T10:00:00Z");
const sec = 1000;
const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** The tables of Cursor's state.vscdb that matter here, plus ItemTable, which holds its login tokens. */
const SCHEMA = `
  create table ItemTable (key text unique on conflict replace, value blob);
  create table cursorDiskKV (key text unique on conflict replace, value blob);
  create table composerHeaders (composerId text primary key, workspaceId text, createdAt integer, lastUpdatedAt integer,
    isArchived integer, isSubagent integer, recency integer, checkpointAt integer, value text);
`;

type Tool = { name: string; params?: object; rawArgs?: object };

/** A Cursor user folder (Cursor/User) with a live global database in WAL mode and two workspaces. */
async function cursorHome(root: string) {
  const user = join(root, "Cursor", "User");
  const globalDir = join(user, "globalStorage");
  await mkdir(globalDir, { recursive: true });
  const db = new DatabaseSync(join(globalDir, "state.vscdb"));
  db.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0;");
  db.exec(SCHEMA);
  const kv = db.prepare("insert into cursorDiskKV values (?, ?)");
  db.prepare("insert into ItemTable values ('cursorAuth/accessToken', 'secret-token')").run();

  const composer = (id: string, data: object) => kv.run(`composerData:${id}`, JSON.stringify({ _v: 16, composerId: id, text: "a draft that is never read", ...data }));
  let n = 0;
  const prompt = (chat: string, at: number, model?: string) =>
    kv.run(`bubbleId:${chat}:b${++n}`, JSON.stringify({ _v: 3, type: 1, bubbleId: `b${n}`, createdAt: iso(at), text: "a prompt that is never read", tokenCount: { inputTokens: 0, outputTokens: 0 }, ...(model ? { modelInfo: { modelName: model } } : {}) }));
  const reply = (chat: string, at: number, extra: { tokens?: [number, number]; ended?: number; tool?: Tool; model?: string } = {}) =>
    kv.run(
      `bubbleId:${chat}:b${++n}`,
      JSON.stringify({
        _v: 3,
        type: 2,
        bubbleId: `b${n}`,
        createdAt: iso(at),
        text: "a reply that is never read",
        tokenCount: { inputTokens: extra.tokens?.[0] ?? 0, outputTokens: extra.tokens?.[1] ?? 0 },
        ...(extra.ended ? { timingInfo: { clientStartTime: 190053667.5, clientRpcSendTime: at, clientEndTime: extra.ended } } : {}),
        ...(extra.model ? { modelInfo: { modelName: extra.model } } : {}),
        ...(extra.tool
          ? {
              toolFormerData: {
                tool: 1,
                name: extra.tool.name,
                status: "completed",
                params: extra.tool.params ? JSON.stringify(extra.tool.params) : undefined,
                rawArgs: extra.tool.rawArgs ? JSON.stringify(extra.tool.rawArgs) : undefined,
                result: JSON.stringify({ output: "secret output" }),
              },
            }
          : {}),
      }),
    );

  // A chat that names its folder. The prompt picks Auto, saved as "default".
  composer("chat-main", { createdAt: t0, workspaceIdentifier: { id: "ws-main", uri: { fsPath: "/home/dev/shop", scheme: "file" } }, modelConfig: { modelName: "default" } });
  prompt("chat-main", t0, "default");
  reply("chat-main", t0 + 5 * sec, { tokens: [1200, 300], ended: t0 + 40 * sec });
  reply("chat-main", t0 + 10 * sec, { tool: { name: "run_terminal_command_v2", params: { command: "cd src && rg -n todo .", cwd: "/home/dev/shop" } } });
  reply("chat-main", t0 + 15 * sec, { tool: { name: "edit_file_v2", params: { relativeWorkspacePath: "src/cart.ts", streamingContent: "secret code" } } });
  reply("chat-main", t0 + 20 * sec, { tool: { name: "apply_patch", rawArgs: { patch: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch" } } });
  reply("chat-main", t0 + 25 * sec, { tool: { name: "mcp_Linear_create_issue", params: { title: "x" } } });
  reply("chat-main", t0 + 30 * sec, { tool: { name: "todo_write", params: { todos: [] } } });
  reply("chat-main", t0 + 35 * sec, { tool: { name: "delete_file", params: { relativeWorkspacePath: "old.ts" } } });
  reply("chat-main", t0 + 38 * sec, { tool: { name: "read_file_v2", params: { targetFile: "/home/dev/shop/README.md" } } });
  prompt("chat-main", t0 + 2 * min, "gpt-5");
  reply("chat-main", t0 + 2 * min + 5 * sec, { tokens: [100, 10] });
  // A partial update and a broken row: neither is a message.
  kv.run("bubbleId:chat-main:frag", JSON.stringify({ checkpointId: "cp1" }));
  kv.run("bubbleId:chat-main:broken", "not json");

  // A subagent: its time and tokens go to the main chat, its prompt is the parent agent's.
  composer("chat-sub", { createdAt: t0 + 50 * sec, subagentInfo: { parentComposerId: "chat-main", subagentTypeName: "explore" }, modelConfig: { modelName: "composer-2" } });
  db.prepare("insert into composerHeaders (composerId, workspaceId, isSubagent) values ('chat-sub', 'ws-main', 1)").run();
  prompt("chat-sub", t0 + 50 * sec);
  reply("chat-sub", t0 + 55 * sec, { tokens: [50, 5], tool: { name: "read_file_v2", params: { targetFile: "/home/dev/shop/x.ts" } } });

  // An older chat that names no workspace: the workspace's own database lists it.
  composer("chat-old", { createdAt: t0 + 60 * min });
  prompt("chat-old", t0 + 60 * min);
  reply("chat-old", t0 + 60 * min + 30 * sec);

  // A newer chat whose workspace comes from composerHeaders.
  composer("chat-hdr", { createdAt: t0 + 3 * 60 * min });
  db.prepare("insert into composerHeaders (composerId, workspaceId, isSubagent) values ('chat-hdr', 'ws-new', 0)").run();
  prompt("chat-hdr", t0 + 3 * 60 * min);
  reply("chat-hdr", t0 + 3 * 60 * min + min);

  // A multi-root workspace: the first folder of its .code-workspace file.
  const workspaceFile = join(root, "team.code-workspace");
  await writeFile(workspaceFile, `{\n  // folders\n  "folders": [{ "path": "/home/dev/api" }, { "path": "web" },],\n  "settings": {}\n}`);
  composer("chat-multi", { createdAt: t0 + 4 * 60 * min, workspaceIdentifier: { id: "ws-multi", configPath: { fsPath: workspaceFile } } });
  prompt("chat-multi", t0 + 4 * 60 * min);
  reply("chat-multi", t0 + 4 * 60 * min + min);

  // Messages whose chat row is gone still count, in a chat of their own.
  prompt("chat-lost", t0 + 5 * 60 * min);
  reply("chat-lost", t0 + 5 * 60 * min + 20 * sec);

  const workspace = async (id: string, json: object, chats?: string[]) => {
    const dir = join(user, "workspaceStorage", id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workspace.json"), JSON.stringify(json));
    const ws = new DatabaseSync(join(dir, "state.vscdb"));
    ws.exec("create table ItemTable (key text unique on conflict replace, value blob)");
    if (chats) ws.prepare("insert into ItemTable values ('composer.composerData', ?)").run(JSON.stringify({ allComposers: chats.map((composerId) => ({ composerId, name: "never read" })) }));
    ws.close();
  };
  await workspace("ws-old", { folder: "file:///home/dev/blog" }, ["chat-old"]);
  await workspace("ws-new", { folder: "file:///home/dev/my%20app" });
  return { db, user, file: join(globalDir, "state.vscdb") };
}

async function tempDir(prefix: string) {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  delete process.env.CODEWRAPPED_SQLITE;
});

describe("cursor adapter", () => {
  it("reads a live database in place, the same with node:sqlite and sql.js", async () => {
    const home = await cursorHome(await tempDir("codewrapped-cur-"));
    open.push(home.db);
    const files = await ADAPTER.cursor.listFiles([join(home.user, "globalStorage")]);
    expect(files).toEqual([home.file]);
    // Every chat with messages but the subagent.
    expect(await ADAPTER.cursor.countSessions([], files)).toBe(5);
    const before = await stat(`${home.file}-wal`);
    expect(before.size).toBeGreaterThan(0);

    const native = await parseFiles({ files: { cursor: files }, timeZone: "UTC" });
    process.env.CODEWRAPPED_SQLITE = "sql.js";
    const wasm = await parseFiles({ files: { cursor: files }, timeZone: "UTC" });
    expect(wasm.aggregates).toEqual(native.aggregates);
    const after = await stat(`${home.file}-wal`);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    // The broken row is left out by SQLite and the partial update is not a message.
    expect(native.warnings.cursor).toMatchObject({ files: 1, badLines: 0, unknownEvents: {} });

    expect(native.aggregates).toHaveLength(1);
    const row = native.aggregates[0]!;
    expect(row.source).toBe("cursor");
    expect(row.sessions).toBe(5);
    expect(row.messages).toBe(6);
    // Main chat with its subagent (t0 to t0+2:05), then 0:30, 1:00, 1:00 and 0:20.
    expect(row.agentMinutes).toBeCloseTo(125 / 60 + 0.5 + 1 + 1 + 20 / 60, 2);
    expect(row.tokens).toEqual({ input: 1200 + 100 + 50, output: 300 + 10 + 5, cacheRead: 0, cacheWrite: 0 });
    expect(Object.fromEntries(Object.entries(row.models).map(([k, v]) => [k, v.tokens]))).toEqual({ auto: 1500, "gpt-5": 110, "composer-2": 55 });
    expect(row.tools).toEqual({
      run_terminal_command_v2: 1,
      edit_file_v2: 1,
      apply_patch: 1,
      mcp_Linear_create_issue: 1,
      todo_write: 1,
      delete_file: 1,
      read_file_v2: 2,
    });
    expect(row.toolCategories).toEqual({ search: 1, edit: 3, mcp: 1, plan: 1, read: 2 });
    expect(row.files).toEqual({ "cart.ts": 1, "a.ts": 1, "b.ts": 1 });
    expect(Object.keys(row.repos).sort()).toEqual(["api", "blog", "my app", "shop"]);
    expect(JSON.stringify(native)).not.toMatch(/secret|never read/);
  });

  it("counts a database found twice once", async () => {
    const home = await cursorHome(await tempDir("codewrapped-cur-dup-"));
    open.push(home.db);
    const once = await parseFiles({ files: { cursor: [home.file] }, timeZone: "UTC" });
    const twice = await parseFiles({ files: { cursor: await ADAPTER.cursor.listFiles([home.user, join(home.user, "globalStorage"), home.file]) }, timeZone: "UTC" });
    expect(twice.aggregates).toEqual(once.aggregates);
  });

  it("reports a database that is not Cursor's instead of throwing", async () => {
    const dir = await tempDir("codewrapped-cur-bad-");
    const other = new DatabaseSync(join(dir, "state.vscdb"));
    other.exec("create table notes (id text)");
    other.close();
    await writeFile(join(dir, "broken.vscdb"), "not a database");
    const { aggregates, warnings } = await parseFiles({ files: { cursor: [join(dir, "state.vscdb"), join(dir, "broken.vscdb")] }, timeZone: "UTC" });
    expect(aggregates).toEqual([]);
    expect(Object.keys(warnings.cursor.unknownEvents)).toEqual(["cursor:(not a Cursor state database)", expect.stringMatching(/^cursor:\(unreadable database/)]);
  });

  it("sorts Cursor's tool names", () => {
    expect(cursorToolCategory("mcp-gitnexus-impact", null)).toBe("mcp");
    expect(cursorToolCategory("run_terminal_cmd", "git grep -n x")).toBe("search");
    expect(cursorToolCategory("run_terminal_cmd", "pnpm test")).toBe("shell");
    expect(cursorToolCategory("ripgrep_raw_search", null)).toBe("search");
    expect(cursorToolCategory("task_v2", null)).toBe("subagent");
    expect(cursorToolCategory("ask_question", null)).toBe("other");
  });
});

describe("cursor discovery", () => {
  it("knows where Cursor keeps its data on each system", () => {
    expect(cursorAppDirs({}, "/h", "darwin")).toEqual(["/h/Library/Application Support/Cursor"]);
    expect(cursorAppDirs({ XDG_CONFIG_HOME: "/x" }, "/h", "linux")).toEqual(["/x/Cursor"]);
    expect(cursorAppDirs({}, "/h", "linux")).toEqual(["/h/.config/Cursor"]);
    expect(cursorAppDirs({ APPDATA: "C:\\Users\\d\\AppData\\Roaming" }, "/h", "win32")[0]).toMatch(/Roaming[\\/]Cursor$/);
  });

  it("finds the default folder and lets --cursor-dir name the app folder, User, globalStorage or the file", async () => {
    const home = await tempDir("codewrapped-cur-home-");
    const app = cursorAppDirs({}, home)[0]!;
    const globalDir = join(app, "User", "globalStorage");
    await mkdir(globalDir, { recursive: true });
    const db = new DatabaseSync(join(globalDir, "state.vscdb"));
    db.exec(SCHEMA);
    db.close();
    const file = join(globalDir, "state.vscdb");

    expect((await findLogFolders({}, home)).dirs.cursor).toEqual([globalDir]);
    for (const flag of [app, join(app, "User"), globalDir, file]) {
      const f = await findLogFolders({}, home, { dirs: { cursor: [flag] } });
      expect(await ADAPTER.cursor.listFiles(f.dirs.cursor)).toEqual([file]);
    }
    expect(await ADAPTER.cursor.looksLike(app)).toBe(true);
    expect(await ADAPTER.cursor.looksLike(home)).toBe(false);
  });
});
