import type { DailyAggregate, RequestUsage } from "@codewrapped/stats";
import { DayBuilder, type Session } from "./builder";
import type { LocalClock } from "./clock";
import { countUnknown, parseTime, readJsonl, type ParseWarnings } from "./lines";
import { repoNameFromPath, type RepoResolver } from "./repos";

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

type PendingUsage = { t: number; model: string; u: RequestUsage; repo: string | null };

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

export async function parseClaude(
  files: readonly string[],
  clock: LocalClock,
  warnings: ParseWarnings,
  repoOf: RepoResolver = repoNameFromPath,
): Promise<DailyAggregate[]> {
  const out = new DayBuilder("claude", clock);
  const sessions = new Map<string, Session>();
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
    const sessionId = str(e.sessionId);
    const t = parseTime(e.timestamp);
    if (!sessionId || t === null) return;

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
      const seen = entrypoints.get(sessionId);
      entrypoints.set(sessionId, seen === undefined ? isSdk : seen && isSdk);
    }

    const cwd = str(e.cwd);
    if (cwd) lastCwd.set(sessionId, cwd);
    let session = sessions.get(sessionId);
    if (!session) {
      session = { events: [], active: false, automated: false, prompts: [] };
      sessions.set(sessionId, session);
    }
    const repo = repoOf(cwd ?? lastCwd.get(sessionId) ?? null);
    session.events.push({ t, repo });

    if (type === "user") {
      if (isPrompt(e)) {
        session.prompts.push(t);
        session.active = true;
      }
      return;
    }
    if (type !== "assistant") return;

    const message = obj(e.message);
    const model = str(message?.model);
    if (!message || !model || model === "<synthetic>") return;
    session.active = true;

    const rawUsage = obj(message.usage);
    if (rawUsage) {
      const key = `${str(message.id) ?? uuid ?? t}|${str(e.requestId) ?? ""}`;
      const u = readUsage(rawUsage);
      const prev = usage.get(key);
      usage.set(key, prev ? { ...prev, u: maxUsage(prev.u, u) } : { t, model, u, repo });
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
      out.addTool(t, name);
      const pathFields = EDIT_TOOLS[name];
      const input = obj(block.input);
      if (pathFields && input) {
        const path = pathFields.map((f) => str(input[f])).find(Boolean);
        if (path) out.addFileEdit(t, path);
      }
    }
  };

  for (const file of files) await readJsonl(file, warnings, onEvent);

  for (const { t, model, u, repo } of usage.values()) out.addUsage(t, model, u, repo);
  for (const [id, session] of sessions) {
    session.automated = entrypoints.get(id) ?? false;
    out.addSession(session);
  }
  return out.result();
}
