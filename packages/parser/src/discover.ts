import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type Agent = "claude" | "codex";

/** How a log folder was found. */
export type FolderOrigin = "flag" | "env" | "default" | "saved" | "shell" | "scan";

/** One account's log folder: ~/.claude-work for Claude Code, ~/.codex for Codex. */
export type LogRoot = {
  agent: Agent;
  /** The account folder, resolved through symlinks. */
  root: string;
  /** The folders under it that hold logs: projects/ for Claude Code, sessions/ and archived_sessions/ for Codex. */
  dirs: string[];
  via: FolderOrigin;
};

export type LogFolders = {
  /** Every folder that was checked, in order, for "no logs found" messages. */
  checked: string[];
  /** Every account folder with logs, each once. */
  roots: LogRoot[];
  claude: string[];
  codex: string[];
};

export type FolderOverrides = {
  /** Replace Claude Code auto-detection. A config dir or its projects/ folder. */
  claudeDirs?: readonly string[];
  /** Replace Codex auto-detection. A Codex home or its sessions/ folder. */
  codexDirs?: readonly string[];
  /** Account folders found on earlier runs. Used again while they still hold logs. */
  saved?: { claude?: readonly string[]; codex?: readonly string[] };
  /** Look for more account folders in the home directory and shell config files. Default true. */
  scan?: boolean;
};

const LOG_SUBDIRS: Record<Agent, string[]> = { claude: ["projects"], codex: ["sessions", "archived_sessions"] };

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function dirNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** For a user-given dir: use its sub-folders if they exist, otherwise the dir itself. */
async function expand(dir: string, subdirs: string[]): Promise<string[]> {
  const subs = subdirs.map((s) => join(dir, s));
  const found = (await Promise.all(subs.map(isDir))).some(Boolean);
  return found ? subs : [dir];
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

const looksLike: Record<Agent, (root: string) => Promise<boolean>> = { claude: looksLikeClaudeHome, codex: looksLikeCodexHome };

/** Folders one level deep in ~ and ~/.config whose names start with .claude, claude, .codex or codex. */
async function scanHome(home: string): Promise<Record<Agent, string[]>> {
  const out: Record<Agent, string[]> = { claude: [], codex: [] };
  for (const base of [home, join(home, ".config")]) {
    for (const name of (await dirNames(base)).sort()) {
      const lower = name.toLowerCase();
      if (/^\.?claude/.test(lower)) out.claude.push(join(base, name));
      else if (/^\.?codex/.test(lower)) out.codex.push(join(base, name));
    }
  }
  return out;
}

/** Shell config files that may set CLAUDE_CONFIG_DIR or CODEX_HOME. */
export const SHELL_FILES = [".zshrc", ".bashrc", ".zprofile", join(".config", "fish", "config.fish")];

/**
 * CLAUDE_CONFIG_DIR and CODEX_HOME values set in shell config text, including
 * inside aliases: `export X=~/a`, `alias c='X=~/a claude'`, fish `set -gx X ~/a`.
 * Only those two values are kept, and only when they look like a path under
 * the home directory or an absolute path. Nothing else in the text is kept.
 */
export function folderVarsFromShell(text: string, home: string): Record<Agent, string[]> {
  const out: Record<Agent, string[]> = { claude: [], codex: [] };
  const vars: Array<[Agent, string]> = [
    ["claude", "CLAUDE_CONFIG_DIR"],
    ["codex", "CODEX_HOME"],
  ];
  for (const [agent, name] of vars) {
    const re = new RegExp(`(?:\\b${name}=|\\bset\\s+(?:-[a-zA-Z]+\\s+)*${name}\\s+)(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s'";|&)]+))`, "g");
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      const path = raw.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
      // Values that still hold a variable or are not absolute are skipped.
      if (!path.startsWith("/") || path.includes("$")) continue;
      for (const p of path.split(",").map((s) => s.trim()).filter(Boolean)) if (!out[agent].includes(p)) out[agent].push(p);
    }
  }
  return out;
}

async function shellFolders(home: string): Promise<Record<Agent, string[]>> {
  const out: Record<Agent, string[]> = { claude: [], codex: [] };
  for (const f of SHELL_FILES) {
    let text: string;
    try {
      text = await readFile(join(home, f), "utf8");
    } catch {
      continue;
    }
    const found = folderVarsFromShell(text, home);
    out.claude.push(...found.claude);
    out.codex.push(...found.codex);
  }
  return out;
}

/**
 * Account folders that hold logs, for each agent.
 *
 * Without overrides, in this order: $CLAUDE_CONFIG_DIR (comma separated is
 * allowed) or $CODEX_HOME; the defaults ~/.claude, ~/.config/claude and
 * ~/.codex; folders saved from earlier runs; CLAUDE_CONFIG_DIR and CODEX_HOME
 * values in shell config files; and folders one level deep in ~ and ~/.config
 * named .claude*, claude*, .codex* or codex*. Folders found by the last two are
 * used only when their content looks like Claude Code or Codex logs.
 *
 * --claude-dir and --codex-dir replace all of this for that agent.
 */
export async function findLogFolders(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  overrides: FolderOverrides = {},
): Promise<LogFolders> {
  const needsScan =
    (overrides.scan ?? true) && !(overrides.claudeDirs?.length && overrides.codexDirs?.length);
  const [scanned, shell] = needsScan ? await Promise.all([scanHome(home), shellFolders(home)]) : [null, null];
  const checked: string[] = [];
  const roots: LogRoot[] = [];
  const seen = new Set<string>();

  const add = async (agent: Agent, root: string, via: FolderOrigin, dirs: string[], verify: boolean) => {
    // Guesses that do not pan out are not worth listing in "no logs found".
    if (!verify) checked.push(...dirs);
    const real = await realpath(root).catch(() => null);
    if (!real || seen.has(`${agent}:${real}`)) return;
    const existing: string[] = [];
    for (const d of dirs) if (await isDir(d)) existing.push(await realpath(d));
    if (existing.length === 0) return;
    if (verify && !(await looksLike[agent](real))) return;
    seen.add(`${agent}:${real}`);
    roots.push({ agent, root: real, dirs: existing, via });
  };

  for (const agent of ["claude", "codex"] as const) {
    const flags = agent === "claude" ? overrides.claudeDirs : overrides.codexDirs;
    if (flags && flags.length > 0) {
      for (const d of flags) {
        const dir = resolve(d);
        const dirs = await expand(dir, LOG_SUBDIRS[agent]);
        await add(agent, dir, "flag", dirs, false);
      }
      continue;
    }
    const sub = (root: string) => LOG_SUBDIRS[agent].map((s) => join(resolve(root), s));
    const envRoots =
      agent === "claude"
        ? (env.CLAUDE_CONFIG_DIR ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        : [env.CODEX_HOME?.trim() ?? ""].filter(Boolean);
    const defaults = agent === "claude" ? [join(home, ".claude"), join(home, ".config", "claude")] : [join(home, ".codex")];
    for (const r of envRoots) await add(agent, r, "env", sub(r), false);
    for (const r of defaults) await add(agent, r, "default", sub(r), false);
    for (const r of overrides.saved?.[agent] ?? []) await add(agent, r, "saved", sub(r), false);
    for (const r of shell?.[agent] ?? []) await add(agent, r, "shell", sub(r), true);
    for (const r of scanned?.[agent] ?? []) await add(agent, r, "scan", sub(r), true);
  }

  return {
    checked: [...new Set(checked)],
    roots,
    claude: roots.filter((r) => r.agent === "claude").flatMap((r) => r.dirs),
    codex: roots.filter((r) => r.agent === "codex").flatMap((r) => r.dirs),
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
