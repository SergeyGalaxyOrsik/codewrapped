import { basename as fileName, relative, sep } from "node:path";
import type { DailyAggregate, SourceFilter } from "@codewrapped/stats";
import { parseClaude } from "./claude";
import { LocalClock, systemTimeZone } from "./clock";
import { parseCodex } from "./codex";
import { findLogFolders, listAll, type FolderOverrides, type LogFolders, type LogRoot } from "./discover";
import { emptyWarnings, type ParseWarnings } from "./lines";
import type { RepoResolver } from "./repos";

export { LocalClock, systemTimeZone } from "./clock";
export {
  findLogFolders,
  folderVarsFromShell,
  listAll,
  listJsonl,
  looksLikeClaudeHome,
  looksLikeCodexHome,
  SHELL_FILES,
  type Agent,
  type FolderOrigin,
  type FolderOverrides,
  type LogFolders,
  type LogRoot,
} from "./discover";
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
  /** Account folders of the agents in this run, with their sessions. */
  roots: Array<LogRoot & { sessions: number }>;
  claudeFiles: string[];
  codexFiles: string[];
};

/** Main session files: projects/<project>/<id>.jsonl for Claude Code (not subagents), rollout-*.jsonl for Codex. */
function countSessions(root: LogRoot, files: string[]): number {
  return files.filter((f) => {
    const dir = root.dirs.find((d) => f.startsWith(`${d}${sep}`));
    if (!dir) return false;
    return root.agent === "claude" ? relative(dir, f).split(sep).length === 2 : fileName(f).startsWith("rollout-");
  }).length;
}

/** Finds the log files on this machine. */
export async function findLocalLogs(
  source: SourceFilter = "all",
  overrides: FolderOverrides = {},
  env = process.env,
  home?: string,
): Promise<LocalLogs> {
  const folders = await findLogFolders(env, home, overrides);
  const used = folders.roots.filter((r) => source === "all" || r.agent === source);
  const roots = await Promise.all(used.map(async (r) => ({ ...r, sessions: countSessions(r, await listAll(r.dirs)) })));
  return {
    folders,
    roots,
    claudeFiles: source === "codex" ? [] : await listAll(folders.claude),
    codexFiles: source === "claude" ? [] : await listAll(folders.codex),
  };
}
