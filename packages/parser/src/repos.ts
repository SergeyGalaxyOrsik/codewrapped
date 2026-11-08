import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Maps a working directory to a repository name, or null when it is not a
 * repository. Only the name is kept: no owner, no path.
 */
export type RepoResolver = (cwd: string | null) => string | null;

/** owner/name from a remote URL: git@github.com:o/name.git, https://host/o/name, ... */
export function repoNameFromUrl(url: string): string | null {
  const clean = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const name = clean.split(/[/:]/).pop();
  return name ? name : null;
}

const TEMP_DIRS = [/^\/tmp\//, /^\/private\/tmp\//, /^\/private\/var\/folders\//, /^\/var\/folders\//, /[\\/]Temp[\\/]/i];

/**
 * Name from the path alone, for folders that no longer exist. Agent
 * worktrees map to their repository; temporary folders are not repositories.
 */
export function repoNameFromPath(cwd: string | null): string | null {
  if (!cwd) return null;
  if (TEMP_DIRS.some((re) => re.test(cwd))) return null;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  // repo/.claude/worktrees/feature -> repo
  const claudeWt = parts.findIndex((p, i) => p === ".claude" && parts[i + 1] === "worktrees");
  if (claudeWt > 0) return parts[claudeWt - 1] ?? null;
  // ~/.codex/worktrees/<id>/repo -> repo
  const codexWt = parts.findIndex((p, i) => p === ".codex" && parts[i + 1] === "worktrees");
  if (codexWt >= 0) return parts[codexWt + 3] ?? null;
  return parts[parts.length - 1] ?? null;
}

/** Finds the git directory shared by all worktrees of the repository at root. */
function commonGitDir(root: string): string | null {
  const dotGit = join(root, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    // A worktree has a .git file: "gitdir: <path>", with a commondir file inside.
    const m = /gitdir:\s*(.+)/.exec(readFileSync(dotGit, "utf8"));
    if (!m) return null;
    const gitDir = resolve(root, m[1]!.trim());
    const commondir = join(gitDir, "commondir");
    return existsSync(commondir) ? resolve(gitDir, readFileSync(commondir, "utf8").trim()) : gitDir;
  } catch {
    return null;
  }
}

function originName(gitDir: string): string | null {
  try {
    const config = readFileSync(join(gitDir, "config"), "utf8");
    const origin = /\[remote "origin"\]([^[]*)/.exec(config)?.[1] ?? /\[remote "[^"]+"\]([^[]*)/.exec(config)?.[1];
    const url = origin && /^\s*url\s*=\s*(.+)$/m.exec(origin)?.[1];
    return url ? repoNameFromUrl(url) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves repositories on this machine: walks up from cwd to the git root
 * and reads the origin remote from .git/config. Without a remote, the root
 * folder's name is used. Folders that are gone fall back to the path.
 * Results are cached per cwd.
 */
export function createGitRepoResolver(): RepoResolver {
  const cache = new Map<string, string | null>();
  return (cwd) => {
    if (!cwd) return null;
    const cached = cache.get(cwd);
    if (cached !== undefined) return cached;
    let name: string | null;
    if (!existsSync(cwd)) {
      name = repoNameFromPath(cwd);
    } else {
      name = null;
      let dir = resolve(cwd);
      for (;;) {
        if (existsSync(join(dir, ".git"))) {
          // For a worktree, name it after the main checkout's folder when there is no remote.
          const gitDir = commonGitDir(dir);
          const mainRoot = gitDir && gitDir.endsWith(".git") ? dirname(gitDir) : dir;
          name = (gitDir && originName(gitDir)) ?? (basename(mainRoot) || null);
          break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    cache.set(cwd, name);
    return name;
  };
}
