import { open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { shellCategory, toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { dirNames, listAll } from "../files";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "../lines";

/**
 * Pi coding agent sessions: ~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl.
 * Format version 3, checked on Pi 0.84 logs. The first line is a session
 * header with the working directory; every other line is an entry with id
 * and parentId, which form a tree: branching from an earlier point adds
 * entries that point back at it. Every entry counts, not only the branch
 * that is active now.
 */
const KNOWN_TYPES = new Set([
  "session",
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

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

  for (const file of files) {
    let session: string | null = null;
    let cwd: string | null = null;

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
      if (t === null) return;
      const id = str(e.id);
      if (id) {
        const key = `${id}|${String(e.timestamp)}`;
        if (seenEntries.has(key)) return;
        seenEntries.add(key);
      }

      const message = type === "message" ? obj(e.message) : null;
      const role = str(message?.role);
      const prompt = role === "user";
      const reply = role === "assistant";
      emit({ type: "tick", session, t, cwd, active: prompt || reply });
      if (prompt) emit({ type: "prompt", session, t });
      if (!reply || !message) return;

      const usage = obj(message.usage);
      if (usage) {
        // output includes reasoning: totalTokens = input + output + cacheRead + cacheWrite.
        const u = {
          input: num(usage.input),
          output: num(usage.output),
          cacheRead: num(usage.cacheRead),
          cacheWrite: num(usage.cacheWrite),
          cacheWriteLong: 0,
        };
        if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) {
          // The model that answered, when a router picked it, else the one asked for.
          const model = str(message.responseModel) ?? str(message.model) ?? "unknown";
          const cost = obj(usage.cost);
          emit({ type: "usage", session, t, model, usage: u, costUsd: cost ? num(cost.total) : null, cwd });
        }
      }

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

/** $PI_CODING_AGENT_DIR, ~/.pi/agent and saved folders. */
function discover(ctx: DiscoverContext): Candidate[] {
  const at = (root: string, via: Candidate["via"]): Candidate => ({
    root,
    dirs: SUBDIRS.map((s) => join(resolve(root), s)),
    via,
    verify: false,
  });
  const fromEnv = ctx.env.PI_CODING_AGENT_DIR?.trim();
  return [
    ...(fromEnv ? [at(fromEnv, "env")] : []),
    at(join(ctx.home, ".pi", "agent"), "default"),
    ...ctx.saved.map((r) => at(r, "saved")),
    ...ctx.shellValues("PI_CODING_AGENT_DIR").map((r) => ({ ...at(r, "shell"), verify: true })),
  ];
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
