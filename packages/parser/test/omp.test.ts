import { copyFile, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTER, findLocalLogs, findLogFolders, listJsonl, parseFiles } from "../src/index";

const fixtures = join(import.meta.dirname, "../fixtures/omp");
const root = join(fixtures, "sessions");
const main = join(root, "-shop", "2026-03-02T09-00-00-000Z_a1f3c9e2.jsonl");

async function parse() {
  return parseFiles({ files: { omp: await listJsonl(root) }, timeZone: "UTC" });
}

describe("omp adapter", () => {
  it("counts a session, its fork and its subagent once each", async () => {
    const { aggregates } = await parse();
    expect(aggregates).toHaveLength(1);
    const row = aggregates[0]!;
    expect(row.source).toBe("omp");
    // a1f3c9e2 with its subagent SwiftFalcon folded in, and the fork b7d4e1f0.
    expect(row.sessions).toBe(2);
    // The typed prompt 0e02 and the /skill:review prompt 0e06, then 0f01 in the fork. The fork's copy of 0e02,
    // the developer notice, the agent-attributed and synthetic user messages and the imported Claude prompt are not.
    expect(row.messages).toBe(3);
    // write xd://ast_grep runs ast_grep; the imported Claude Bash call and the fork's copied calls are not counted.
    expect(row.tools).toEqual({ bash: 1, edit: 3, write: 3, ast_grep: 1, read: 2, task: 1, todo: 1, grep: 1 });
    // rg, ast_grep and grep search. read of an https URL is web. write local://plan.md still counts as an edit call.
    expect(row.toolCategories).toEqual({ search: 3, edit: 6, web: 1, read: 1, subagent: 1, plan: 1 });
    // Hashline headers and MV, apply_patch headers and Move to, a replace path, a write path and a [path#TAG] write.
    expect(row.files).toEqual({ "cart.ts": 3, "tax.ts": 1, "taxes.ts": 1, "basket.ts": 1, "cart.test.ts": 1, "README.md": 1, "util.ts": 1 });
  });

  it("adds orchestration tokens, splits the hour-long cache write, and skips task results and imported history", async () => {
    const row = (await parse()).aggregates[0]!;
    // 0e03 is 100 + 10 input, 50 + 5 output and 400 cache write; the cache warm-up 1 output; the routed reply
    // 1,000,000 input; the fork's reply 200 + 20; the subagent's 300 + 30 and 1000 cache write. The task
    // result's 5,500 and the imported 777 + 77 are not counted.
    expect(row.repos.shop!.tokens).toBe(110 + 55 + 400 + 1 + 1_000_000 + 220 + 1330);
    expect(row.tokens).toMatchObject({ input: 110 + 1_000_000 + 200 + 300, output: 55 + 1 + 20 + 30, cacheRead: 1020 + 2000, cacheWrite: 400 + 1000 });
  });

  it("uses the cost omp recorded, and the price table when omp recorded 0 or none", async () => {
    const models = (await parse()).aggregates[0]!.models;
    expect(Object.keys(models).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-5-5", "z-ai/glm-4.6"]);
    expect(models["claude-sonnet-5-5"]!.costUsd).toBeCloseTo(0.01 + 0.0006 + 0.001, 9);
    // No cost recorded: Haiku 4.5 at $1 input, $5 output and $2 for a 1 hour cache write, per million.
    expect(models["claude-haiku-4-5"]!.costUsd).toBeCloseTo((300 * 1 + 30 * 5 + 1000 * 2) / 1e6, 9);
    // The router's answer (upstreamModel) names the model; GLM 4.6 input is $0.60 per million.
    expect(models["z-ai/glm-4.6"]!.costUsd).toBeCloseTo(0.6, 9);
  });

  it("gives the same result whatever order the files come in", async () => {
    const files = await listJsonl(root);
    const forward = await parseFiles({ files: { omp: files }, timeZone: "UTC" });
    for (const shuffled of [[...files].reverse(), [files[1]!, files[2]!, files[0]!]]) {
      expect((await parseFiles({ files: { omp: shuffled }, timeZone: "UTC" })).aggregates).toEqual(forward.aggregates);
    }
  });

  it("reports unknown entries and broken lines", async () => {
    const { warnings } = await parse();
    expect(warnings.omp.unknownEvents).toEqual({ "omp:mystery_entry": 1 });
    expect(warnings.omp.badLines).toBe(1);
  });

  it("counts main sessions, not subagent transcripts", async () => {
    const logs = await findLocalLogs("omp", { dirs: { omp: [fixtures] }, scan: false }, {}, "/nonexistent");
    expect(logs.roots.map((r) => r.sessions)).toEqual([2]);
    expect(logs.files.omp).toHaveLength(3);
  });
});

describe("omp sessions in a Pi folder", () => {
  it("are left out of Pi's numbers", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "codewrapped-omp-pi-")));
    await mkdir(join(dir, "sessions", "-shop"), { recursive: true });
    const file = join(dir, "sessions", "-shop", "2026-03-02T09-00-00-000Z_a1f3c9e2.jsonl");
    await copyFile(main, file);
    const { aggregates, warnings } = await parseFiles({ files: { pi: [file] }, timeZone: "UTC" });
    expect(aggregates).toEqual([]);
    expect(warnings.pi.unknownEvents).toEqual({});
  });
});

describe("omp folders", () => {
  const tempHome = async () => realpath(await mkdtemp(join(tmpdir(), "codewrapped-omp-")));
  const session = async (dir: string, omp: boolean) => {
    await mkdir(join(dir, "-shop"), { recursive: true });
    const lines = omp ? '{"type":"title","v":1,"title":"","updatedAt":"x","pad":""}\n{"type":"session","id":"a"}\n' : '{"type":"session","id":"a"}\n';
    await writeFile(join(dir, "-shop", "2026-03-02T09-00-00-000Z_a.jsonl"), lines);
  };

  it("reads ~/.omp/agent, PI_CONFIG_DIR, profiles and XDG_DATA_HOME", async () => {
    const home = await tempHome();
    await session(join(home, ".omp", "agent", "sessions"), true);
    await session(join(home, ".omp", "profiles", "work", "agent", "sessions"), true);
    await session(join(home, ".omp-alt", "agent", "sessions"), true);
    await session(join(home, "xdg", "omp", "sessions"), true);
    await session(join(home, "xdg", "omp", "profiles", "work", "sessions"), true);
    expect((await findLogFolders({}, home, { scan: false })).dirs.omp).toEqual([
      join(home, ".omp", "agent", "sessions"),
      join(home, ".omp", "profiles", "work", "agent", "sessions"),
    ]);
    expect((await findLogFolders({ PI_CONFIG_DIR: ".omp-alt" }, home, { scan: false })).dirs.omp).toEqual([join(home, ".omp-alt", "agent", "sessions")]);
    expect((await findLogFolders({ XDG_DATA_HOME: join(home, "xdg") }, home, { scan: false })).dirs.omp).toEqual([
      join(home, "xdg", "omp", "sessions"),
      join(home, ".omp", "agent", "sessions"),
      join(home, ".omp", "profiles", "work", "agent", "sessions"),
      join(home, "xdg", "omp", "profiles", "work", "sessions"),
    ]);
  });

  it("uses Pi's variables only when they hold omp sessions", async () => {
    const home = await tempHome();
    await session(join(home, "pi-agent", "sessions"), false);
    await session(join(home, "omp-agent", "sessions"), true);
    await session(join(home, "pi-flat"), false);
    await session(join(home, "omp-flat"), true);
    const dirs = async (env: NodeJS.ProcessEnv) => (await findLogFolders(env, home, { scan: false })).dirs;
    const pi = await dirs({ PI_CODING_AGENT_DIR: join(home, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(home, "pi-flat") });
    expect(pi.omp).toEqual([]);
    expect(pi.pi).toEqual([join(home, "pi-flat"), join(home, "pi-agent", "sessions")]);
    const omp = await dirs({ PI_CODING_AGENT_DIR: join(home, "omp-agent"), PI_CODING_AGENT_SESSION_DIR: join(home, "omp-flat") });
    expect(omp.omp).toEqual([join(home, "omp-flat"), join(home, "omp-agent", "sessions")]);
    expect(ADAPTER.omp.shellVars).toEqual([]);
  });
});
