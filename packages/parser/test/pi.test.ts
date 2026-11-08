import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLogFolders, listJsonl, parseFiles } from "../src/index";

const root = join(import.meta.dirname, "../fixtures/pi/sessions");

async function parse() {
  return parseFiles({ files: { pi: await listJsonl(root) }, timeZone: "UTC" });
}

describe("pi adapter", () => {
  it("counts every branch of the tree and a forked copy once", async () => {
    const { aggregates } = await parse();
    expect(aggregates).toHaveLength(1);
    const row = aggregates[0]!;
    expect(row.source).toBe("pi");
    // p1 and its fork p2. Prompts: e02 and the branch e06 in p1, f01 in p2. The copied e02 is not
    // counted again, and the /skill expansion e10 is not a typed prompt.
    expect(row.sessions).toBe(2);
    expect(row.messages).toBe(3);
    // bashExecution (a command the person ran with !) is activity, not a tool call.
    expect(row.tools).toEqual({ bash: 1, write: 1, edit: 1, read: 1 });
    expect(row.toolCategories).toEqual({ search: 1, edit: 2, read: 1 });
    expect(row.files).toEqual({ "cart.ts": 2 });
    // Also the cache warm-up entry e09, the tool result's nested model work e11, and e12.
    expect(row.repos.shop!.tokens).toBe(100 + 50 + 200 + 10 + 5 + 20 + 10 + 1000 + 10 + 302 + 1_000_000);
    expect(row.tokens.cacheWrite).toBe(200 + 1000 + 300);
  });

  it("uses the cost Pi recorded, and the price table when Pi recorded 0", async () => {
    const { aggregates } = await parse();
    const models = aggregates[0]!.models;
    expect(models["claude-sonnet-5-5"]!.costUsd).toBeCloseTo(0.00175 + 0.001 + 0.002 + 0.003 + 0.0005 + 0.0001, 9);
    // The router's answer names the model; GLM 4.6 input is $0.60 per million.
    expect(models["z-ai/glm-4.6"]!.costUsd).toBeCloseTo(0.6, 9);
  });

  it("gives the same result whatever order the files come in, so a fork never takes its parent's entries", async () => {
    const files = await listJsonl(root);
    const forward = await parseFiles({ files: { pi: files }, timeZone: "UTC" });
    const reversed = await parseFiles({ files: { pi: [...files].reverse() }, timeZone: "UTC" });
    expect(reversed.aggregates).toEqual(forward.aggregates);
  });

  it("reports unknown entries and broken lines", async () => {
    const { warnings } = await parse();
    expect(warnings.pi.unknownEvents).toEqual({ "pi:mystery_entry": 1 });
    expect(warnings.pi.badLines).toBe(1);
  });
});

describe("pi folders", () => {
  it("follows sessionDir in settings.json and PI_CODING_AGENT_SESSION_DIR", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "codewrapped-pi-")));
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await mkdir(join(home, "pi-sessions"), { recursive: true });
    await mkdir(join(home, "elsewhere"), { recursive: true });
    await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ sessionDir: "~/pi-sessions", theme: "dark" }));
    const viaSettings = await findLogFolders({}, home, { scan: false });
    expect(viaSettings.dirs.pi).toEqual([join(home, "pi-sessions")]);
    const viaEnv = await findLogFolders({ PI_CODING_AGENT_SESSION_DIR: join(home, "elsewhere") }, home, { scan: false });
    expect(viaEnv.dirs.pi).toEqual([join(home, "elsewhere"), join(home, "pi-sessions")]);
  });
});
