import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type LogFolders = {
  /** Every folder that was checked, in order, for "no logs found" messages. */
  checked: string[];
  claude: string[];
  codex: string[];
};

export type FolderOverrides = {
  /** Replace Claude Code auto-detection. A config dir or its projects/ folder. */
  claudeDirs?: readonly string[];
  /** Replace Codex auto-detection. A Codex home or its sessions/ folder. */
  codexDirs?: readonly string[];
};

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Existing folders, resolved through symlinks, each listed once. */
async function existingUnique(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    if (!(await isDir(p))) continue;
    const real = await realpath(p);
    if (!out.includes(real)) out.push(real);
  }
  return out;
}

/** For a user-given dir: use its sub-folders if they exist, otherwise the dir itself. */
async function expand(dir: string, subdirs: string[]): Promise<string[]> {
  const subs = subdirs.map((s) => join(dir, s));
  const found = (await Promise.all(subs.map(isDir))).some(Boolean);
  return found ? subs : [dir];
}

/**
 * Folders that may hold logs.
 *
 * Claude Code: $CLAUDE_CONFIG_DIR (comma separated is allowed), then
 * ~/.claude and ~/.config/claude, each with a projects/ folder. The defaults
 * are read even when the variable is set, since older logs often stay there.
 *
 * Codex: $CODEX_HOME, then ~/.codex, with sessions/ and archived_sessions/.
 *
 * Overrides replace auto-detection for that agent.
 */
export async function findLogFolders(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  overrides: FolderOverrides = {},
): Promise<LogFolders> {
  let claudeCandidates: string[];
  if (overrides.claudeDirs && overrides.claudeDirs.length > 0) {
    claudeCandidates = (await Promise.all(overrides.claudeDirs.map((d) => expand(resolve(d), ["projects"])))).flat();
  } else {
    const homes = [
      ...(env.CLAUDE_CONFIG_DIR ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      join(home, ".claude"),
      join(home, ".config", "claude"),
    ];
    claudeCandidates = homes.map((h) => join(resolve(h), "projects"));
  }

  const codexSubdirs = ["sessions", "archived_sessions"];
  let codexCandidates: string[];
  if (overrides.codexDirs && overrides.codexDirs.length > 0) {
    codexCandidates = (await Promise.all(overrides.codexDirs.map((d) => expand(resolve(d), codexSubdirs)))).flat();
  } else {
    const homes = [env.CODEX_HOME?.trim() || "", join(home, ".codex")].filter(Boolean);
    codexCandidates = homes.flatMap((h) => codexSubdirs.map((s) => join(resolve(h), s)));
  }

  claudeCandidates = [...new Set(claudeCandidates)];
  codexCandidates = [...new Set(codexCandidates)];
  return {
    checked: [...claudeCandidates, ...codexCandidates],
    claude: await existingUnique(claudeCandidates),
    codex: await existingUnique(codexCandidates),
  };
}

/** All .jsonl files under a folder, as real paths, sorted for stable output. */
export async function listJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".jsonl") && (e.isFile() || e.isSymbolicLink())) {
        try {
          if ((await stat(p)).isFile()) out.push(await realpath(p));
        } catch {
          // Broken symlink.
        }
      }
    }
  };
  await walk(root);
  return out.sort();
}

/** Lists files under several roots, each real file once. */
export async function listAll(roots: readonly string[]): Promise<string[]> {
  const lists = await Promise.all(roots.map(listJsonl));
  return [...new Set(lists.flat())].sort();
}
