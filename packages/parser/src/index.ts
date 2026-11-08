import type { DailyAggregate, SourceFilter } from "@codewrapped/stats";
import { parseClaude } from "./claude";
import { LocalClock, systemTimeZone } from "./clock";
import { parseCodex } from "./codex";
import { findLogFolders, listAll, type FolderOverrides, type LogFolders } from "./discover";
import { emptyWarnings, type ParseWarnings } from "./lines";
import type { RepoResolver } from "./repos";

export { LocalClock, systemTimeZone } from "./clock";
export { findLogFolders, listAll, listJsonl, type FolderOverrides, type LogFolders } from "./discover";
export { parseClaude } from "./claude";
export { parseCodex, patchFiles } from "./codex";
export { MAX_GAP_MS, basename } from "./builder";
export { createGitRepoResolver, repoNameFromPath, repoNameFromUrl, type RepoResolver } from "./repos";
export type { ParseWarnings } from "./lines";

export type ParseOptions = {
  claudeFiles?: readonly string[];
  codexFiles?: readonly string[];
  timeZone?: string;
  /** Maps cwd to a repository name. Defaults to a guess from the path. */
  repoResolver?: RepoResolver;
};

export type ParseResult = {
  aggregates: DailyAggregate[];
  warnings: { claude: ParseWarnings; codex: ParseWarnings };
};

/** Parses the given log files into daily aggregates in the given timezone. */
export async function parseFiles(opts: ParseOptions): Promise<ParseResult> {
  const clock = new LocalClock(opts.timeZone ?? systemTimeZone());
  const warnings = { claude: emptyWarnings(), codex: emptyWarnings() };
  const claude = await parseClaude(opts.claudeFiles ?? [], clock, warnings.claude, opts.repoResolver);
  const codex = await parseCodex(opts.codexFiles ?? [], clock, warnings.codex, opts.repoResolver);
  return { aggregates: [...claude, ...codex], warnings };
}

export type LocalLogs = {
  folders: LogFolders;
  claudeFiles: string[];
  codexFiles: string[];
};

/** Finds the log files on this machine. */
export async function findLocalLogs(
  source: SourceFilter = "all",
  overrides: FolderOverrides = {},
  env = process.env,
): Promise<LocalLogs> {
  const folders = await findLogFolders(env, undefined, overrides);
  return {
    folders,
    claudeFiles: source === "codex" ? [] : await listAll(folders.claude),
    codexFiles: source === "claude" ? [] : await listAll(folders.codex),
  };
}
