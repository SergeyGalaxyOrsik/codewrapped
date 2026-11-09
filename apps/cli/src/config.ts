import type { Source } from "@codewrapped/stats";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { site } from "@codewrapped/brand";

export type Config = {
  /** Random id for this computer. Rows from different computers add up on the server. */
  machineId: string;
  /** Set after the user agrees to the first upload. */
  syncConsentAt?: string;
  /** Last local day uploaded, per API. Written for older CLI versions; this one reads lastSyncedDays. */
  lastSyncedDay?: Record<string, string>;
  /** Last local day uploaded, per API and harness. A harness without one uploads its whole history. */
  lastSyncedDays?: Record<string, Partial<Record<Source, string>>>;
  /** Account folders with logs found on earlier runs. Read again by later runs and sync. Never uploaded. */
  logFolders?: Partial<Record<Source, string[]>>;
};

export type AuthFile = { token: string; handle: string | null; apiUrl: string; createdAt: string };

export function configDir(env = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "codewrapped");
}

export function apiUrl(env = process.env): string {
  return (env.CODEWRAPPED_API_URL || site.apiUrl).replace(/\/$/, "");
}

/** The site that belongs to an API: api.example.com -> example.com. */
export function webUrlFor(api: string): string {
  return api === site.apiUrl ? site.url : api.replace("://api.", "://");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function loadConfig(dir = configDir()): Promise<Config> {
  const existing = await readJson<Config>(join(dir, "config.json"));
  if (existing?.machineId) return existing;
  const config: Config = { machineId: randomBytes(16).toString("base64url") };
  await saveConfig(config, dir);
  return config;
}

/**
 * Writes a file in the config folder readable by this user only. The data
 * goes to a new file first (O_EXCL, so a planted symlink is never followed)
 * and is renamed over the old one, which also replaces a symlink rather than
 * writing through it.
 */
async function writePrivate(dir: string, name: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, name);
  const temp = join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

export async function saveConfig(config: Config, dir = configDir()): Promise<void> {
  await writePrivate(dir, "config.json", config);
}

export async function loadAuth(dir = configDir()): Promise<AuthFile | null> {
  return readJson<AuthFile>(join(dir, "auth.json"));
}

export async function saveAuth(auth: AuthFile, dir = configDir()): Promise<void> {
  await writePrivate(dir, "auth.json", auth);
}

export async function removeAuth(dir = configDir()): Promise<void> {
  await rm(join(dir, "auth.json"), { force: true });
}
