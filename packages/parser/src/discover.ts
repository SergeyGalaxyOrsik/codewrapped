import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Source } from "@codewrapped/stats";
import type { Adapter, FolderOrigin } from "./adapter";
import { ADAPTERS } from "./adapters";
import { dirNames, isDir } from "./files";

/** One account's log folder: ~/.claude-work for Claude Code, ~/.codex for Codex. */
export type LogRoot = {
  agent: Source;
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
  /** Log folders per harness. */
  dirs: Record<Source, string[]>;
};

export type FolderOverrides = {
  /** Replace auto-detection for a harness: --claude-dir, --codex-dir. An account folder or its log folder. */
  dirs?: Partial<Record<Source, readonly string[]>>;
  /** Account folders found on earlier runs. Used again while they still hold logs. */
  saved?: Partial<Record<Source, readonly string[]>>;
  /** Look for more account folders in the home directory and shell config files. Default true. */
  scan?: boolean;
};

const bySource = <T>(make: (a: Adapter) => T) => Object.fromEntries(ADAPTERS.map((a) => [a.id, make(a)])) as Record<Source, T>;

/** For a user-given dir: use its log sub-folders if they exist, otherwise the dir itself. */
async function expand(dir: string, subdirs: readonly string[]): Promise<string[]> {
  const subs = subdirs.map((s) => join(dir, s));
  const found = (await Promise.all(subs.map(isDir))).some(Boolean);
  return found ? subs : [dir];
}

/** Folders one level deep in ~ and ~/.config, sorted by name within each. Adapters pick theirs by name. */
async function scanHome(home: string): Promise<string[]> {
  const out: string[] = [];
  for (const base of [home, join(home, ".config")]) {
    for (const name of (await dirNames(base)).sort()) out.push(join(base, name));
  }
  return out;
}

/** Shell config files that may set CLAUDE_CONFIG_DIR, CODEX_HOME and the like. */
export const SHELL_FILES = [".zshrc", ".bashrc", ".zprofile", join(".config", "fish", "config.fish")];

/**
 * Values of one variable set in shell config text, including inside
 * aliases: `export X=~/a`, `alias c='X=~/a claude'`, fish `set -gx X ~/a`.
 * Only values that look like a path under the home directory or an absolute
 * path are kept. Nothing else in the text is kept.
 */
export function shellVarValues(text: string, home: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?:\\b${name}=|\\bset\\s+(?:-[a-zA-Z]+\\s+)*${name}\\s+)(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s'";|&)]+))`, "g");
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    const path = raw.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
    // Values that still hold a variable or are not absolute are skipped.
    if (!path.startsWith("/") || path.includes("$")) continue;
    for (const p of path.split(",").map((s) => s.trim()).filter(Boolean)) if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Folder variables of every adapter in shell config text, e.g. CLAUDE_CONFIG_DIR and CODEX_HOME. */
export function folderVarsFromShell(text: string, home: string): Record<Source, string[]> {
  return bySource((a) => [...new Set(a.shellVars.flatMap((v) => shellVarValues(text, home, v)))]);
}

async function shellTexts(home: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of SHELL_FILES) {
    try {
      out.push(await readFile(join(home, f), "utf8"));
    } catch {
      // No such file.
    }
  }
  return out;
}

/**
 * Account folders that hold logs, for each harness. Each adapter lists its
 * candidates (env, defaults, saved, shell files, a scan of ~ and ~/.config);
 * guesses from shell files and the scan are used only when their content
 * looks right. A --<harness>-dir flag replaces all of this for that harness.
 */
export async function findLogFolders(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  overrides: FolderOverrides = {},
): Promise<LogFolders> {
  const flagged = (a: Adapter) => overrides.dirs?.[a.id] ?? [];
  const needsScan = (overrides.scan ?? true) && !ADAPTERS.every((a) => flagged(a).length > 0);
  const [homeFolders, texts] = needsScan ? await Promise.all([scanHome(home), shellTexts(home)]) : [[], []];
  const checked: string[] = [];
  const roots: LogRoot[] = [];
  const seen = new Set<string>();

  const add = async (a: Adapter, root: string, via: FolderOrigin, dirs: string[], verify: boolean) => {
    // Guesses that do not pan out are not worth listing in "no logs found".
    if (!verify) checked.push(...dirs);
    const real = await realpath(root).catch(() => null);
    if (!real || seen.has(`${a.id}:${real}`)) return;
    const existing: string[] = [];
    for (const d of dirs) if (await isDir(d)) existing.push(await realpath(d));
    if (existing.length === 0) return;
    if (verify && !(await a.looksLike(real))) return;
    seen.add(`${a.id}:${real}`);
    roots.push({ agent: a.id, root: real, dirs: existing, via });
  };

  for (const a of ADAPTERS) {
    if (flagged(a).length > 0) {
      for (const d of flagged(a)) {
        const dir = resolve(d);
        await add(a, dir, "flag", await expand(dir, a.subdirs), false);
      }
      continue;
    }
    const candidates = a.discover({
      env,
      home,
      saved: overrides.saved?.[a.id] ?? [],
      shellValues: (name) => texts.flatMap((t) => shellVarValues(t, home, name)),
      homeFolders,
    });
    for (const c of candidates) await add(a, c.root, c.via, c.dirs, c.verify);
  }

  return {
    checked: [...new Set(checked)],
    roots,
    dirs: bySource((a) => roots.filter((r) => r.agent === a.id).flatMap((r) => r.dirs)),
  };
}
