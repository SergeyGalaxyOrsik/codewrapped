import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Names of folders (and symlinks) in dir, or [] when it cannot be read. */
export async function dirNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
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

/** Lists .jsonl files under several roots, each real file once. */
export async function listAll(roots: readonly string[]): Promise<string[]> {
  const lists = await Promise.all(roots.map(listJsonl));
  return [...new Set(lists.flat())].sort();
}
