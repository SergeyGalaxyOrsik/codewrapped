import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { site } from "@codewrapped/brand";

export type Config = {
  /** Random id for this computer. Rows from different computers add up on the server. */
  machineId: string;
  /** Set after the user agrees to the first upload. */
  syncConsentAt?: string;
  /** Last local day uploaded, per API. */
  lastSyncedDay?: Record<string, string>;
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

export async function saveConfig(config: Config, dir = configDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export async function loadAuth(dir = configDir()): Promise<AuthFile | null> {
  return readJson<AuthFile>(join(dir, "auth.json"));
}

/** The token file is readable by this user only. */
export async function saveAuth(auth: AuthFile, dir = configDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "auth.json");
  await writeFile(path, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function removeAuth(dir = configDir()): Promise<void> {
  await rm(join(dir, "auth.json"), { force: true });
}
