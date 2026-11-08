import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { shellCategory, toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { isDir, isFile } from "../files";
import { countUnknown, type ParseWarnings } from "../lines";
import { openSnapshot, type Row, type SqliteSnapshot } from "../sqlite";
import { patchFiles } from "./codex";

/**
 * ZCode (github.com/zai-org/ZCode) keeps every agent session, from the CLI and
 * from the desktop app, in one SQLite file: ~/.zcode/cli/db/db.sqlite, moved
 * with ZCODE_SESSION_DB_PATH (or ZCODE_SESSION_DB) or storage.sessionDbPath in
 * ~/.zcode/cli/config.json. Written from the ZCode 3.17.2 source (schema up to
 * migration 0023); not checked on real logs yet.
 *
 * The tables follow opencode's layout: session, message (one row per prompt
 * and per model step), part (tool calls, step-finish). Differences that matter:
 *
 * - tokens.input is the whole prompt, cache reads and writes included (AI SDK
 *   v6 normalization), and output already holds reasoning. Cache is
 *   subtracted from input here. ZCode writes cost 0, so prices come from the
 *   price table.
 * - A fork, a side chat and a stable fork copy the parent's messages with new
 *   ids and the original timestamps, marked with metadata.forkOrigin. Copies
 *   are skipped, so each request counts once.
 * - Subagent, workflow and side chat sessions name their parent in parent_id
 *   or session_task_link; their time and tokens go to the root session. A
 *   fork is a task of its own even though it has a parent_id too.
 * - Runtime-injected user messages (reminders, background task results) carry
 *   semantics.origin other than real_user and are not prompts.
 *
 * model_usage is ZCode's own per-request ledger, but it is pruned after 30
 * days, so the transcript is read instead. Title generation calls, which only
 * model_usage records, are left out.
 *
 * ZCode records no marker for `zcode --prompt` runs, so every session counts
 * as interactive. Legacy ACP-era snapshots in ~/.zcode/v2/sessions (which
 * also hold imported Claude Code sessions) are not read.
 *
 * The database is copied with its -wal and -shm files and the copy is opened
 * read-only. Only session, message, part and session_task_link are read, and
 * from message and part only the fields below; prompts, replies and tool
 * output never leave SQLite.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

const DB_NAME = "db.sqlite";
const SUBDIRS = [join("cli", "db")];

/** Child sessions that live inside their parent's task. Their prompts are written by the parent agent. */
const OWNED_CHILD = new Set(["subagent_child", "workflow_child", "nested_workflow_child", "selection_side_chat"]);
/** Sessions with a parent_id that are tasks of their own. */
const INDEPENDENT = new Set(["fork", "workflow_parent"]);

/** User messages a person caused. A launched saved workflow is one too. */
const PROMPT_KINDS = new Set(["user_prompt", "slash_command"]);
/** metadata.source of user messages the runtime wrote, for rows from before semantics existed. */
const SYNTHETIC_SOURCES = new Set([
  "agent_listing_delta",
  "background_task",
  "fork",
  "goal_state_change",
  "goal-continuation",
  "plugin_reference",
  "bot_topic_context",
  "rewind",
  "selection_side_chat",
  "subagent",
  "subagent_message",
  "todo_reminder",
  "shared_context",
]);

const j = (path: string) => `json_extract(data, '$.${path}')`;
const MESSAGE_SQL = `select id, session_id, time_created,
  ${j("role")} as role, ${j("time.created")} as created, ${j("time.completed")} as completed,
  coalesce(${j("modelId")}, ${j("modelID")}) as model,
  ${j("path.root")} as root, ${j("path.cwd")} as cwd, ${j("tokens")} as tokens,
  ${j("semantics.origin")} as origin, ${j("semantics.kind")} as kind,
  ${j("metadata.source")} as source, coalesce(${j("synthetic")}, 0) as synthetic,
  ${j("metadata.forkOrigin")} is not null as forked
  from message`;
// Tool output can be large and private: only the fields used below are read.
const PART_SQL = `select id, message_id, ${j("type")} as type, ${j("tool")} as tool,
  ${j("state.time.start")} as started, ${j("state.time.end")} as ended,
  ${j("state.input.command")} as command, ${j("state.input.file_path")} as file_path,
  ${j("state.input.patch_text")} as patch, ${j("tokens")} as tokens
  from part where ${j("type")} in ('tool', 'step-finish')`;

type SessionInfo = { id: string; parentId: string | null; linkParent: string | null; taskType: string | null; directory: string | null; created: number };
type Message = {
  id: string;
  session: string;
  role: string | null;
  created: number | null;
  completed: number | null;
  model: string | null;
  cwd: string | null;
  tokens: Obj | null;
  origin: string | null;
  kind: string | null;
  source: string | null;
  synthetic: boolean;
  forked: boolean;
};
type Part = { id: string; message: string; type: string; tool: string | null; started: number | null; ended: number | null; command: string | null; filePath: string | null; patch: string | null; tokens: Obj | null };

function parseJson(raw: unknown, warnings: ParseWarnings): Obj | null {
  if (raw === null || raw === undefined) return null;
  try {
    return obj(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    warnings.badLines += 1;
    return null;
  }
}

function tableNames(db: SqliteSnapshot): Set<string> {
  return new Set(db.all("select name from sqlite_master where type = 'table'").map((r) => String(r.name)));
}

function readSessions(db: SqliteSnapshot, tables: Set<string>, warnings: ParseWarnings): Map<string, SessionInfo> {
  // Columns came with migrations (task_type in 0007), so older files lack some.
  const columns = new Set(db.all("select name from pragma_table_info('session')").map((r) => String(r.name)));
  const col = (name: string) => (columns.has(name) ? name : `null as ${name}`);
  const sessions = new Map<string, SessionInfo>();
  for (const r of db.all(`select id, ${col("parent_id")}, ${col("task_type")}, ${col("directory")}, ${col("time_created")} from session`)) {
    warnings.lines += 1;
    const id = str(r.id);
    if (!id) continue;
    sessions.set(id, { id, parentId: str(r.parent_id), linkParent: null, taskType: str(r.task_type), directory: str(r.directory), created: num(r.time_created) });
  }
  if (tables.has("session_task_link")) {
    for (const r of db.all("select child_session_id, parent_session_id from session_task_link")) {
      const s = sessions.get(String(r.child_session_id));
      if (s) s.linkParent ??= str(r.parent_session_id);
    }
  }
  return sessions;
}

function toMessage(r: Row, warnings: ParseWarnings): Message | null {
  warnings.lines += 1;
  const id = str(r.id);
  const session = str(r.session_id);
  if (!id || !session) return null;
  return {
    id,
    session,
    role: str(r.role),
    created: time(r.created) ?? time(r.time_created),
    completed: time(r.completed),
    model: str(r.model),
    cwd: str(r.root) ?? str(r.cwd),
    tokens: parseJson(r.tokens, warnings),
    origin: str(r.origin),
    kind: str(r.kind),
    source: str(r.source),
    synthetic: r.synthetic === 1 || r.synthetic === true,
    forked: r.forked === 1 || r.forked === true,
  };
}

function toPart(r: Row, warnings: ParseWarnings): Part | null {
  warnings.lines += 1;
  const id = str(r.id);
  const message = str(r.message_id);
  const type = str(r.type);
  if (!id || !message || !type) return null;
  return {
    id,
    message,
    type,
    tool: str(r.tool),
    started: time(r.started),
    ended: time(r.ended),
    command: str(r.command),
    filePath: str(r.file_path),
    patch: str(r.patch),
    tokens: type === "step-finish" ? parseJson(r.tokens, warnings) : null,
  };
}

/** A copy of an earlier message, made by a fork or a side chat. */
function isCopy(m: Message, s: SessionInfo | undefined): boolean {
  if (m.forked) return true;
  // Older forks may lack forkOrigin; a copied message keeps its original time, from before the fork existed.
  return !!s?.parentId && m.created !== null && s.created > 0 && m.created < s.created;
}

function isPrompt(m: Message): boolean {
  if (m.role !== "user") return false;
  if (m.origin !== null) return m.origin === "real_user" && (m.kind === null || PROMPT_KINDS.has(m.kind));
  return !m.synthetic && !(m.source && SYNTHETIC_SOURCES.has(m.source));
}

/** input holds the whole prompt in ZCode; cache reads and writes are taken out of it. */
function usageOf(tokens: Obj | null) {
  const cache = obj(tokens?.cache);
  const cacheRead = num(cache?.read);
  const cacheWrite = num(cache?.write);
  const total = num(tokens?.input);
  const input = total >= cacheRead + cacheWrite ? total - cacheRead - cacheWrite : total;
  return { input, output: num(tokens?.output), cacheRead, cacheWrite, cacheWriteLong: 0 };
}
const usageTotal = (u: ReturnType<typeof usageOf>) => u.input + u.output + u.cacheRead + u.cacheWrite;

/** The root session's id for a child, else null. */
function parentOf(s: SessionInfo, hasCopies: boolean): string | null {
  if (s.linkParent) return s.linkParent;
  if (!s.parentId) return null;
  if (s.taskType && OWNED_CHILD.has(s.taskType)) return s.parentId;
  if (s.taskType && INDEPENDENT.has(s.taskType)) return null;
  // No task type (before 0007) or "interactive", which old rows got by default: a fork copies history, a subagent does not.
  return hasCopies ? null : s.parentId;
}

type Seen = { sessions: Set<string> };

async function readDatabase(file: string, emit: Emit, warnings: ParseWarnings, seen: Seen): Promise<void> {
  const db = await openSnapshot(file);
  try {
    const tables = tableNames(db);
    if (!tables.has("session") || !tables.has("message") || !tables.has("part")) {
      countUnknown(warnings, "zcode:(not a ZCode session database)");
      return;
    }
    // The same session in a second database file (a copy or a backup) counts once.
    const sessions = [...readSessions(db, tables, warnings).values()].filter((s) => !seen.sessions.has(s.id));
    const known = new Map(sessions.map((s) => [s.id, s]));

    const messagesOf = new Map<string, Message[]>();
    for (const r of db.all(MESSAGE_SQL)) {
      const m = toMessage(r, warnings);
      // Messages whose session row is gone still count, in a session of their own.
      if (!m || seen.sessions.has(m.session)) continue;
      const list = messagesOf.get(m.session) ?? [];
      list.push(m);
      messagesOf.set(m.session, list);
    }
    const partsOf = new Map<string, Part[]>();
    for (const r of db.all(PART_SQL)) {
      const p = toPart(r, warnings);
      if (!p) continue;
      const list = partsOf.get(p.message) ?? [];
      list.push(p);
      partsOf.set(p.message, list);
    }

    for (const id of messagesOf.keys()) {
      if (!known.has(id)) {
        const orphan = { id, parentId: null, linkParent: null, taskType: null, directory: null, created: 0 };
        known.set(id, orphan);
        sessions.push(orphan);
      }
    }
    sessions.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));

    for (const s of sessions) {
      seen.sessions.add(s.id);
      const all = messagesOf.get(s.id) ?? [];
      const messages = all.filter((m) => !isCopy(m, s)).sort((a, b) => (a.created ?? 0) - (b.created ?? 0) || a.id.localeCompare(b.id));
      const session = s.id;
      emit({ type: "session", session, parent: parentOf(s, messages.length < all.length) });

      for (const m of messages) {
        const cwd = m.cwd ?? s.directory;
        if (m.role === "user") {
          if (m.created === null) continue;
          const prompt = isPrompt(m);
          emit({ type: "tick", session, t: m.created, cwd, active: prompt });
          if (prompt) emit({ type: "prompt", session, t: m.created });
          continue;
        }
        if (m.role !== "assistant") {
          countUnknown(warnings, `zcode:role ${String(m.role)}`);
          continue;
        }
        if (m.created !== null) emit({ type: "tick", session, t: m.created, cwd, active: true });
        if (m.completed !== null) emit({ type: "tick", session, t: m.completed, cwd });

        // One message is one model step, so its tokens equal its step-finish part. The parts are a fallback.
        const parts = (partsOf.get(m.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
        let usage = usageOf(m.tokens);
        if (usageTotal(usage) === 0) {
          for (const p of parts) {
            if (p.type !== "step-finish") continue;
            const u = usageOf(p.tokens);
            usage = { ...usage, input: usage.input + u.input, output: usage.output + u.output, cacheRead: usage.cacheRead + u.cacheRead, cacheWrite: usage.cacheWrite + u.cacheWrite };
          }
        }
        const at = m.completed ?? m.created;
        if (at !== null && usageTotal(usage) > 0) {
          emit({ type: "usage", session, t: at, model: m.model ?? "unknown", usage, costUsd: null, cwd });
        }

        for (const p of parts) {
          // Copies are already left out with their messages. Call ids are not used: some providers number them per reply.
          if (p.type !== "tool" || !p.tool) continue;
          const started = p.started ?? at;
          if (started === null) continue;
          const category = p.tool === "Bash" ? shellCategory(p.command) : toolCategory(p.tool);
          emit({ type: "tick", session, t: started, cwd });
          emit({ type: "tool", session, t: started, name: p.tool, category });
          if (p.ended !== null) emit({ type: "tick", session, t: p.ended, cwd });
          if (p.filePath && category === "edit") emit({ type: "edit", session, t: started, file: basename(p.filePath) });
          if (p.patch) for (const f of patchFiles(p.patch)) emit({ type: "edit", session, t: started, file: basename(f) });
        }
      }
    }
  } finally {
    await db.close();
  }
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const seen: Seen = { sessions: new Set() };
  for (const f of files) {
    warnings.files += 1;
    try {
      await readDatabase(f, emit, warnings, seen);
    } catch (e) {
      countUnknown(warnings, `zcode:(unreadable database: ${String((e as Error)?.message ?? e).slice(0, 120)})`);
    }
  }
}

/**
 * The database file for each given path: the path itself when it is a file,
 * else db.sqlite in it, in db/ or in cli/db/. Backups next to it
 * (db.sqlite.bak-*) are left out.
 */
async function listFiles(dirs: readonly string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const d of dirs) {
    const options = (await isFile(d)) ? [d] : [join(d, DB_NAME), join(d, "db", DB_NAME), join(d, "cli", "db", DB_NAME)];
    for (const p of options) {
      if (await isFile(p)) {
        out.add(await realpath(p));
        break;
      }
    }
  }
  return [...out].sort();
}

async function countSessions(_dirs: readonly string[], files: readonly string[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    try {
      const db = await openSnapshot(f);
      try {
        const tables = tableNames(db);
        if (!tables.has("session")) continue;
        const sessions = [...readSessions(db, tables, { files: 0, lines: 0, badLines: 0, unknownEvents: {} }).values()];
        // Forks count as their own tasks here; parse() tells interactive forks and subagents apart from their messages.
        n += sessions.filter((s) => !s.linkParent && !(s.parentId && s.taskType && OWNED_CHILD.has(s.taskType))).length;
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

/** A ZCode data folder (~/.zcode), its cli/db folder, or the database file itself. */
export async function looksLikeZcodeHome(root: string): Promise<boolean> {
  const [file] = await listFiles([root]);
  return file !== undefined && (await isSqliteFile(file));
}

/** "~/x" and absolute paths, as ZCode resolves them. Relative paths depend on each workspace's cwd and are skipped. */
function userPath(raw: string | undefined, home: string): string | null {
  const p = raw?.trim();
  if (!p) return null;
  if (p === "~" || p.startsWith("~/")) return join(home, p.slice(1));
  return isAbsolute(p) ? p : null;
}

/** The last of ZCODE_SESSION_DB_PATH and ZCODE_SESSION_DB in env order, which is the one ZCode uses. */
function envDbPath(env: NodeJS.ProcessEnv): string | undefined {
  let picked: string | undefined;
  for (const [key, value] of Object.entries(env)) if ((key === "ZCODE_SESSION_DB_PATH" || key === "ZCODE_SESSION_DB") && value) picked = value;
  return picked;
}

/** storage.sessionDbPath from ~/.zcode/cli/config.json. Only that key is read. */
async function configDbPath(home: string): Promise<string | null> {
  try {
    const config = obj(JSON.parse(await readFile(join(home, ".zcode", "cli", "config.json"), "utf8")));
    return userPath(str(obj(config?.storage)?.sessionDbPath) ?? undefined, home);
  } catch {
    return null;
  }
}

/**
 * $ZCODE_SESSION_DB_PATH (or $ZCODE_SESSION_DB), storage.sessionDbPath in the
 * user config, ~/.zcode, saved folders, then the same variables in shell files.
 * Project-level .zcode/config.json overrides are not followed.
 */
async function discover(ctx: DiscoverContext): Promise<Candidate[]> {
  const file = (p: string, via: Candidate["via"], verify = false): Candidate => ({ root: p, dirs: [resolve(p)], via, verify });
  const out: Candidate[] = [];
  const fromEnv = userPath(envDbPath(ctx.env), ctx.home);
  if (fromEnv) out.push(file(fromEnv, "env"));
  const fromConfig = await configDbPath(ctx.home);
  if (fromConfig) out.push(file(fromConfig, "default"));
  const home = join(ctx.home, ".zcode");
  out.push({ root: home, dirs: SUBDIRS.map((s) => join(home, s)), via: "default", verify: false });
  for (const r of ctx.saved) {
    out.push((await isDir(join(r, SUBDIRS[0]!))) ? { root: r, dirs: SUBDIRS.map((s) => join(resolve(r), s)), via: "saved", verify: false } : file(r, "saved"));
  }
  for (const v of ["ZCODE_SESSION_DB_PATH", "ZCODE_SESSION_DB"]) for (const p of ctx.shellValues(v)) out.push(file(p, "shell", true));
  return out;
}

export const zcode: Adapter = {
  id: "zcode",
  shellVars: ["ZCODE_SESSION_DB_PATH", "ZCODE_SESSION_DB"],
  subdirs: SUBDIRS,
  dbFile: true,
  discover,
  looksLike: looksLikeZcodeHome,
  listFiles,
  countSessions,
  parse,
};
