import { open, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { shellCategory, toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { dirNames, isDir, listAll } from "../files";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "../lines";
import { patchFiles } from "./codex";

/**
 * oh-my-pi (omp) sessions: ~/.omp/agent/sessions/<cwd>/<time>_<id>.jsonl, or
 * flat in a folder set with PI_CODING_AGENT_SESSION_DIR. Written from the omp
 * 18.18.2 source (commit cb4801a) and checked on two sessions from the omp
 * repository; not yet checked on other people's logs.
 *
 * omp is a fork of Pi with the same session format, version 3: a header with
 * the working directory, then entries with id and parentId. Since June 2026
 * the first line is a fixed-width title slot ({"type":"title"}), which Pi
 * never writes. Assistant messages and model_usage entries (cache warming,
 * classifiers, discarded turns) carry the usage, the same as omp stats. The
 * usage on a task tool result repeats its subagent's, which is read from the
 * subagent's own file, so it is not counted.
 *
 * Subagent and advisor transcripts live next to their parent, in a folder
 * named after it: <time>_<id>/<AgentId>.jsonl. /fork, /branch, --fork, seance
 * forks and continuations copy entries with the same ids and timestamps.
 * Files are read oldest first by name, parents before children, so each entry
 * counts once and the original keeps it. Entries with claude- or codex- ids
 * are history imported from Claude Code or Codex, which those adapters count.
 *
 * omp has no marker for print, RPC or SDK runs, so every session counts as
 * interactive. Not read: `omp gc` archives (.jsonl.gz), collab replicas in
 * ~/.omp/collab, and sessions put elsewhere with --session-dir.
 */
const KNOWN_TYPES = new Set([
  "session",
  "title",
  "message",
  "model_usage",
  "thinking_level_change",
  "model_change",
  "service_tier_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "title_change",
  "ttsr_injection",
  "session_init",
  "mode_change",
  "credential_pin",
  "reset_boundary",
]);

/** The title slot and bookmarks are re-created with new ids in every copy: not activity. */
const NOT_ACTIVITY = new Set(["title", "label", "title_change"]);

/** Ids omp gives history it imports from Claude Code and Codex. */
const IMPORTED = /^(?:claude|codex)-/;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The first line of an omp session since June 2026. Pi never writes it. */
export const isOmpTitle = (e: Obj): boolean => e.type === "title";

/** Typed by the person: not a synthetic notice, not a message another agent sent. */
const byPerson = (m: Obj): boolean => m.synthetic !== true && m.attribution !== "agent";

/** Session file names start with their creation time. */
const SESSION_STEM = /^\d{4}-\d{2}-\d{2}T[\d-]+Z_/;

/** The path from the session file name on: <time>_<id>.jsonl sorts before <time>_<id>/<child>.jsonl, and older before newer across cwd folders. */
function ageKey(file: string): string {
  const parts = file.split(/[\\/]/);
  const i = parts.findLastIndex((p) => SESSION_STEM.test(p));
  return i < 0 ? file : parts.slice(i).join("/");
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The file a subagent or advisor transcript belongs to. */
const parentFile = (file: string): string => `${dirname(file)}.jsonl`;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WEB_URL = /^https?:\/\//i;
/** write xd://<tool> runs a tool that is not in the request's tool list. */
const XD_DEVICE = /^xd:\/\/([^/?#]+)/;
const HASHLINE_PATH = /^\[(.+?)(?:#[0-9A-Fa-f]{4})?\]\r?$/;
const HASHLINE_HEADER = new RegExp(HASHLINE_PATH.source, "gm");
const HASHLINE_MOVE = /^MV (.+?)\r?$/gm;
const PATCH_MOVE = /^\*\*\* Move to: (.+?)\r?$/gm;

/** Tools whose arguments name the files they change. */
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"]);

/**
 * Files one edit or write call changes: its path, or the files an apply_patch
 * or hashline patch names, moves included. A path with a scheme, like
 * local://, is not a project file. Only the paths are read.
 */
function editTargets(name: string, args: Obj | null): string[] {
  const path = str(args?.path);
  const input = name === "write" ? null : str(args?.input);
  const found = path
    ? [path]
    : input
      ? [...patchFiles(input), ...[PATCH_MOVE, HASHLINE_HEADER, HASHLINE_MOVE].flatMap((re) => [...input.matchAll(re)].map((m) => m[1]!.trim()))]
      : [];
  const files = found.map((p) => HASHLINE_PATH.exec(p.trimEnd())?.[1] ?? p).filter((p) => p && !SCHEME.test(p));
  return [...new Set(files)];
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const seenEntries = new Set<string>();
  const seenCalls = new Set<string>();
  const listed = new Set(files);
  const sessionOf = new Map<string, string>();

  const ordered = [...files].sort((a, b) => order(ageKey(a), ageKey(b)) || order(a, b));
  for (const file of ordered) {
    const parent = listed.has(parentFile(file)) ? (sessionOf.get(parentFile(file)) ?? null) : null;
    let session: string | null = null;
    let cwd: string | null = null;
    const start = (id: string): string => {
      session = id;
      sessionOf.set(file, id);
      emit({ type: "session", session: id, parent });
      return id;
    };

    const addUsage = (s: string, t: number, raw: Obj | null, model: string | null) => {
      if (!raw) return;
      // Orchestration tokens are billed outside the conversation buckets; omp stats adds them too.
      const extra = obj(raw.orchestration);
      const cacheWrite = num(raw.cacheWrite);
      const long = Math.min(num(obj(raw.cttl)?.ephemeral1h), cacheWrite);
      const u = {
        input: num(raw.input) + num(extra?.input),
        output: num(raw.output) + num(extra?.output),
        cacheRead: num(raw.cacheRead) + num(extra?.cacheRead),
        cacheWrite: cacheWrite - long,
        cacheWriteLong: long,
      };
      if (u.input + u.output + u.cacheRead + u.cacheWrite + u.cacheWriteLong === 0) return;
      const cost = obj(raw.cost);
      emit({ type: "usage", session: s, t, model: model ?? "unknown", usage: u, costUsd: cost ? num(cost.total) : null, cwd });
    };

    const addToolCall = (s: string, t: number, block: Obj) => {
      const name = str(block.name);
      if (!name) return;
      const callId = str(block.id);
      if (callId) {
        if (seenCalls.has(callId)) return;
        seenCalls.add(callId);
      }
      const args = obj(block.arguments);
      const path = str(args?.path);
      const device = name === "write" && path ? XD_DEVICE.exec(path)?.[1] : undefined;
      if (device) {
        emit({ type: "tool", session: s, t, name: device, category: toolCategory(device) });
        return;
      }
      const category =
        name === "bash" ? shellCategory(str(args?.command)) : name === "read" && path && WEB_URL.test(path) ? "web" : toolCategory(name);
      emit({ type: "tool", session: s, t, name, category });
      if (!EDIT_TOOLS.has(name)) return;
      for (const target of editTargets(name, args)) emit({ type: "edit", session: s, t, file: basename(target) });
    };

    await readJsonl(file, warnings, (e) => {
      const type = e.type;
      if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
        countUnknown(warnings, `omp:${typeof type === "string" ? type : "(no type)"}`);
        return;
      }
      if (type === "title") return;
      const t = parseTime(e.timestamp);
      if (type === "session") {
        if (session) return;
        cwd = str(e.cwd);
        const s = start(str(e.id) ?? file);
        if (t !== null) emit({ type: "tick", session: s, t, cwd });
        return;
      }
      // Entries before a header: the file is its own session.
      const s = session ?? start(file);
      if (t === null || NOT_ACTIVITY.has(type)) return;
      const id = str(e.id);
      if (id) {
        if (IMPORTED.test(id)) return;
        const key = `${id}|${String(e.timestamp)}`;
        if (seenEntries.has(key)) return;
        seenEntries.add(key);
      }

      const message = type === "message" ? obj(e.message) : null;
      const role = str(message?.role);
      // A /skill:name the person typed is stored as a custom message.
      const prompt = (role === "user" && message !== null && byPerson(message)) || (type === "custom_message" && e.customType === "skill-prompt" && byPerson(e));
      const reply = role === "assistant";
      // A command the person ran with ! or $ is their activity, but not a prompt or a model tool call.
      emit({ type: "tick", session: s, t, cwd, active: prompt || reply || role === "bashExecution" || role === "pythonExecution" });
      if (prompt) emit({ type: "prompt", session: s, t });
      if (type === "model_usage") addUsage(s, t, obj(e.usage), str(e.model));
      if (!reply || !message) return;
      // The model a router answered with, else the one asked for.
      addUsage(s, t, obj(message.usage), str(message.upstreamModel) ?? str(message.model));
      for (const raw of Array.isArray(message.content) ? message.content : []) {
        const block = obj(raw);
        if (block?.type === "toolCall") addToolCall(s, t, block);
      }
    });
  }
}

/** True when a file starts with the omp title slot. */
async function startsWithTitle(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const first = obj(JSON.parse(buf.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? ""));
    return first !== null && isOmpTitle(first);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * True when an agent folder (with sessions/) or a session folder holds an omp
 * session. Only the title slot tells omp from Pi, whose variables omp shares.
 */
export async function looksLikeOmpHome(root: string): Promise<boolean> {
  for (const dir of [root, join(root, "sessions")]) {
    for (const d of [dir, ...(await dirNames(dir)).slice(0, 8).map((n) => join(dir, n))]) {
      const newest = (await readdir(d).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort().at(-1);
      if (newest && (await startsWithTitle(join(d, newest)))) return true;
    }
  }
  return false;
}

const SUBDIRS = ["sessions"];

/**
 * $PI_CODING_AGENT_SESSION_DIR and $PI_CODING_AGENT_DIR, which the original Pi
 * reads too, so only when they hold omp sessions; then $XDG_DATA_HOME/omp,
 * ~/.omp/agent (~ joined with $PI_CONFIG_DIR) and every profile, then saved
 * folders.
 */
async function discover(ctx: DiscoverContext): Promise<Candidate[]> {
  const at = (root: string, via: Candidate["via"], verify = false): Candidate => ({
    root,
    dirs: SUBDIRS.map((s) => join(resolve(root), s)),
    via,
    verify,
  });
  const out: Candidate[] = [];
  const sessionDir = ctx.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDir) out.push({ root: sessionDir, dirs: [resolve(sessionDir)], via: "env", verify: true });
  const agentDir = ctx.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) out.push(at(agentDir, "env", true));
  // XDG folders flatten agent/: $XDG_DATA_HOME/omp/sessions.
  const xdg = ctx.env.XDG_DATA_HOME?.trim();
  const xdgRoot = xdg ? join(xdg, "omp") : null;
  if (xdgRoot) out.push(at(xdgRoot, "default"));
  const root = join(ctx.home, ctx.env.PI_CONFIG_DIR || ".omp");
  out.push(at(join(root, "agent"), "default"));
  for (const name of (await dirNames(join(root, "profiles"))).sort()) out.push(at(join(root, "profiles", name, "agent"), "default"));
  if (xdgRoot) for (const name of (await dirNames(join(xdgRoot, "profiles"))).sort()) out.push(at(join(xdgRoot, "profiles", name), "default"));
  // A saved folder is an agent folder with sessions/, or a session folder itself.
  for (const r of ctx.saved) out.push((await isDir(join(r, "sessions"))) ? at(r, "saved") : { root: r, dirs: [resolve(r)], via: "saved", verify: false });
  return out;
}

/** `omp gc --compress` copies transcripts into these folders while it runs. */
const COMPRESS_SCRATCH = /[\\/]\.omp-gc-compress-/;

export const omp: Adapter = {
  id: "omp",
  shellVars: [],
  subdirs: SUBDIRS,
  discover,
  looksLike: looksLikeOmpHome,
  listFiles: async (dirs) => (await listAll(dirs)).filter((f) => !COMPRESS_SCRATCH.test(f)),
  countSessions: (_dirs, files) => {
    const listed = new Set(files);
    return files.filter((f) => !listed.has(parentFile(f))).length;
  },
  parse,
};
