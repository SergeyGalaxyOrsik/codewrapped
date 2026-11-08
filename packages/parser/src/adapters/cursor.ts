import { open, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellCategory, toolCategory, type ToolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { isDir, isFile } from "../files";
import { countUnknown, type ParseWarnings } from "../lines";
import { openInPlace, type Row, type SqliteSnapshot } from "../sqlite";
import { patchFiles } from "./codex";

/**
 * Cursor's agent chats, from the editor. Cursor keeps them in the VS Code
 * state database of its user folder, User/globalStorage/state.vscdb, in the
 * key-value table cursorDiskKV:
 *
 * - composerData:<chat id>: one chat (a "composer"). Its workspace, its
 *   parent chat for a subagent, the model picked for it.
 * - bubbleId:<chat id>:<bubble id>: one message. type 1 is a prompt, type 2
 *   a piece of the reply: text, thinking or one tool call (toolFormerData).
 *   Every bubble has createdAt; a reply's first bubble has timingInfo with
 *   the time it ended.
 *
 * Checked on Cursor's own files from September 2025 to July 2026. Token
 * counts (tokenCount) are kept only on some bubbles and only until early
 * 2026; later bubbles have zeros there, so newer chats count time, prompts
 * and tools but no tokens. Cursor writes no cost. Its "Auto" model is
 * saved as "default" and shown as "auto".
 *
 * The chat's folder comes from workspaceIdentifier, else from the workspace
 * that lists the chat: composerHeaders.workspaceId (newer versions) or
 * composer.composerData in that workspace's own state.vscdb (older ones),
 * then that workspace's workspace.json. A multi-root workspace uses the
 * chat's first tracked git repository, else the first folder of the
 * .code-workspace file.
 *
 * The database is gigabytes, so it is opened read-only where it is, not
 * copied. Only cursorDiskKV rows with the two prefixes above and
 * composerHeaders are read, and only the fields below; message text, code
 * and tool output never leave SQLite. ItemTable, which holds Cursor's login
 * tokens, is never queried in the global database. The cursor-agent CLI
 * (~/.cursor/chats) keeps no times per message and is not read.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

const DB_NAME = "state.vscdb";
const SUBDIRS = [join("User", "globalStorage")];

/** An ISO date or epoch ms, as Cursor has written both. */
function time(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 1e12 ? v : null;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const j = (path: string) => `json_extract(value, '$.${path}')`;
/** A field of a JSON string inside the value, or null when that string is not JSON. */
const inner = (col: string, path: string) => `case when json_valid(${col}) then json_extract(${col}, '$.${path}') end`;

const COMPOSER_SQL = `select substr(key, 14) as id, ${j("createdAt")} as created,
  ${j("workspaceIdentifier.id")} as ws, ${j("workspaceIdentifier.uri.fsPath")} as folder,
  ${j("workspaceIdentifier.configPath.fsPath")} as config, ${j("subagentInfo.parentComposerId")} as parent,
  ${j("modelConfig.modelName")} as model, ${j("trackedGitRepos[0].repoPath")} as git
  from cursorDiskKV where key >= 'composerData:' and key < 'composerData;' and json_valid(value)`;
// Chat ids from the keys alone: the index answers this without reading a value.
const CHAT_IDS_SQL = `select distinct substr(key, 10, instr(substr(key, 10), ':') - 1) as id
  from cursorDiskKV where key >= 'bubbleId:' and key < 'bubbleId;'`;
// Tool arguments hold code and file contents: only the command, the target path and a patch (for its file headers) are taken out.
const BUBBLE_SQL = `select key, type, created, ended, input, output, model, tool,
  ${inner("params", "command")} as command, ${inner("raw", "command")} as raw_command,
  coalesce(${inner("params", "relativeWorkspacePath")}, ${inner("raw", "file_path")}, ${inner("raw", "target_file")}, ${inner("raw", "path")}) as file,
  ${inner("raw", "patch")} as patch
  from (select key, ${j("type")} as type, ${j("createdAt")} as created, ${j("timingInfo.clientEndTime")} as ended,
    ${j("tokenCount.inputTokens")} as input, ${j("tokenCount.outputTokens")} as output, ${j("modelInfo.modelName")} as model,
    ${j("toolFormerData.name")} as tool, ${j("toolFormerData.params")} as params, ${j("toolFormerData.rawArgs")} as raw
    from cursorDiskKV where key >= ? and key < ? and json_valid(value))`;

type Composer = { id: string; created: number; ws: string | null; folder: string | null; config: string | null; parent: string | null; model: string | null; git: string | null };
type Bubble = { key: string; type: number; t: number; ended: number | null; input: number; output: number; model: string | null; tool: string | null; command: string | null; file: string | null; patch: string | null };

/** Tools that change files, besides the shared edit names. delete_file changes one but edits none. */
const NOT_AN_EDIT = new Set(["delete_file"]);

/** Cursor names MCP tools mcp_<server>_<tool> or mcp-<server>-<tool>. Shell commands are sorted by their first program. */
export function cursorToolCategory(name: string, command: string | null): ToolCategory {
  const n = name.toLowerCase();
  if (/^mcp[-_]/.test(n) || n === "fetch_mcp_resource") return "mcp";
  const category = toolCategory(n);
  return category === "shell" ? shellCategory(command) : category;
}

/** Cursor saves its Auto model as "default". */
const modelName = (m: string | null) => (m === "default" ? "auto" : m);

function tableNames(db: SqliteSnapshot): Set<string> {
  return new Set(db.all("select name from sqlite_master where type = 'table'").map((r) => String(r.name)));
}

function toComposer(r: Row): Composer | null {
  const id = str(r.id);
  if (!id) return null;
  return { id, created: time(r.created) ?? 0, ws: str(r.ws), folder: str(r.folder), config: str(r.config), parent: str(r.parent), model: str(r.model), git: str(r.git) };
}

function toBubble(r: Row, warnings: ParseWarnings): Bubble | null {
  // Rows without a type are partial updates (a checkpoint id, a token count alone), not messages.
  if (typeof r.type !== "number") return null;
  warnings.lines += 1;
  const type = r.type;
  const t = time(r.created);
  if (t === null) {
    warnings.badLines += 1;
    return null;
  }
  return {
    key: String(r.key),
    type,
    t,
    ended: time(r.ended),
    input: num(r.input),
    output: num(r.output),
    model: str(r.model),
    tool: str(r.tool),
    command: str(r.command) ?? str(r.raw_command),
    file: str(r.file),
    patch: str(r.patch),
  };
}

/** A path from a file: URI, or the path part of a remote one (vscode-remote://ssh-remote+host/home/x). */
export function uriPath(uri: string): string | null {
  try {
    const u = new URL(uri);
    if (u.protocol === "file:") return fileURLToPath(u);
    return u.pathname ? decodeURIComponent(u.pathname) : null;
  } catch {
    return null;
  }
}

/** The first folder of a .code-workspace file, which is JSON with comments. Only that entry is used. */
async function codeWorkspaceFolder(file: string): Promise<string | null> {
  try {
    const text = (await readFile(file, "utf8")).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1");
    const first = obj((obj(JSON.parse(text))?.folders as unknown[] | undefined)?.[0]);
    const path = str(first?.path);
    if (path) return isAbsolute(path) ? path : resolve(dirname(file), path);
    const uri = str(first?.uri);
    return uri ? uriPath(uri) : null;
  } catch {
    return null;
  }
}

type Workspace = { folder: string | null; config: string | null };

/** workspace.json of one workspace folder: a folder URI, or a .code-workspace file for a multi-root one. */
async function readWorkspace(dir: string): Promise<Workspace | null> {
  try {
    const w = obj(JSON.parse(await readFile(join(dir, "workspace.json"), "utf8")));
    const folder = str(w?.folder);
    const config = str(w?.workspace);
    return { folder: folder ? uriPath(folder) : null, config: config ? uriPath(config) : null };
  } catch {
    return null;
  }
}

/** Chat ids that older Cursor versions listed in a workspace's own state database. Only that one key is read. */
async function workspaceChats(dir: string): Promise<string[]> {
  const file = join(dir, DB_NAME);
  if (!(await isFile(file))) return [];
  try {
    const db = await openInPlace(file);
    try {
      const [row] = db.all("select value from ItemTable where key = 'composer.composerData'");
      const all = obj(JSON.parse(String(row?.value ?? "null")))?.allComposers;
      return Array.isArray(all) ? all.flatMap((c) => str(obj(c)?.composerId) ?? []) : [];
    } finally {
      await db.close();
    }
  } catch {
    return [];
  }
}

/** The folder each chat ran in, as far as Cursor recorded it. */
async function chatFolders(composers: Map<string, Composer>, headers: Map<string, string>, chats: readonly string[], workspaceRoot: string): Promise<Map<string, string>> {
  const wsOf = new Map<string, string>();
  for (const id of chats) {
    const ws = composers.get(id)?.ws ?? headers.get(id);
    if (ws) wsOf.set(id, ws);
  }
  const needed = chats.filter((id) => !composers.get(id)?.folder);
  const dirs = needed.length > 0 && (await isDir(workspaceRoot)) ? await readdir(workspaceRoot) : [];
  // Older chats name no workspace; the workspace's own database lists them.
  if (needed.some((id) => !wsOf.has(id))) {
    for (const ws of dirs) for (const id of await workspaceChats(join(workspaceRoot, ws))) if (!wsOf.has(id)) wsOf.set(id, ws);
  }
  const workspaces = new Map<string, Workspace | null>();
  const out = new Map<string, string>();
  for (const id of chats) {
    const c = composers.get(id);
    let folder = c?.folder ?? null;
    let config = c?.config ?? null;
    const ws = wsOf.get(id);
    if (!folder && !config && ws && dirs.includes(ws)) {
      if (!workspaces.has(ws)) workspaces.set(ws, await readWorkspace(join(workspaceRoot, ws)));
      folder = workspaces.get(ws)?.folder ?? null;
      config = workspaces.get(ws)?.config ?? null;
    }
    const cwd = folder ?? c?.git ?? (config ? await codeWorkspaceFolder(config) : null);
    if (cwd) out.set(id, cwd);
  }
  return out;
}

type Seen = { chats: Set<string> };

async function readDatabase(file: string, emit: Emit, warnings: ParseWarnings, seen: Seen): Promise<void> {
  const db = await openInPlace(file);
  try {
    const tables = tableNames(db);
    if (!tables.has("cursorDiskKV")) {
      countUnknown(warnings, "cursor:(not a Cursor state database)");
      return;
    }
    const composers = new Map<string, Composer>();
    for (const r of db.all(COMPOSER_SQL)) {
      const c = toComposer(r);
      if (c) composers.set(c.id, c);
    }
    const headers = new Map<string, string>();
    if (tables.has("composerHeaders")) {
      for (const r of db.all("select composerId, workspaceId from composerHeaders")) {
        const id = str(r.composerId);
        const ws = str(r.workspaceId);
        if (id && ws) headers.set(id, ws);
      }
    }
    // The same chat in a second copy of the database counts once.
    const chats = db
      .all(CHAT_IDS_SQL)
      .flatMap((r) => str(r.id) ?? [])
      .filter((id) => !seen.chats.has(id))
      .sort((a, b) => (composers.get(a)?.created ?? 0) - (composers.get(b)?.created ?? 0) || a.localeCompare(b));
    const folders = await chatFolders(composers, headers, chats, join(dirname(dirname(file)), "workspaceStorage"));

    for (const session of chats) {
      seen.chats.add(session);
      const c = composers.get(session);
      const cwd = folders.get(session) ?? null;
      emit({ type: "session", session, parent: c?.parent ?? null });
      const bubbles = db
        .all(BUBBLE_SQL, `bubbleId:${session}:`, `bubbleId:${session};`)
        .flatMap((r) => toBubble(r, warnings) ?? [])
        .sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
      let model = modelName(c?.model ?? null);
      for (const b of bubbles) {
        if (b.type === 1) {
          // The model is picked per prompt and applies to the reply after it.
          model = modelName(b.model) ?? model;
          emit({ type: "tick", session, t: b.t, cwd, active: true });
          emit({ type: "prompt", session, t: b.t });
          continue;
        }
        if (b.type !== 2) {
          countUnknown(warnings, `cursor:bubble type ${b.type}`);
          continue;
        }
        emit({ type: "tick", session, t: b.t, cwd, active: true });
        if (b.ended !== null && b.ended > b.t) emit({ type: "tick", session, t: b.ended, cwd });
        if (b.input + b.output > 0) {
          const usage = { input: b.input, output: b.output, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 };
          emit({ type: "usage", session, t: b.ended ?? b.t, model: modelName(b.model) ?? model ?? "unknown", usage, costUsd: null, cwd });
        }
        if (!b.tool) continue;
        const category = cursorToolCategory(b.tool, b.command);
        emit({ type: "tool", session, t: b.t, name: b.tool, category });
        if (category !== "edit" || NOT_AN_EDIT.has(b.tool)) continue;
        if (b.file) emit({ type: "edit", session, t: b.t, file: basename(b.file) });
        else if (b.patch) for (const f of patchFiles(b.patch)) emit({ type: "edit", session, t: b.t, file: basename(f) });
      }
    }
  } finally {
    await db.close();
  }
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const seen: Seen = { chats: new Set() };
  for (const f of files) {
    warnings.files += 1;
    try {
      await readDatabase(f, emit, warnings, seen);
    } catch (e) {
      countUnknown(warnings, `cursor:(unreadable database: ${String((e as Error)?.message ?? e).slice(0, 120)})`);
    }
  }
}

/**
 * The global state database for each given path: the path itself when it
 * is a file, else state.vscdb in it, in globalStorage/ or in
 * User/globalStorage/. state.vscdb.backup next to it is left out.
 */
async function listFiles(dirs: readonly string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const d of dirs) {
    const options = (await isFile(d)) ? [d] : [join(d, DB_NAME), join(d, "globalStorage", DB_NAME), join(d, "User", "globalStorage", DB_NAME)];
    for (const p of options) {
      if (await isFile(p)) {
        out.add(await realpath(p));
        break;
      }
    }
  }
  return [...out].sort();
}

/** Chats with messages that are not subagents. Reads keys and composerHeaders only. */
async function countSessions(_dirs: readonly string[], files: readonly string[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    try {
      const db = await openInPlace(f);
      try {
        const tables = tableNames(db);
        if (!tables.has("cursorDiskKV")) continue;
        const chats = new Set(db.all(CHAT_IDS_SQL).flatMap((r) => str(r.id) ?? []));
        if (tables.has("composerHeaders")) for (const r of db.all("select composerId from composerHeaders where isSubagent = 1")) chats.delete(String(r.composerId));
        n += chats.size;
      } finally {
        await db.close();
      }
    } catch {
      // Counted as zero; parsing reports the unreadable database.
    }
  }
  return n;
}

async function isSqliteFile(p: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(p, "r");
    const buf = Buffer.alloc(16);
    await handle.read(buf, 0, 16, 0);
    return buf.toString("latin1") === "SQLite format 3\0";
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** Cursor's app folder, its User or globalStorage folder, or state.vscdb itself. */
export async function looksLikeCursorHome(root: string): Promise<boolean> {
  const [file] = await listFiles([root]);
  return file !== undefined && (await isSqliteFile(file));
}

/** Where Cursor keeps its user data on each system. A --user-data-dir elsewhere needs --cursor-dir. */
export function cursorAppDirs(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Cursor")];
  if (platform === "win32") return env.APPDATA ? [join(env.APPDATA, "Cursor")] : [join(home, "AppData", "Roaming", "Cursor")];
  const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
  return [join(config, "Cursor")];
}

function discover(ctx: DiscoverContext): Candidate[] {
  const folder = (root: string, via: Candidate["via"]): Candidate => ({ root, dirs: SUBDIRS.map((s) => join(root, s)), via, verify: false });
  return [...cursorAppDirs(ctx.env, ctx.home).map((r) => folder(r, "default")), ...ctx.saved.map((r) => folder(resolve(r), "saved"))];
}

export const cursor: Adapter = {
  id: "cursor",
  shellVars: [],
  subdirs: SUBDIRS,
  dbFile: true,
  discover,
  looksLike: looksLikeCursorHome,
  listFiles,
  countSessions,
  parse,
};
