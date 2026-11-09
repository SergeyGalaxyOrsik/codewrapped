import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cursorAppDirs } from "@codewrapped/parser";
import { SOURCES } from "@codewrapped/stats";
import { afterAll, describe, expect, it } from "vitest";

const CLI = join(__dirname, "../dist/index.js");
const GUARD = join(__dirname, "net-guard.mjs");
const FIXTURES = join(__dirname, "../../../packages/parser/fixtures");

/** A HOME with logs of every harness, from the parser fixtures and two small databases. */
function buildHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cw-nonet-"));
  const copy = (from: string, to: string) => cpSync(join(FIXTURES, from), join(home, to), { recursive: true });
  copy("claude/projects", ".claude/projects");
  copy("claude-sdk/projects", ".claude/projects");
  copy("codex/sessions", ".codex/sessions");
  copy("codex-exec/sessions", ".codex/sessions");
  copy("pi/sessions", ".pi/agent/sessions");
  copy("omp/sessions", ".omp/agent/sessions");
  copy("opencode/storage", ".local/share/opencode/storage");

  // An opencode database too, so the copy-and-open path runs.
  const opencode = new DatabaseSync(join(home, ".local/share/opencode/opencode.db"));
  opencode.exec(`create table session (id text primary key, parent_id text, directory text, time_created integer, version text, permission text);
    create table message (id text primary key, session_id text, data text);
    create table part (id text primary key, message_id text, session_id text, data text);`);
  opencode.close();

  const t0 = Date.parse("2026-11-06T10:00:00Z");
  mkdirSync(join(home, ".zcode/cli/db"), { recursive: true });
  const zcode = new DatabaseSync(join(home, ".zcode/cli/db/db.sqlite"));
  zcode.exec(`create table session (id text primary key, project_id text not null, workspace_id text, parent_id text, slug text not null,
      directory text not null, path text, title text not null, version text not null, permission text,
      time_created integer not null, time_updated integer not null, time_archived integer,
      task_type text not null default 'interactive', time_deleted integer, last_outcome text);
    create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null, sequence integer);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null, sequence integer);`);
  zcode
    .prepare("insert into session (id, project_id, slug, directory, title, version, time_created, time_updated) values ('ses_1', 'prj', 's', '/home/dev/shop', 't', '3.17.2', ?, ?)")
    .run(t0, t0);
  const real = { origin: "real_user", kind: "user_prompt", uiVisibility: "visible", providerVisibility: "visible", transcriptVisibility: "visible" };
  const message = zcode.prepare("insert into message values (?, 'ses_1', ?, ?, ?, null)");
  message.run("m1", t0, t0, JSON.stringify({ role: "user", time: { created: t0 }, semantics: real }));
  const tokens = { input: 500, output: 30, reasoning: 0, cache: { read: 0, write: 0 } };
  const done = { created: t0 + 20_000, completed: t0 + 50_000 };
  message.run("m2", done.created, done.created, JSON.stringify({ role: "assistant", time: done, modelId: "GLM-5.3", providerId: "zai", path: { cwd: "/home/dev/shop", root: "/home/dev/shop" }, cost: 0, tokens }));
  zcode.close();

  const globalStorage = join(cursorAppDirs({}, home)[0]!, "User", "globalStorage");
  mkdirSync(globalStorage, { recursive: true });
  const cursor = new DatabaseSync(join(globalStorage, "state.vscdb"));
  cursor.exec("create table ItemTable (key text unique on conflict replace, value blob); create table cursorDiskKV (key text unique on conflict replace, value blob);");
  const kv = cursor.prepare("insert into cursorDiskKV values (?, ?)");
  const t1 = Date.parse("2026-11-07T10:00:00Z");
  const at = (ms: number) => new Date(ms).toISOString();
  kv.run("composerData:chat-1", JSON.stringify({ _v: 16, composerId: "chat-1", createdAt: t1, modelConfig: { modelName: "gpt-5" } }));
  kv.run("bubbleId:chat-1:b1", JSON.stringify({ _v: 3, type: 1, bubbleId: "b1", createdAt: at(t1), tokenCount: { inputTokens: 0, outputTokens: 0 } }));
  kv.run("bubbleId:chat-1:b2", JSON.stringify({ _v: 3, type: 2, bubbleId: "b2", createdAt: at(t1 + 60_000), tokenCount: { inputTokens: 100, outputTokens: 10 }, modelInfo: { modelName: "gpt-5" } }));
  cursor.close();
  return home;
}

const home = buildHome();
afterAll(() => rmSync(home, { recursive: true, force: true }));

function run(args: string[]) {
  const log = join(home, `net-${args.join("_") || "default"}.log`);
  writeFileSync(log, "");
  const r = spawnSync(process.execPath, ["--import", GUARD, CLI, "--period", "all", ...args], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir(), NET_LOG: log, CODEWRAPPED_API_URL: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  return { ...r, attempts: readFileSync(log, "utf8") };
}

describe("the built CLI", () => {
  it("exists, so this suite never passes without running it", () => {
    expect(existsSync(CLI), `${CLI} is missing. Run pnpm build first.`).toBe(true);
  });

  it("reads logs of every harness", () => {
    const r = run(["--json"]);
    expect(r.status, r.stderr).toBe(0);
    const { summary } = JSON.parse(r.stdout);
    for (const s of SOURCES) expect(summary.bySource[s].sessions, `${s} sessions`).toBeGreaterThan(0);
  });

  it.each([[[]], [["--json"]], [["sync", "--dry-run"]]])("makes no network requests: codewrapped %j", (args: string[]) => {
    const r = run(args);
    expect(r.attempts, r.stderr).toBe("");
    expect(r.status, r.stderr).toBe(0);
  });
});
