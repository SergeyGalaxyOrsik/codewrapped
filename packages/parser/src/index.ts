import { SOURCES, type DailyAggregate, type Source, type SourceFilter } from "@codewrapped/stats";
import { ADAPTERS } from "./adapters";
import { Aggregator } from "./aggregate";
import { LocalClock, systemTimeZone } from "./clock";
import { findLogFolders, type FolderOverrides, type LogFolders, type LogRoot } from "./discover";
import { emptyWarnings, type ParseWarnings } from "./lines";
import type { RepoResolver } from "./repos";

export { LocalClock, systemTimeZone } from "./clock";
export type { Adapter, Candidate, DiscoverContext, Emit, FolderOrigin, HarnessEvent } from "./adapter";
export { ADAPTER, ADAPTERS } from "./adapters";
export { looksLikeClaudeHome } from "./adapters/claude";
export { looksLikeCodexHome, patchFiles } from "./adapters/codex";
export { cursorAppDirs, cursorToolCategory, looksLikeCursorHome } from "./adapters/cursor";
export { looksLikeOpencodeHome } from "./adapters/opencode";
export { looksLikePiHome } from "./adapters/pi";
export { looksLikeZcodeHome } from "./adapters/zcode";
export { applyWal, openInPlace, openSnapshot, type SqliteSnapshot } from "./sqlite";
export { Aggregator } from "./aggregate";
export {
  findLogFolders,
  folderVarsFromShell,
  shellVarValues,
  SHELL_FILES,
  type FolderOverrides,
  type LogFolders,
  type LogRoot,
} from "./discover";
export { listAll, listJsonl } from "./files";
export { MAX_GAP_MS, basename } from "./builder";
export { createGitRepoResolver, repoNameFromPath, repoNameFromUrl, type RepoResolver } from "./repos";
export type { ParseWarnings } from "./lines";

export type ParseOptions = {
  /** Log files per harness, as listed by findLocalLogs. */
  files: Partial<Record<Source, readonly string[]>>;
  timeZone?: string;
  /** Maps cwd to a repository name. Defaults to a guess from the path. */
  repoResolver?: RepoResolver;
};

export type ParseResult = {
  aggregates: DailyAggregate[];
  warnings: Record<Source, ParseWarnings>;
};

/** Parses the given log files into daily aggregates in the given timezone. */
export async function parseFiles(opts: ParseOptions): Promise<ParseResult> {
  const clock = new LocalClock(opts.timeZone ?? systemTimeZone());
  const warnings = Object.fromEntries(SOURCES.map((s) => [s, emptyWarnings()])) as Record<Source, ParseWarnings>;
  const aggregates: DailyAggregate[] = [];
  for (const adapter of ADAPTERS) {
    const agg = new Aggregator(adapter.id, clock, opts.repoResolver);
    await adapter.parse(opts.files[adapter.id] ?? [], agg.emit, warnings[adapter.id]);
    aggregates.push(...agg.result());
  }
  return { aggregates, warnings };
}

export type LocalLogs = {
  folders: LogFolders;
  /** Account folders of the harnesses in this run, with their sessions. */
  roots: Array<LogRoot & { sessions: number }>;
  /** Log files per harness. Empty for harnesses left out by the source filter. */
  files: Record<Source, string[]>;
};

/** Finds the log files on this machine. */
export async function findLocalLogs(
  source: SourceFilter = "all",
  overrides: FolderOverrides = {},
  env = process.env,
  home?: string,
): Promise<LocalLogs> {
  const folders = await findLogFolders(env, home, overrides);
  const included = ADAPTERS.filter((a) => source === "all" || a.id === source);
  const roots = await Promise.all(
    folders.roots.flatMap((r) => {
      const adapter = included.find((a) => a.id === r.agent);
      return adapter ? [adapter.listFiles(r.dirs).then(async (files) => ({ ...r, sessions: await adapter.countSessions(r.dirs, files) }))] : [];
    }),
  );
  const files = Object.fromEntries(
    await Promise.all(ADAPTERS.map(async (a) => [a.id, included.includes(a) ? await a.listFiles(folders.dirs[a.id]) : []] as const)),
  ) as Record<Source, string[]>;
  return { folders, roots, files };
}
