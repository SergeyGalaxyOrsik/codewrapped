import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { shellCategory, toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { isDir } from "../files";
import { countUnknown, type ParseWarnings } from "../lines";
import { openSnapshot } from "../sqlite";
import { patchFiles } from "./codex";

/**
 * opencode keeps sessions in $XDG_DATA_HOME/opencode/opencode.db (SQLite since
 * 1.2.0, checked on 1.17 and 1.19 logs). Versions 0.6 to 1.1 wrote JSON files:
 * storage/session/<projectID>/<sessionID>.json, storage/message/<sessionID>/
 * <messageID>.json and storage/part/<messageID>/<partID>.json. The move to
 * SQLite copied them and left the files in place, so ids are deduplicated and
 * the database wins. The JSON path follows the source code and is untested on
 * real files.
 *
 * opencode 2.x adds session_message, which is not read yet: its rows are
 * reported as unknown so a user can tell.
 *
 * The database is copied with its -wal and -shm files and the copy is opened
 * read-only. Only the session, message and part tables are read; account and
 * credential tables are never touched.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

type SessionInfo = {
  id: string;
  parent: string | null;
  directory: string | null;
  created: number;
  /** opencode version that wrote the session, e.g. "1.19.5". */
  version: string | null;
  /** Started by `opencode run`, judged from the permissions it sets. */
  automated: boolean;
};

/** "1.3.16" -> [1, 3, 16]. */
const versionParts = (v: string | null) => (v ?? "0").split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
function atLeast(v: string | null, min: [number, number, number]): boolean {
  const p = versionParts(v);
  for (let i = 0; i < 3; i++) if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i]!;
  return true;
}

/**
 * `opencode run` denies the question tool and plan mode for its session, since
 * nobody is there to answer. The TUI does not. Checked against the opencode
 * source from 1.1 to 1.19; a heuristic, not a flag.
 */
function looksLikeRun(permission: unknown): boolean {
  let rules: unknown = permission;
  if (typeof permission === "string") {
    try {
      rules = JSON.parse(permission);
    } catch {
      return false;
    }
  }
  if (!Array.isArray(rules)) return false;
  const denied = new Set(rules.map(obj).filter((r) => r?.action === "deny" && r.pattern === "*").map((r) => r!.permission));
  return denied.has("question") && denied.has("plan_enter") && denied.has("plan_exit");
}
type MessageInfo = { id: string; session: string; data: Obj };
type PartInfo = { id: string; message: string; session: string; data: Obj };

type Store = {
  sessions: Map<string, SessionInfo>;
  messages: Map<string, MessageInfo>;
  parts: Map<string, PartInfo>;
};

/** Database files: opencode.db, and per-channel opencode-<channel>.db. */
const DB_FILE = /^opencode(?:-[\w.-]+)?\.db$/;
const STORAGE_KINDS = ["session", "message", "part"];

/** Adds a row unless one with the same id came from an earlier file: the database wins over legacy JSON. */
function put<T>(map: Map<string, T>, id: string, value: T): void {
  if (!map.has(id)) map.set(id, value);
}

function parseData(raw: unknown, warnings: ParseWarnings): Obj | null {
  try {
    return obj(JSON.parse(String(raw)));
  } catch {
    warnings.badLines += 1;
    return null;
  }
}

async function readDatabase(file: string, store: Store, warnings: ParseWarnings): Promise<void> {
  const db = await openSnapshot(file);
  try {
    for (const r of db.all("select id, parent_id, directory, time_created, version, permission from session")) {
      warnings.lines += 1;
      const id = str(r.id);
      if (!id) continue;
      put(store.sessions, id, {
        id,
        parent: str(r.parent_id),
        directory: str(r.directory),
        created: num(r.time_created),
        version: str(r.version),
        automated: looksLikeRun(r.permission),
      });
    }
    const tables = new Set(db.all("select name from sqlite_master where type = 'table'").map((r) => r.name));
    if (tables.has("session_message")) {
      const n = num(db.all("select count(*) as n from session_message")[0]?.n);
      if (n > 0) warnings.unknownEvents["opencode:(2.x session_message rows, not read yet)"] = n;
    }
    for (const r of db.all("select id, session_id, data from message")) {
      warnings.lines += 1;
      const id = str(r.id);
      const session = str(r.session_id);
      const data = parseData(r.data, warnings);
      if (id && session && data) put(store.messages, id, { id, session, data });
    }
    for (const r of db.all("select id, message_id, session_id, data from part")) {
      warnings.lines += 1;
      const id = str(r.id);
      const message = str(r.message_id);
      const session = str(r.session_id);
      const data = parseData(r.data, warnings);
      if (id && message && session && data) put(store.parts, id, { id, message, session, data });
    }
  } finally {
    await db.close();
  }
}

/** One legacy JSON file. Its kind comes from its content, so layout changes between versions do not matter. */
async function readJsonFile(file: string, store: Store, warnings: ParseWarnings): Promise<void> {
  warnings.lines += 1;
  let d: Obj | null;
  try {
    d = obj(JSON.parse(await readFile(file, "utf8")));
  } catch {
    warnings.badLines += 1;
    return;
  }
  const id = str(d?.id);
  if (!d || !id) return;
  const session = str(d.sessionID);
  const message = str(d.messageID);
  if (message && session && typeof d.type === "string") put(store.parts, id, { id, message, session, data: d });
  else if (session && typeof d.role === "string") put(store.messages, id, { id, session, data: d });
  else if (id.startsWith("ses") || typeof d.directory === "string") {
    put(store.sessions, id, {
      id,
      parent: str(d.parentID),
      directory: str(d.directory),
      created: num(obj(d.time)?.created),
      version: str(d.version),
      automated: looksLikeRun(d.permission),
    });
  } else countUnknown(warnings, "opencode:(unknown json)");
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const store: Store = { sessions: new Map(), messages: new Map(), parts: new Map() };
  // Databases first, so their rows win over the same ids in legacy JSON.
  const dbs = files.filter((f) => DB_FILE.test(basename(f)));
  for (const f of dbs) {
    warnings.files += 1;
    try {
      await readDatabase(f, store, warnings);
    } catch (e) {
      countUnknown(warnings, `opencode:(unreadable database: ${String((e as Error)?.message ?? e).slice(0, 120)})`);
    }
  }
  for (const f of files) {
    if (dbs.includes(f)) continue;
    warnings.files += 1;
    await readJsonFile(f, store, warnings);
  }

  const partsOf = new Map<string, PartInfo[]>();
  for (const p of store.parts.values()) {
    const list = partsOf.get(p.message) ?? [];
    list.push(p);
    partsOf.set(p.message, list);
  }
  const messagesOf = new Map<string, MessageInfo[]>();
  for (const m of store.messages.values()) {
    const list = messagesOf.get(m.session) ?? [];
    list.push(m);
    messagesOf.set(m.session, list);
  }
  const created = (m: MessageInfo) => time(obj(m.data.time)?.created) ?? 0;

  // Sessions whose messages exist but whose session row is gone still count, without a folder.
  const sessionIds = [...new Set([...store.sessions.keys(), ...messagesOf.keys()])];
  const sessions = sessionIds
    .map((id) => store.sessions.get(id) ?? { id, parent: null, directory: null, created: 0, version: null, automated: false })
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));

  for (const s of sessions) {
    const session = s.id;
    // Subagent sessions (the task tool) have a parent; their time and tokens go to the root session.
    emit({ type: "session", session, parent: s.parent, automated: s.automated });
    // From 1.3.16 reasoning is reported apart from output; before, output already held it.
    const reasoningApart = atLeast(s.version, [1, 3, 16]);
    const messages = (messagesOf.get(session) ?? []).sort((a, b) => created(a) - created(b) || a.id.localeCompare(b.id));
    for (const m of messages) {
      const d = m.data;
      const t = created(m) || null;
      const done = time(obj(d.time)?.completed);
      const cwd = str(obj(d.path)?.cwd) ?? s.directory;
      if (d.role === "user") {
        if (t === null) continue;
        emit({ type: "tick", session, t, cwd, active: true });
        emit({ type: "prompt", session, t });
        continue;
      }
      if (d.role !== "assistant") {
        countUnknown(warnings, `opencode:role ${String(d.role)}`);
        continue;
      }
      if (t !== null) emit({ type: "tick", session, t, cwd, active: true });
      if (done !== null) emit({ type: "tick", session, t: done, cwd });

      // A message's tokens are its last step only, so steps are summed; cost is summed by opencode already.
      const steps = (partsOf.get(m.id) ?? []).filter((p) => p.data.type === "step-finish").map((p) => obj(p.data.tokens));
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 };
      for (const tokens of steps.length > 0 ? steps : [obj(d.tokens)]) {
        const cache = obj(tokens?.cache);
        usage.input += num(tokens?.input);
        usage.output += num(tokens?.output) + (reasoningApart ? num(tokens?.reasoning) : 0);
        usage.cacheRead += num(cache?.read);
        usage.cacheWrite += num(cache?.write);
      }
      const at = done ?? t;
      if (at !== null && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) {
        const model = str(d.modelID) ?? "unknown";
        emit({ type: "usage", session, t: at, model, usage, costUsd: typeof d.cost === "number" ? d.cost : null, cwd });
      }

      for (const p of (partsOf.get(m.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
        if (p.data.type !== "tool") continue;
        const name = str(p.data.tool);
        if (!name) continue;
        const state = obj(p.data.state);
        const started = time(obj(state?.time)?.start) ?? at;
        if (started === null) continue;
        const ended = time(obj(state?.time)?.end);
        const input = obj(state?.input);
        const category = name === "bash" ? shellCategory(str(input?.command)) : toolCategory(name);
        emit({ type: "tick", session, t: started, cwd });
        emit({ type: "tool", session, t: started, name, category });
        if (ended !== null) emit({ type: "tick", session, t: ended, cwd });
        const path = str(input?.filePath);
        if (path && category === "edit") emit({ type: "edit", session, t: started, file: basename(path) });
        const patch = str(input?.patchText);
        if (patch) for (const f of patchFiles(patch)) emit({ type: "edit", session, t: started, file: basename(f) });
      }
    }
  }
}

/** Database files and legacy JSON files of one opencode data folder. */
async function listFiles(dirs: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
    }
  };
  for (const dir of dirs) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && DB_FILE.test(e.name)) out.push(join(dir, e.name));
    }
    for (const kind of STORAGE_KINDS) await walk(join(dir, "storage", kind));
  }
  return [...new Set(out)].sort();
}

/** Root sessions: rows in each database plus legacy session files. */
async function countSessions(_dirs: readonly string[], files: readonly string[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (DB_FILE.test(basename(f))) {
      try {
        const db = await openSnapshot(f);
        try {
          n += num(db.all("select count(*) as n from session where parent_id is null")[0]?.n);
        } finally {
          await db.close();
        }
      } catch {
        // Counted as zero; parsing reports the unreadable database.
      }
    } else if (/[\\/]storage[\\/]session[\\/]/.test(f) && basename(f).startsWith("ses")) n += 1;
  }
  return n;
}

export async function looksLikeOpencodeHome(root: string): Promise<boolean> {
  return (await readdir(root).catch(() => [])).some((f) => DB_FILE.test(f)) || (await isDir(join(root, "storage", "session")));
}

/** $XDG_DATA_HOME/opencode, else ~/.local/share/opencode, and saved folders. */
function discover(ctx: DiscoverContext): Candidate[] {
  const at = (root: string, via: Candidate["via"]): Candidate => ({ root, dirs: [resolve(root)], via, verify: false });
  const xdg = ctx.env.XDG_DATA_HOME?.trim();
  return [
    ...(xdg ? [at(join(xdg, "opencode"), "env")] : []),
    at(join(ctx.home, ".local", "share", "opencode"), "default"),
    ...ctx.saved.map((r) => at(r, "saved")),
  ];
}

export const opencode: Adapter = {
  id: "opencode",
  shellVars: [],
  subdirs: [],
  discover,
  looksLike: looksLikeOpencodeHome,
  listFiles,
  countSessions,
  parse,
};
