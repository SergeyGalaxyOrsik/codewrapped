import type { DailyAggregate } from "@codewrapped/stats";
import { DayBuilder, type Session, type TimelineEvent } from "./builder";
import type { LocalClock } from "./clock";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "./lines";
import { repoNameFromPath, repoNameFromUrl, type RepoResolver } from "./repos";

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

type Thread = {
  id: string;
  parent: string | null;
  /** session_meta source: "cli", "vscode", "exec", "mcp", or a subagent object. */
  source: string | null;
  events: TimelineEvent[];
  active: boolean;
};

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

export async function parseCodex(
  files: readonly string[],
  clock: LocalClock,
  warnings: ParseWarnings,
  repoOf: RepoResolver = repoNameFromPath,
): Promise<DailyAggregate[]> {
  const out = new DayBuilder("codex", clock);
  const threads = new Map<string, Thread>();
  const seenCalls = new Set<string>();
  const seenTurns = new Set<string>();
  // A rollout copied into a second folder must not count twice.
  const seenTokenEvents = new Set<string>();
  const prompts: Array<{ thread: Thread; t: number }> = [];

  for (const file of files) {
    let thread: Thread | null = null;
    let cwd: string | null = null;
    /** From session_meta.git.repository_url when present. */
    let metaRepo: string | null = null;
    let model: string | null = null;
    const repo = () => metaRepo ?? repoOf(cwd);
    let prevTotal: number | null = null;
    let prevTotalUsage: Obj | null = null;
    const turnStarts: number[] = [];
    const userMessages: number[] = [];

    const ensureThread = (): Thread => {
      if (!thread) {
        thread = threads.get(file) ?? { id: file, parent: null, source: null, events: [], active: false };
        threads.set(thread.id, thread);
      }
      return thread;
    };

    const addTool = (t: number, name: string) => out.addTool(t, name);
    const addPatch = (t: number, text: string) => {
      for (const path of patchFiles(text)) out.addFileEdit(t, path);
    };

    const onToolCall = (p: Obj, t: number) => {
      const kind = p.type;
      const name = str(p.name);
      if (kind === "local_shell_call") return addTool(t, "shell");
      if (kind === "custom_tool_call") {
        const input = typeof p.input === "string" ? p.input : "";
        if (name === "exec") {
          // Code mode: one exec call runs JavaScript that calls tools.<name>(...).
          const inner = [...input.matchAll(CODE_MODE_TOOL)].map((m) => m[1]!);
          if (inner.length === 0) addTool(t, "exec");
          for (const n of inner) addTool(t, n);
          addPatch(t, input);
          return;
        }
        if (name) addTool(t, name);
        if (name === "apply_patch") addPatch(t, input);
        return;
      }
      // function_call
      if (!name) return;
      const args = parseArgs(p.arguments);
      const command = Array.isArray(args?.command) ? args.command.filter((c) => typeof c === "string") : null;
      if (command && command[0] === "apply_patch") {
        addTool(t, "apply_patch");
        addPatch(t, command.slice(1).join("\n"));
        return;
      }
      addTool(t, name);
      if (name === "apply_patch") addPatch(t, str(args?.input) ?? (typeof p.arguments === "string" ? p.arguments : ""));
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
        thread = threads.get(id) ?? { id, parent, source, events: [], active: false };
        thread.parent ??= parent;
        thread.source ??= source;
        threads.set(id, thread);
        cwd = str(p.cwd);
        const url = str(obj(p.git)?.repository_url);
        metaRepo = url ? repoNameFromUrl(url) : null;
        model = str(p.model) ?? model;
      }
      const th = ensureThread();
      if (t === null) return;
      th.events.push({ t, repo: repo() });

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
          const tokenKey = `${th.id}|${String(e.timestamp)}|${totalTokens ?? JSON.stringify(use)}`;
          if (seenTokenEvents.has(tokenKey)) return;
          seenTokenEvents.add(tokenKey);
          const input = num(use.input_tokens);
          const cached = num(use.cached_input_tokens);
          const cacheWrite = num(use.cache_write_input_tokens);
          const output = num(use.output_tokens);
          if (input + output === 0) return;
          // OpenAI input_tokens includes cached and cache-write tokens.
          out.addUsage(t, model ?? "unknown", {
            input: Math.max(0, input - cached - cacheWrite),
            output,
            cacheRead: cached,
            cacheWrite,
            cacheWriteLong: 0,
          }, repo());
          th.active = true;
          return;
        }
        if (p.type === "task_started") {
          const turnId = str(p.turn_id);
          if (turnId) {
            if (seenTurns.has(turnId)) return;
            seenTurns.add(turnId);
          }
          const trigger = str(obj(p.turn_attribution)?.turn_trigger);
          if (!trigger || trigger === "composer" || trigger === "queue") turnStarts.push(t);
          th.active = true;
          return;
        }
        if (p.type === "user_message") userMessages.push(t);
        return;
      }

      if (type === "response_item") {
        const kind = p.type;
        if (kind !== "function_call" && kind !== "custom_tool_call" && kind !== "local_shell_call") return;
        // Forked rollouts replay the parent's tool calls. Count each call once.
        const callId = str(p.call_id) ?? str(p.id);
        if (callId) {
          if (seenCalls.has(callId)) return;
          seenCalls.add(callId);
        }
        th.active = true;
        onToolCall(p, t);
      }
    };

    await readJsonl(file, warnings, onEvent);

    // Older versions have no task_started; fall back to user_message events.
    const th = ensureThread();
    for (const t of turnStarts.length > 0 ? turnStarts : userMessages) prompts.push({ thread: th, t });
  }

  // Subagent threads belong to the session of their root thread.
  const rootOf = (thread: Thread): string => {
    let id = thread.id;
    let parent = thread.parent;
    const seen = new Set([id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      id = parent;
      parent = threads.get(parent)?.parent ?? null;
    }
    return id;
  };

  const sessions = new Map<string, Session>();
  const sessionOf = (thread: Thread): Session => {
    const root = rootOf(thread);
    let s = sessions.get(root);
    if (!s) {
      const source = threads.get(root)?.source ?? null;
      s = { events: [], active: false, automated: source !== null && AUTOMATED_SOURCES.has(source), prompts: [] };
      sessions.set(root, s);
    }
    return s;
  };
  for (const thread of threads.values()) {
    const s = sessionOf(thread);
    for (const ev of thread.events) s.events.push(ev);
    s.active ||= thread.active;
  }
  for (const { thread, t } of prompts) if (thread.parent === null) sessionOf(thread).prompts.push(t);
  for (const s of sessions.values()) out.addSession(s);
  return out.result();
}
