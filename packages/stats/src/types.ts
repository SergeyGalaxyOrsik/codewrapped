/**
 * Harnesses with a shipped adapter. The id is stored with every synced row,
 * so the API must accept a new id before any CLI sends it.
 */
export const SOURCES = ["claude", "codex"] as const;
export type Source = (typeof SOURCES)[number];

/** Display names. */
export const SOURCE_NAMES: Record<Source, string> = { claude: "Claude Code", codex: "Codex" };

/** "Claude Code and Codex": every supported harness, as plain text. */
export const SUPPORTED_HARNESSES = SOURCES.map((s) => SOURCE_NAMES[s]).join(", ").replace(/, ([^,]*)$/, " and $1");

export type TokenCounts = {
  /** Uncached input tokens. For Codex, cached tokens are subtracted from input_tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Activity in one git repository. Key is the repository name only. */
export type RepoUsage = {
  /** Session minutes in interactive sessions. */
  minutes: number;
  /** input + output + cache writes, from all sessions. */
  tokens: number;
};

export type ModelUsage = {
  /** input + output + cache writes. Cache reads are counted separately. */
  tokens: number;
  cacheRead: number;
  /** All four buckets at API prices. null when the model has no known price. */
  costUsd: number | null;
};

/**
 * Activity from sessions nobody typed into: `claude -p`, the Agent SDK,
 * `codex exec`. Kept apart so headline time stays human time.
 */
export type AutomatedActivity = {
  sessions: number;
  messages: number;
  activeMask: string;
  agentMinutes: number;
  longestSessionMinutes: number;
  /** Most sessions at once counting interactive and automated together. */
  peakSessionsAll: number;
  /** Session minutes per repository. */
  repoMinutes: Record<string, number>;
};

/**
 * One day of activity for one source on one machine. This is the only shape
 * that leaves the parser and the only shape that is synced to the server.
 * It holds counts only: no message text, no prompts, no code, no full paths.
 */
export type DailyAggregate = {
  /** YYYY-MM-DD in the user's local timezone. */
  day: string;
  source: Source;
  /** Interactive sessions that started on this day. */
  sessions: number;
  /** Prompts sent by the user in interactive sessions (not tool results, not system notices). */
  messages: number;
  /**
   * Wall-clock minutes with any active session, as a base64 1440 bit mask
   * (see mask.ts). OR across sources and machines for the union.
   */
  activeMask: string;
  /** Active minutes summed over sessions. Parallel sessions each count. */
  agentMinutes: number;
  /** Most sessions active at the same moment on this day. */
  peakSessions: number;
  /** Active minutes of the longest session that started on this day. */
  longestSessionMinutes: number;
  tokens: TokenCounts;
  models: Record<string, ModelUsage>;
  tools: Record<string, number>;
  /** Edits per file. Key is the basename only. */
  files: Record<string, number>;
  /**
   * Per git repository: name only (no owner, no path). Minutes are from
   * interactive sessions, tokens from all sessions.
   */
  repos: Record<string, RepoUsage>;
  /**
   * Time fields above (sessions, messages, activeMask, agentMinutes,
   * peakSessions, longestSessionMinutes, repo minutes) cover interactive
   * sessions only. Tokens, models, tools and files cover all sessions.
   */
  automated: AutomatedActivity;
  schemaVersion: 1;
};

export type Period = "7d" | "30d" | "90d" | "year" | "all";
export const PERIODS: readonly Period[] = ["7d", "30d", "90d", "year", "all"];

export type SourceFilter = Source | "all";

/** Tokens shown as the headline number: everything except cache reads. */
export function headlineTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite;
}
