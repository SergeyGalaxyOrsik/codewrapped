import { lstat, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAuth, loadConfig, saveAuth, saveConfig } from "../src/config";

const auth = { token: "cwt_secret", handle: "me", apiUrl: "https://api.example.com", createdAt: "2026-11-09T00:00:00.000Z" };
const mode = async (p: string) => (await stat(p)).mode & 0o777;

describe.skipIf(process.platform === "win32")("config files", () => {
  it("keeps the token and the config readable by this user only", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "cw-config-")), "codewrapped");
    await saveAuth(auth, dir);
    await loadConfig(dir);
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(join(dir, "auth.json"))).toBe(0o600);
    expect(await mode(join(dir, "config.json"))).toBe(0o600);
    expect(await loadAuth(dir)).toEqual(auth);
  });

  it("tightens a config folder made by an older version", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "cw-config-")), "codewrapped");
    await mkdir(dir, { mode: 0o755 });
    await saveConfig({ machineId: "m" }, dir);
    expect(await mode(dir)).toBe(0o700);
  });

  it("replaces a symlink at auth.json instead of writing through it", async () => {
    const base = await mkdtemp(join(tmpdir(), "cw-config-"));
    const dir = join(base, "codewrapped");
    await mkdir(dir, { recursive: true });
    const victim = join(base, "victim.txt");
    await writeFile(victim, "keep me\n", { mode: 0o644 });
    await symlink(victim, join(dir, "auth.json"));

    await saveAuth(auth, dir);
    expect(await readFile(victim, "utf8")).toBe("keep me\n");
    expect(await mode(victim)).toBe(0o644);
    expect((await lstat(join(dir, "auth.json"))).isFile()).toBe(true);
    expect(await mode(join(dir, "auth.json"))).toBe(0o600);
    expect(await readdir(dir)).toEqual(["auth.json"]);
  });
});
