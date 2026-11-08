import { cp, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLocalLogs, findLogFolders, parseFiles } from "../src/index";

const fixtures = join(import.meta.dirname, "../fixtures");

async function tempHome() {
  return mkdtemp(join(tmpdir(), "codewrapped-"));
}

describe("findLogFolders", () => {
  it("reads CLAUDE_CONFIG_DIR and the default folders", async () => {
    const home = await tempHome();
    await mkdir(join(home, "custom", "projects"), { recursive: true });
    await mkdir(join(home, ".claude", "projects"), { recursive: true });
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    const f = await findLogFolders({ CLAUDE_CONFIG_DIR: join(home, "custom") }, home);
    expect(f.claude).toHaveLength(2);
    expect(f.claude[0]).toMatch(/custom\/projects$/);
    expect(f.claude[1]).toMatch(/\.claude\/projects$/);
    expect(f.checked).toContain(join(home, ".config", "claude", "projects"));
    expect(f.codex).toHaveLength(1);
  });

  it("lets --claude-dir and --codex-dir replace auto-detection", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude", "projects"), { recursive: true });
    await mkdir(join(home, "elsewhere", "projects"), { recursive: true });
    await mkdir(join(home, "rollouts"), { recursive: true });
    const f = await findLogFolders({}, home, {
      claudeDirs: [join(home, "elsewhere")],
      codexDirs: [join(home, "rollouts")],
    });
    expect(f.claude).toHaveLength(1);
    expect(f.claude[0]).toMatch(/elsewhere\/projects$/);
    expect(f.codex[0]).toMatch(/rollouts$/);
  });
});

describe("overlapping folders", () => {
  it("never count a log twice, whether copied or symlinked", async () => {
    const home = await tempHome();
    await cp(join(fixtures, "claude"), join(home, "a"), { recursive: true });
    await cp(join(fixtures, "claude"), join(home, "b"), { recursive: true });
    await symlink(join(home, "a"), join(home, "link"));
    await cp(join(fixtures, "codex"), join(home, "cx1"), { recursive: true });
    await cp(join(fixtures, "codex"), join(home, "cx2"), { recursive: true });

    const once = await findLocalLogs("all", { claudeDirs: [join(home, "a")], codexDirs: [join(home, "cx1")] });
    const many = await findLocalLogs("all", {
      claudeDirs: [join(home, "a"), join(home, "b"), join(home, "link")],
      codexDirs: [join(home, "cx1"), join(home, "cx2")],
    });
    // The symlink resolves to a/, so only the copy in b/ adds files.
    expect(many.claudeFiles).toHaveLength(once.claudeFiles.length * 2);

    const parse = (l: typeof once) =>
      parseFiles({ claudeFiles: l.claudeFiles, codexFiles: l.codexFiles, timeZone: "Europe/Berlin" });
    expect((await parse(many)).aggregates).toEqual((await parse(once)).aggregates);
  });
});
