import { open, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { shellCategory, toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { dirNames, isDir, listAll } from "../files";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "../lines";

/**
 * Pi coding agent sessions: ~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl,
 * or flat in a session folder set with PI_CODING_AGENT_SESSION_DIR or
 * sessionDir in settings.json. Format version 3, checked on real Pi logs.
 *
 * The first line is a session header with the working directory; every other
 * line is an entry with id and parentId, which form a tree: /tree continues
 * from an earlier entry in the same file. Every entry counts, not only the
 * branch that is active now, the same as Pi's own /session totals
 * (getSessionStats in agent-session.ts): assistant messages, usage entries,
 * usage on compaction and branch summaries, and usage on tool results.
 *
 * /fork and /clone write a new file that copies the forked path with the same
 * ids and timestamps (createBranchedSession in session-manager.ts), --fork
 * copies every entry (forkFrom). Copies count once: files are read oldest
 * first by their name, which starts with the creation time, so the original
 * keeps its entries. Labels are re-created with new ids and are not activity.
 *
 * Pi has no marker for print, RPC or SDK runs, so every session counts as
 * interactive.
 */
const KNOWN_TYPES = new Set([
  "session",
  "message",
  "model_change",
  "thinking_level_change",
  "usage",
  "compaction",
  "context_edit",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

/** Model calls outside assistant messages: cache warming, compaction and branch summaries. */
const USAGE_ENTRIES = new Set(["usage", "compaction", "branch_summary"]);

/** A /skill:name expansion is stored as a user message but was not typed as one. */
function isTypedPrompt(message: Obj): boolean {
  const content = message.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? str(obj(content[0])?.text) : null;
  return !(text ?? "").trimStart().startsWith("<skill name=");
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Tools whose arguments name the file they change. */
const EDIT_TOOLS = new Set(["edit", "write"]);

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  // A forked session copies entries of its parent. Each entry counts once.
  const seenEntries = new Set<string>();
  const seenCalls = new Set<string>();

  // Oldest first by file name (<creation time>_<id>.jsonl), across folders, so an original is read before its forks.
  const ordered = [...files].sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
  for (const file of ordered) {
    let session: string | null = null;
    let cwd: string | null = null;
    /** For usage entries that do not name a model. */
    let model: string | null = null;

    const addUsage = (s: string, t: number, raw: Obj | null, modelName: string | null) => {
      if (!raw) return;
      // input excludes cache; output includes reasoning; cacheWrite1h is the part of cacheWrite kept for an hour.
      const long = Math.min(num(raw.cacheWrite1h), num(raw.cacheWrite));
      const u = { input: num(raw.input), output: num(raw.output), cacheRead: num(raw.cacheRead), cacheWrite: num(raw.cacheWrite) - long, cacheWriteLong: long };
      if (u.input + u.output + u.cacheRead + u.cacheWrite + u.cacheWriteLong === 0) return;
      const cost = obj(raw.cost);
      emit({ type: "usage", session: s, t, model: modelName ?? "unknown", usage: u, costUsd: cost ? num(cost.total) : null, cwd });
    };

    await readJsonl(file, warnings, (e) => {
      const type = e.type;
      if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
        countUnknown(warnings, `pi:${typeof type === "string" ? type : "(no type)"}`);
        return;
      }
      const t = parseTime(e.timestamp);
      if (type === "session") {
        if (session) return;
        session = str(e.id) ?? file;
        cwd = str(e.cwd);
        emit({ type: "session", session });
        if (t !== null) emit({ type: "tick", session, t, cwd });
        return;
      }
      // Entries before a header: the file is its own session.
      if (!session) {
        session = file;
        emit({ type: "session", session });
      }
      // A bookmark, re-created with a new id in every fork: not activity.
      if (t === null || type === "label") return;
      const id = str(e.id);
      if (id) {
        const key = `${id}|${String(e.timestamp)}`;
        if (seenEntries.has(key)) return;
        seenEntries.add(key);
      }

      if (type === "model_change") model = str(e.modelId) ?? model;
      const message = type === "message" ? obj(e.message) : null;
      const role = str(message?.role);
      const prompt = role === "user" && message !== null && isTypedPrompt(message);
      const reply = role === "assistant";
      // A command the person ran with ! is their activity, but not a prompt or a model tool call.
      emit({ type: "tick", session, t, cwd, active: prompt || reply || role === "bashExecution" });
      if (prompt) emit({ type: "prompt", session, t });
      // Usage entries name their model; summaries and tool results do not, so they go to the session's model.
      if (USAGE_ENTRIES.has(type)) addUsage(session, t, obj(e.usage), str(e.model) ?? model);
      if (role === "toolResult" && message) addUsage(session, t, obj(message.usage), model);
      if (!reply || !message) return;

      // The model that answered, when a router picked it, else the one asked for.
      const answered = str(message.responseModel) ?? str(message.model);
      model = str(message.model) ?? model;
      addUsage(session, t, obj(message.usage), answered ?? model);

      for (const raw of Array.isArray(message.content) ? message.content : []) {
        const block = obj(raw);
        if (block?.type !== "toolCall") continue;
        const name = str(block.name);
        if (!name) continue;
        const callId = str(block.id);
        if (callId) {
          if (seenCalls.has(callId)) continue;
          seenCalls.add(callId);
        }
        const args = obj(block.arguments);
        const category = name === "bash" ? shellCategory(str(args?.command)) : toolCategory(name);
        emit({ type: "tool", session, t, name, category });
        const path = EDIT_TOOLS.has(name) ? str(args?.path) : null;
        if (path) emit({ type: "edit", session, t, file: basename(path) });
      }
    });
  }
}

/** True when a file starts with a Pi session header. */
async function isPiSession(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const first = JSON.parse(buf.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "") as Obj;
    return first.type === "session" && typeof first.id === "string";
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

export async function looksLikePiHome(root: string): Promise<boolean> {
  const sessions = join(root, "sessions");
  for (const dir of (await dirNames(sessions)).slice(0, 8)) {
    const files = (await readdir(join(sessions, dir)).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
    if (files[0]) return isPiSession(join(sessions, dir, files[0]));
  }
  return false;
}

const SUBDIRS = ["sessions"];

/** sessionDir from an agent folder's settings.json. Only that one key is read. */
async function settingsSessionDir(agentDir: string, home: string): Promise<string | null> {
  try {
    const settings = obj(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")));
    const dir = str(settings?.sessionDir)?.replace(/^~(?=\/|$)/, home);
    return dir ? resolve(agentDir, dir) : null;
  } catch {
    return null;
  }
}

/**
 * $PI_CODING_AGENT_SESSION_DIR, then $PI_CODING_AGENT_DIR and ~/.pi/agent with
 * their sessions/ folder or the sessionDir their settings.json names, then
 * saved folders and PI_CODING_AGENT_DIR values in shell files.
 */
async function discover(ctx: DiscoverContext): Promise<Candidate[]> {
  const at = (root: string, via: Candidate["via"]): Candidate => ({
    root,
    dirs: SUBDIRS.map((s) => join(resolve(root), s)),
    via,
    verify: false,
  });
  const out: Candidate[] = [];
  const sessionDir = ctx.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDir) out.push({ root: sessionDir, dirs: [resolve(sessionDir)], via: "env", verify: false });
  const agentDir = ctx.env.PI_CODING_AGENT_DIR?.trim();
  for (const [root, via] of [
    ...(agentDir ? [[agentDir, "env"] as const] : []),
    [join(ctx.home, ".pi", "agent"), "default"] as const,
  ]) {
    const custom = await settingsSessionDir(resolve(root), ctx.home);
    out.push(custom ? { root: custom, dirs: [custom], via, verify: false } : at(root, via));
  }
  // A saved folder is an agent folder with sessions/, or a custom session folder itself.
  for (const r of ctx.saved) out.push((await isDir(join(r, "sessions"))) ? at(r, "saved") : { root: r, dirs: [resolve(r)], via: "saved", verify: false });
  out.push(...ctx.shellValues("PI_CODING_AGENT_DIR").map((r) => ({ ...at(r, "shell"), verify: true })));
  return out;
}

export const pi: Adapter = {
  id: "pi",
  shellVars: ["PI_CODING_AGENT_DIR"],
  subdirs: SUBDIRS,
  discover,
  looksLike: looksLikePiHome,
  listFiles: listAll,
  countSessions: async (_dirs, files) => files.length,
  parse,
};
