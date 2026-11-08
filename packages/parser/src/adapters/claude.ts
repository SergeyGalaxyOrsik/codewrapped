import { open, readdir } from "node:fs/promises";
import { basename as fileName, join, relative, resolve, sep } from "node:path";
import { shellCategory, toolCategory, type RequestUsage } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { dirNames, listAll } from "../files";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "../lines";

/**
 * Claude Code transcript event types seen as of Claude Code 2.1. Only
 * `user` and `assistant` carry counts; the rest only add timestamps.
 * Anything else is counted as unknown and skipped.
 */
const KNOWN_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "summary",
  "attachment",
  "last-prompt",
  "mode",
  "permission-mode",
  "atis-latch",
  "file-history-snapshot",
  "file-history-delta",
  "ai-title",
  "custom-title",
  "cost-state",
  "queue-operation",
  "api-request-shape",
  "api-request-blob",
  "api-request",
  "session-owner",
  "tools-used",
  "pr-link",
  "worktree-state",
  "relocated",
  "fork-context-ref",
  "artifact-comment-monitor",
  "artifact-autoreact-ledger",
  "frame-link",
  "agent-name",
  "launched",
  "started",
  "result",
]);

/** Tools that edit a file, and the input field that holds its path. */
const EDIT_TOOLS: Record<string, string[]> = {
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["notebook_path", "file_path"],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type PendingUsage = { session: string; t: number; model: string; u: RequestUsage; cwd: string | null };

function readUsage(raw: Obj): RequestUsage {
  const cacheCreation = num(raw.cache_creation_input_tokens);
  const split = obj(raw.cache_creation);
  let write5m = cacheCreation;
  let write1h = 0;
  if (split) {
    write1h = num(split.ephemeral_1h_input_tokens);
    write5m = Math.max(num(split.ephemeral_5m_input_tokens), cacheCreation - write1h);
  }
  return {
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheRead: num(raw.cache_read_input_tokens),
    cacheWrite: write5m,
    cacheWriteLong: write1h,
    fast: raw.speed === "fast",
  };
}

/** One message can be streamed over several lines. Keep the largest value of each field. */
function maxUsage(a: RequestUsage, b: RequestUsage): RequestUsage {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
    cacheWriteLong: Math.max(a.cacheWriteLong, b.cacheWriteLong),
    fast: a.fast || b.fast,
  };
}

const NON_HUMAN_TURNS = new Set(["task_notification", "peer", "scheduled", "system"]);

/** A prompt the user sent, as opposed to tool results, hook output or notices. */
function isPrompt(e: Obj): boolean {
  if (e.isSidechain || e.isMeta || e.isCompactSummary) return false;
  const content = obj(e.message)?.content;
  if (typeof content === "string") {
    if (content.length === 0) return false;
  } else if (Array.isArray(content)) {
    const types = content.map((c) => obj(c)?.type);
    if (types.includes("tool_result")) return false;
    if (!types.includes("text") && !types.includes("image")) return false;
  } else {
    return false;
  }
  const origin = str(obj(e.origin)?.kind);
  if (origin && origin !== "human") return false;
  if (e.promptSource === "system") return false;
  if (typeof e.turnOrigin === "string" && NON_HUMAN_TURNS.has(e.turnOrigin)) return false;
  return true;
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const lastCwd = new Map<string, string>();
  const seenEvents = new Set<string>();
  const seenToolUses = new Set<string>();
  const usage = new Map<string, PendingUsage>();
  /** sessionId -> true while every entrypoint seen is an SDK one. */
  const entrypoints = new Map<string, boolean>();

  const onEvent = (e: Obj) => {
    const type = e.type;
    if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
      countUnknown(warnings, `claude:${typeof type === "string" ? type : "(no type)"}`);
      return;
    }
    const session = str(e.sessionId);
    const t = parseTime(e.timestamp);
    if (!session || t === null) return;

    // Forked and resumed sessions can copy events into a new file.
    const uuid = str(e.uuid);
    if (uuid) {
      if (seenEvents.has(uuid)) return;
      seenEvents.add(uuid);
    }

    // claude -p reports sdk-cli and the Agent SDK sdk-ts. A session is
    // automated when every event that names an entrypoint names an SDK one.
    const entrypoint = str(e.entrypoint);
    if (entrypoint) {
      const isSdk = entrypoint.startsWith("sdk");
      const seen = entrypoints.get(session);
      entrypoints.set(session, seen === undefined ? isSdk : seen && isSdk);
    }

    const ownCwd = str(e.cwd);
    if (ownCwd) lastCwd.set(session, ownCwd);
    const cwd = ownCwd ?? lastCwd.get(session) ?? null;

    const prompt = type === "user" && isPrompt(e);
    const message = type === "assistant" ? obj(e.message) : null;
    const model = str(message?.model);
    const reply = message !== null && model !== null && model !== "<synthetic>";
    emit({ type: "tick", session, t, cwd, active: prompt || reply });
    if (prompt) emit({ type: "prompt", session, t });
    if (!reply) return;

    const rawUsage = obj(message.usage);
    if (rawUsage) {
      const key = `${str(message.id) ?? uuid ?? t}|${str(e.requestId) ?? ""}`;
      const u = readUsage(rawUsage);
      const prev = usage.get(key);
      usage.set(key, prev ? { ...prev, u: maxUsage(prev.u, u) } : { session, t, model, u, cwd });
    }

    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = obj(raw);
      if (block?.type !== "tool_use") continue;
      const name = str(block.name);
      if (!name) continue;
      const id = str(block.id);
      if (id) {
        if (seenToolUses.has(id)) continue;
        seenToolUses.add(id);
      }
      const input = obj(block.input);
      // A Bash call that runs grep or rg is a search. Only the first program is read.
      const category = name === "Bash" ? shellCategory(str(input?.command)) : toolCategory(name);
      emit({ type: "tool", session, t, name, category });
      const pathFields = EDIT_TOOLS[name];
      if (pathFields && input) {
        const path = pathFields.map((f) => str(input[f])).find(Boolean);
        if (path) emit({ type: "edit", session, t, file: basename(path) });
      }
    }
  };

  for (const file of files) await readJsonl(file, warnings, onEvent);

  // Usage goes out once per message, after its last streamed line was seen.
  for (const { session, t, model, u, cwd } of usage.values()) emit({ type: "usage", session, t, model, usage: u, cwd });
  for (const [session, automated] of entrypoints) emit({ type: "session", session, automated });
}

/** True when the first lines of a file look like a Claude Code transcript. */
async function hasClaudeEvents(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
    const buf = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString("utf8").split("\n").slice(0, 20)) {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (typeof e.sessionId === "string" && typeof e.type === "string") return true;
      } catch {
        // A cut-off last line, or not JSON.
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** A Claude Code config folder: projects/<project>/<session>.jsonl with Claude Code events. Checks a few files. */
export async function looksLikeClaudeHome(root: string): Promise<boolean> {
  const projects = join(root, "projects");
  let checked = 0;
  for (const project of await dirNames(projects)) {
    let files: string[];
    try {
      files = (await readdir(join(projects, project))).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files.slice(0, 2)) {
      if (await hasClaudeEvents(join(projects, project, f))) return true;
      if (++checked >= 8) return false;
    }
  }
  return false;
}

const SUBDIRS = ["projects"];

/**
 * $CLAUDE_CONFIG_DIR (comma separated is allowed), ~/.claude and
 * ~/.config/claude, saved folders, CLAUDE_CONFIG_DIR values in shell files,
 * and folders named .claude* or claude* in ~ and ~/.config.
 */
function discover(ctx: DiscoverContext): Candidate[] {
  const at = (root: string, via: Candidate["via"], verify = false): Candidate => ({
    root,
    dirs: SUBDIRS.map((s) => join(resolve(root), s)),
    via,
    verify,
  });
  const fromEnv = (ctx.env.CLAUDE_CONFIG_DIR ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [
    ...fromEnv.map((r) => at(r, "env")),
    ...[join(ctx.home, ".claude"), join(ctx.home, ".config", "claude")].map((r) => at(r, "default")),
    ...ctx.saved.map((r) => at(r, "saved")),
    ...ctx.shellValues("CLAUDE_CONFIG_DIR").map((r) => at(r, "shell", true)),
    ...ctx.homeFolders.filter((p) => /^\.?claude/i.test(fileName(p))).map((r) => at(r, "scan", true)),
  ];
}

export const claude: Adapter = {
  id: "claude",
  shellVars: ["CLAUDE_CONFIG_DIR"],
  subdirs: SUBDIRS,
  discover,
  looksLike: looksLikeClaudeHome,
  listFiles: listAll,
  // projects/<project>/<id>.jsonl, not subagent transcripts deeper down.
  countSessions: (dirs, files) =>
    files.filter((f) => {
      const dir = dirs.find((d) => f.startsWith(`${d}${sep}`));
      return dir !== undefined && relative(dir, f).split(sep).length === 2;
    }).length,
  parse,
};
