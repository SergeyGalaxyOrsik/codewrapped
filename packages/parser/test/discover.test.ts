import { cp, mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findLocalLogs, findLogFolders, folderVarsFromShell, parseFiles } from "../src/index";

const fixtures = join(import.meta.dirname, "../fixtures");

async function tempHome() {
  // Real path, since macOS puts tmpdir behind a /var -> /private/var symlink.
  return realpath(await mkdtemp(join(tmpdir(), "codewrapped-")));
}

describe("findLogFolders", () => {
  it("reads CLAUDE_CONFIG_DIR and the default folders", async () => {
    const home = await tempHome();
    await mkdir(join(home, "custom", "projects"), { recursive: true });
    await mkdir(join(home, ".claude", "projects"), { recursive: true });
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    const f = await findLogFolders({ CLAUDE_CONFIG_DIR: join(home, "custom") }, home);
    expect(f.dirs.claude).toHaveLength(2);
    expect(f.dirs.claude[0]).toMatch(/custom\/projects$/);
    expect(f.dirs.claude[1]).toMatch(/\.claude\/projects$/);
    expect(f.checked).toContain(join(home, ".config", "claude", "projects"));
    expect(f.dirs.codex).toHaveLength(1);
  });

  it("lets --claude-dir and --codex-dir replace auto-detection", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude", "projects"), { recursive: true });
    await mkdir(join(home, "elsewhere", "projects"), { recursive: true });
    await mkdir(join(home, "rollouts"), { recursive: true });
    const f = await findLogFolders({}, home, { dirs: { claude: [join(home, "elsewhere")], codex: [join(home, "rollouts")] } });
    expect(f.dirs.claude).toHaveLength(1);
    expect(f.dirs.claude[0]).toMatch(/elsewhere\/projects$/);
    expect(f.dirs.codex[0]).toMatch(/rollouts$/);
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

    // The temp home keeps this test away from real logs of the other harnesses.
    const once = await findLocalLogs("all", { dirs: { claude: [join(home, "a")], codex: [join(home, "cx1")] } }, {}, home);
    const many = await findLocalLogs("all", { dirs: { claude: [join(home, "a"), join(home, "b"), join(home, "link")], codex: [join(home, "cx1"), join(home, "cx2")] } }, {}, home);
    // The symlink resolves to a/, so only the copy in b/ adds files.
    expect(many.files.claude).toHaveLength(once.files.claude.length * 2);

    const parse = (l: typeof once) =>
      parseFiles({ files: l.files, timeZone: "Europe/Berlin" });
    expect((await parse(many)).aggregates).toEqual((await parse(once)).aggregates);
  });
});

describe("auto-discovery", () => {
  const claudeLine = '{"type":"user","sessionId":"s1","uuid":"u1","timestamp":"2026-01-14T10:00:00.000Z"}\n';

  async function claudeHome(root: string) {
    await mkdir(join(root, "projects", "-home-dev-shop"), { recursive: true });
    await writeFile(join(root, "projects", "-home-dev-shop", "s1.jsonl"), claudeLine);
  }
  async function codexHome(root: string) {
    await mkdir(join(root, "sessions", "2026", "01", "14"), { recursive: true });
    await writeFile(join(root, "sessions", "2026", "01", "14", "rollout-2026-01-14T10-00-00-t1.jsonl"), "{}\n");
  }

  it("finds extra account folders in ~ and ~/.config by their content", async () => {
    const home = await tempHome();
    await claudeHome(join(home, ".claude"));
    await claudeHome(join(home, ".claude-personal"));
    await claudeHome(join(home, ".config", "claude-work"));
    await codexHome(join(home, ".codex-work"));
    // Names match, content does not: skipped.
    await mkdir(join(home, ".claude-notes", "projects", "x"), { recursive: true });
    await writeFile(join(home, ".claude-notes", "projects", "x", "a.jsonl"), '{"hello":"world"}\n');
    await mkdir(join(home, "codex-stuff", "sessions"), { recursive: true });
    await writeFile(join(home, "codex-stuff", "sessions", "rollout-x.jsonl"), "{}\n");
    // Content matches, name does not: not scanned.
    await claudeHome(join(home, "agents-backup"));

    const f = await findLogFolders({}, home);
    const short = (agent: string) => f.roots.filter((r) => r.agent === agent).map((r) => [r.root.slice(r.root.lastIndexOf("/") + 1), r.via]);
    expect(short("claude")).toEqual([
      [".claude", "default"],
      [".claude-personal", "scan"],
      ["claude-work", "scan"],
    ]);
    expect(short("codex")).toEqual([[".codex-work", "scan"]]);
    expect(f.checked.some((p) => p.includes("claude-notes") || p.includes("codex-stuff"))).toBe(false);
  });

  it("reuses saved folders and lets flags replace everything", async () => {
    const home = await tempHome();
    await claudeHome(join(home, "work", "agent-a"));
    await claudeHome(join(home, ".claude-personal"));
    const saved = await findLogFolders({}, home, { saved: { claude: [join(home, "work", "agent-a")] } });
    expect(saved.roots.map((r) => r.via)).toEqual(["saved", "scan"]);
    const flagged = await findLogFolders({}, home, { dirs: { claude: [join(home, "work", "agent-a")] } });
    expect(flagged.roots.map((r) => r.via)).toEqual(["flag"]);
  });

  it("does not count a folder twice when it is found several ways", async () => {
    const home = await tempHome();
    await claudeHome(join(home, ".claude-personal"));
    await writeFile(join(home, ".zshrc"), "alias cp2='CLAUDE_CONFIG_DIR=~/.claude-personal claude'\n");
    const f = await findLogFolders({ CLAUDE_CONFIG_DIR: join(home, ".claude-personal") }, home);
    expect(f.roots.map((r) => r.via)).toEqual(["env"]);
  });
});

describe("shell config files", () => {
  const rc = [
    "export ANTHROPIC_API_KEY=sk-ant-api03-SECRET-should-never-leak",
    "export OPENAI_API_KEY='sk-proj-ALSO-SECRET'",
    "export GITHUB_TOKEN=ghp_SECRET CLAUDE_CONFIG_DIR=$SECRET_DIR",
    "alias claude-per='CLAUDE_CONFIG_DIR=~/work/claude-a claude'",
    'export CODEX_HOME="$HOME/work/codex-b"',
    "",
  ].join("\n");

  it("keeps only CLAUDE_CONFIG_DIR and CODEX_HOME paths", () => {
    const found = folderVarsFromShell(rc, "/home/dev");
    expect(found).toEqual({ claude: ["/home/dev/work/claude-a"], codex: ["/home/dev/work/codex-b"], pi: [], opencode: [], zcode: [], cursor: [] });
    expect(JSON.stringify(found)).not.toMatch(/SECRET|sk-|ghp_/);
  });

  it("reads fish syntax", () => {
    expect(folderVarsFromShell("set -gx CLAUDE_CONFIG_DIR ~/c2\nset -x CODEX_HOME /opt/cx\n", "/h")).toEqual({ claude: ["/h/c2"], codex: ["/opt/cx"], pi: [], opencode: [], zcode: [], cursor: [] });
  });

  it("uses folders from rc files, prints nothing and returns nothing but paths", async () => {
    const home = await tempHome();
    await mkdir(join(home, "work", "claude-a", "projects", "p"), { recursive: true });
    await writeFile(join(home, "work", "claude-a", "projects", "p", "s.jsonl"), '{"type":"user","sessionId":"s"}\n');
    await writeFile(join(home, ".zshrc"), rc);
    await mkdir(join(home, ".config", "fish"), { recursive: true });
    await writeFile(join(home, ".config", "fish", "config.fish"), "set -gx OPENAI_API_KEY sk-fish-SECRET\n");

    const writes: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation((s) => (writes.push(String(s)), true)),
      vi.spyOn(process.stderr, "write").mockImplementation((s) => (writes.push(String(s)), true)),
      vi.spyOn(console, "log").mockImplementation((...a) => void writes.push(a.join(" "))),
      vi.spyOn(console, "warn").mockImplementation((...a) => void writes.push(a.join(" "))),
    ];
    let f;
    try {
      f = await findLogFolders({}, home);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(writes).toEqual([]);
    expect(f.roots.map((r) => [r.root.endsWith("/work/claude-a"), r.via])).toEqual([[true, "shell"]]);
    expect(JSON.stringify(f)).not.toMatch(/SECRET|sk-|ghp_/);
  });
});
