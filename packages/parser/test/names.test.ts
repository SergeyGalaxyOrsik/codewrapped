import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildPublicProfile, DEFAULT_VISIBILITY, type DailyAggregate } from "@codewrapped/stats";
import { parseFiles } from "../src/index";

const NAMES = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"];

const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

const builtIns = { "Object.prototype": Object.prototype, Object, Function: Function.prototype, toString: Object.prototype.toString, valueOf: Object.prototype.valueOf, hasOwnProperty: Object.prototype.hasOwnProperty };
const ownNames = () => Object.fromEntries(Object.entries(builtIns).map(([k, v]) => [k, Object.getOwnPropertyNames(v).sort()]));

const t0 = Date.parse("2026-11-02T10:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 3 };

/** One interactive and one `claude -p` session per name, using it as tool, model, file and repository. */
function transcript(): string {
  const lines: object[] = [];
  NAMES.forEach((w, i) => {
    const t = t0 + i * 10 * 60_000;
    const cwd = `/home/dev/${w}`;
    const base = { sessionId: `s-${i}`, cwd, entrypoint: "cli" };
    lines.push({ ...base, type: "user", uuid: `p-${i}`, timestamp: at(t), message: { role: "user", content: "hi" }, origin: { kind: "human" } });
    for (const [k, dt] of [30_000, 90_000].entries()) {
      const content = [
        { type: "tool_use", id: `tw-${i}-${k}`, name: w, input: {} },
        { type: "tool_use", id: `te-${i}-${k}`, name: "Edit", input: { file_path: `${cwd}/src/${w}` } },
      ];
      lines.push({ ...base, type: "assistant", uuid: `a-${i}-${k}`, requestId: `r-${i}-${k}`, timestamp: at(t + dt), message: { model: w, id: `m-${i}-${k}`, role: "assistant", content, usage } });
    }
    const script = { sessionId: `auto-${i}`, cwd, entrypoint: "sdk-cli" };
    for (const [k, dt] of [0, 60_000].entries()) {
      lines.push({ ...script, type: "user", uuid: `q-${i}-${k}`, timestamp: at(t + dt), message: { role: "user", content: "run" }, origin: { kind: "human" } });
    }
  });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

describe("names that are also Object.prototype members", () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-names-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("are counted as ordinary names from the log to the public profile", async () => {
    const before = ownNames();
    const file = join(dir, "names.jsonl");
    writeFileSync(file, transcript());

    const { aggregates } = await parseFiles({ files: { claude: [file] }, timeZone: "UTC" });
    expect(aggregates).toHaveLength(1);
    const row = aggregates[0]!;
    for (const w of NAMES) {
      expect(own(row.tools, w), `tools.${w}`).toBe(2);
      expect(own(row.files, w), `files.${w}`).toBe(2);
      expect(own(row.models, w), `models.${w}`).toEqual({ tokens: 30, cacheRead: 6, costUsd: null });
      expect(own(row.repos, w), `repos.${w}`).toEqual({ minutes: 1.5, tokens: 30 });
      expect(own(row.automated.repoMinutes, w), `automated.repoMinutes.${w}`).toBe(1);
    }
    expect(row.tools.Edit).toBe(14);
    expect(row.toolCategories).toEqual({ other: 14, edit: 14 });

    const wire = JSON.parse(JSON.stringify(aggregates)) as DailyAggregate[];
    for (const field of ["tools", "files", "models", "repos"] as const) expect(Object.keys(wire[0]![field])).toEqual(expect.arrayContaining(NAMES));
    expect(Object.keys(wire[0]!.automated.repoMinutes).sort()).toEqual([...NAMES].sort());

    // The same day synced from two machines.
    const rows = [...wire, ...(JSON.parse(JSON.stringify(aggregates)) as DailyAggregate[])];
    const vis = { ...DEFAULT_VISIBILITY, files: true, repos: true };
    const { summary, allTime } = buildPublicProfile({ handle: "dev", displayName: null, avatarUrl: null, joinedAt: "2026-11-01" }, vis, rows, "7d", "2026-11-08");

    expect(summary.models!.map((m) => [m.model, m.tokens, m.costUsd]).sort()).toEqual(NAMES.map((w) => [w, 60, null]).sort());
    expect(summary.totals.tokens.headline).toBe(NAMES.length * 60);
    expect(summary.totals.unpricedTokens).toBe(NAMES.length * 60);
    expect(summary.totals.costUsd).toBe(0);
    expect(summary.totals.fileEdits).toBe(NAMES.length * 4);
    expect(summary.totals.toolCalls).toBe(NAMES.length * 8);
    expect(summary.topFiles).toEqual([...NAMES].sort((a, b) => a.localeCompare(b)).slice(0, 5).map((name) => ({ name, count: 4 })));
    expect(summary.topRepos).toHaveLength(3);
    for (const r of summary.topRepos) expect(NAMES).toContain(r.name);
    for (const r of summary.topRepos) expect(r).toMatchObject({ tokens: 60, minutes: 3 });
    expect(allTime.tokens).toBe(NAMES.length * 60);
    expect(JSON.stringify(summary)).not.toContain("[native code]");

    expect(({} as Record<string, unknown>).tokens).toBeUndefined();
    expect(({} as Record<string, unknown>).minutes).toBeUndefined();
    expect(ownNames()).toEqual(before);
  });
});
