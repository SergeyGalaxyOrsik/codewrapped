import { readdir } from "node:fs/promises";
import { basename as fileName, join, resolve } from "node:path";
import { toolCategory } from "@codewrapped/stats";
import type { Adapter, Candidate, DiscoverContext, Emit } from "../adapter";
import { basename } from "../builder";
import { dirNames, listAll } from "../files";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "../lines";

/** Top-level rollout line types seen in Codex CLI 0.156 to 0.166. */
const KNOWN_TYPES = new Set([
  "session_meta",
  "turn_context",
  "response_item",
  "event_msg",
  "world_state",
  "token_usage_record",
  "inter_agent_communication_metadata",
  "compacted",
]);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Root thread sources that mean no person started the session. */
const AUTOMATED_SOURCES = new Set(["exec", "mcp"]);

const PATCH_HEADER = /\*\*\* (?:Add|Update|Delete) File: ([^\n\r]+?)(?=\\n|\\r|\n|\r|["'`]|$)/g;
const CODE_MODE_TOOL = /\btools\.([A-Za-z_]\w*)\s*\(/g;

/** File paths from apply_patch headers. Only the paths are read. */
export function patchFiles(text: string): string[] {
  return [...text.matchAll(PATCH_HEADER)].map((m) => m[1]!.trim()).filter(Boolean);
}

function parseArgs(raw: unknown): Obj | null {
  if (typeof raw !== "string") return obj(raw);
  try {
    return obj(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void> {
  const seenCalls = new Set<string>();
  const seenTurns = new Set<string>();
  // A rollout copied into a second folder must not count twice.
  const seenTokenEvents = new Set<string>();
  const prompts: Array<{ session: string; t: number }> = [];

  for (const file of files) {
    /** The thread id of this rollout. */
    let thread: string | null = null;
    let cwd: string | null = null;
    /** session_meta.git.repository_url when present. */
    let repoUrl: string | null = null;
    let model: string | null = null;
    let prevTotal: number | null = null;
    let prevTotalUsage: Obj | null = null;
    const turnStarts: number[] = [];
    const userMessages: number[] = [];

    /** session_meta source: "cli", "vscode", "exec", "mcp", or a subagent object. */
    const startThread = (id: string, parent: string | null, source: string | null): string => {
      emit({ type: "session", session: id, parent, automated: source === null ? undefined : AUTOMATED_SOURCES.has(source) });
      return id;
    };
    // Without session_meta first, the file is its own thread.
    const ensureThread = (): string => (thread ??= startThread(file, null, null));

    const onToolCall = (p: Obj, t: number, session: string) => {
      const addTool = (name: string) => emit({ type: "tool", session, t, name, category: toolCategory(name) });
      const addPatch = (text: string) => {
        for (const path of patchFiles(text)) emit({ type: "edit", session, t, file: basename(path) });
      };
      const kind = p.type;
      const name = str(p.name);
      if (kind === "local_shell_call") return addTool("shell");
      if (kind === "custom_tool_call") {
        const input = typeof p.input === "string" ? p.input : "";
        if (name === "exec") {
          // Code mode: one exec call runs JavaScript that calls tools.<name>(...).
          const inner = [...input.matchAll(CODE_MODE_TOOL)].map((m) => m[1]!);
          if (inner.length === 0) addTool("exec");
          for (const n of inner) addTool(n);
          addPatch(input);
          return;
        }
        if (name) addTool(name);
        if (name === "apply_patch") addPatch(input);
        return;
      }
      // function_call
      if (!name) return;
      const args = parseArgs(p.arguments);
      const command = Array.isArray(args?.command) ? args.command.filter((c) => typeof c === "string") : null;
      if (command && command[0] === "apply_patch") {
        addTool("apply_patch");
        addPatch(command.slice(1).join("\n"));
        return;
      }
      addTool(name);
      if (name === "apply_patch") addPatch(str(args?.input) ?? (typeof p.arguments === "string" ? p.arguments : ""));
    };

    const onEvent = (e: Obj) => {
      const type = e.type;
      if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
        countUnknown(warnings, `codex:${typeof type === "string" ? type : "(no type)"}`);
        return;
      }
      const p = obj(e.payload) ?? {};
      const t = parseTime(e.timestamp);

      if (type === "session_meta") {
        // Forked and subagent rollouts repeat the parent's session_meta after their own.
        if (thread) return;
        const id = str(p.id) ?? str(p.session_id) ?? file;
        const spawn = obj(obj(obj(p.source)?.subagent)?.thread_spawn);
        const parent = str(p.parent_thread_id) ?? str(spawn?.parent_thread_id);
        const source = typeof p.source === "string" ? p.source.toLowerCase() : spawn ? "subagent" : null;
        thread = startThread(id, parent, source);
        cwd = str(p.cwd);
        repoUrl = str(obj(p.git)?.repository_url);
        model = str(p.model) ?? model;
      }
      const session = ensureThread();
      if (t === null) return;

      // A new turn or a tool call makes the thread count, even a call with no name.
      const turnId = type === "event_msg" && p.type === "task_started" ? str(p.turn_id) : null;
      const newTurn = type === "event_msg" && p.type === "task_started" && !(turnId && seenTurns.has(turnId));
      const isCall =
        type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call");
      // Forked rollouts replay the parent's tool calls. Count each call once.
      const callId = isCall ? (str(p.call_id) ?? str(p.id)) : null;
      const newCall = isCall && !(callId && seenCalls.has(callId));
      emit({ type: "tick", session, t, cwd, repoUrl, active: newTurn || newCall });

      if (type === "turn_context") {
        model = str(p.model) ?? model;
        cwd = str(p.cwd) ?? cwd;
        return;
      }

      if (type === "event_msg") {
        if (p.type === "token_count") {
          const info = obj(p.info);
          if (!info) return;
          const total = obj(info.total_token_usage);
          const totalTokens = total ? num(total.total_tokens) : null;
          // token_count is emitted again with an unchanged running total. Skip repeats.
          if (totalTokens !== null && totalTokens === prevTotal) return;
          let use = obj(info.last_token_usage);
          if (!use && total) {
            use = {};
            for (const k of Object.keys(total)) use[k] = num(total[k]) - num(prevTotalUsage?.[k]);
          }
          prevTotal = totalTokens;
          prevTotalUsage = total;
          if (!use) return;
          const tokenKey = `${session}|${String(e.timestamp)}|${totalTokens ?? JSON.stringify(use)}`;
          if (seenTokenEvents.has(tokenKey)) return;
          seenTokenEvents.add(tokenKey);
          const input = num(use.input_tokens);
          const cached = num(use.cached_input_tokens);
          const cacheWrite = num(use.cache_write_input_tokens);
          const output = num(use.output_tokens);
          if (input + output === 0) return;
          // OpenAI input_tokens includes cached and cache-write tokens.
          const usage = { input: Math.max(0, input - cached - cacheWrite), output, cacheRead: cached, cacheWrite, cacheWriteLong: 0 };
          emit({ type: "usage", session, t, model: model ?? "unknown", usage, cwd, repoUrl });
          return;
        }
        if (p.type === "task_started") {
          if (!newTurn) return;
          if (turnId) seenTurns.add(turnId);
          const trigger = str(obj(p.turn_attribution)?.turn_trigger);
          if (!trigger || trigger === "composer" || trigger === "queue") turnStarts.push(t);
          return;
        }
        if (p.type === "user_message") userMessages.push(t);
        return;
      }

      if (newCall) {
        if (callId) seenCalls.add(callId);
        onToolCall(p, t, session);
      }
    };

    await readJsonl(file, warnings, onEvent);

    // Older versions have no task_started; fall back to user_message events.
    const session = ensureThread();
    for (const t of turnStarts.length > 0 ? turnStarts : userMessages) prompts.push({ session, t });
  }

  for (const p of prompts) emit({ type: "prompt", ...p });
}

/** A Codex home: sessions/YYYY/MM/DD/rollout-*.jsonl. */
export async function looksLikeCodexHome(root: string): Promise<boolean> {
  const sessions = join(root, "sessions");
  for (const y of (await dirNames(sessions)).filter((n) => /^\d{4}$/.test(n))) {
    for (const m of (await dirNames(join(sessions, y))).filter((n) => /^\d{2}$/.test(n))) {
      for (const d of (await dirNames(join(sessions, y, m))).filter((n) => /^\d{2}$/.test(n))) {
        try {
          if ((await readdir(join(sessions, y, m, d))).some((f) => /^rollout-.*\.jsonl$/.test(f))) return true;
        } catch {
          // Unreadable day folder.
        }
      }
    }
  }
  return false;
}

const SUBDIRS = ["sessions", "archived_sessions"];

/** $CODEX_HOME, ~/.codex, saved folders, CODEX_HOME values in shell files, and folders named .codex* or codex*. */
function discover(ctx: DiscoverContext): Candidate[] {
  const at = (root: string, via: Candidate["via"], verify = false): Candidate => ({
    root,
    dirs: SUBDIRS.map((s) => join(resolve(root), s)),
    via,
    verify,
  });
  const fromEnv = ctx.env.CODEX_HOME?.trim();
  return [
    ...(fromEnv ? [at(fromEnv, "env")] : []),
    at(join(ctx.home, ".codex"), "default"),
    ...ctx.saved.map((r) => at(r, "saved")),
    ...ctx.shellValues("CODEX_HOME").map((r) => at(r, "shell", true)),
    ...ctx.homeFolders.filter((p) => /^\.?codex/i.test(fileName(p))).map((r) => at(r, "scan", true)),
  ];
}

export const codex: Adapter = {
  id: "codex",
  shellVars: ["CODEX_HOME"],
  subdirs: SUBDIRS,
  discover,
  looksLike: looksLikeCodexHome,
  listFiles: listAll,
  countSessions: (_dirs, files) => files.filter((f) => fileName(f).startsWith("rollout-")).length,
  parse,
};
