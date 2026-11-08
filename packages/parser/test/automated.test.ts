import { join } from "node:path";
import { countMinutes, decodeMask } from "@codewrapped/stats";
import { describe, expect, it } from "vitest";
import { listJsonl, parseFiles } from "../src/index";

const fixtures = join(import.meta.dirname, "../fixtures");

describe("automated sessions", () => {
  it("puts claude -p sessions in the automated block and keeps their tokens and tools", async () => {
    const claudeFiles = await listJsonl(join(fixtures, "claude-sdk"));
    const { aggregates } = await parseFiles({ files: { claude: claudeFiles }, timeZone: "UTC" });
    expect(aggregates).toHaveLength(1);
    const row = aggregates[0]!;
    expect(row.sessions).toBe(0);
    expect(row.messages).toBe(0);
    expect(row.agentMinutes).toBe(0);
    expect(countMinutes(decodeMask(row.activeMask))).toBe(0);
    expect(row.automated).toMatchObject({ sessions: 1, messages: 1, agentMinutes: 5, peakSessionsAll: 1, repoMinutes: { bot: 5 } });
    expect(row.repos).toEqual({ bot: { minutes: 0, tokens: 30 } });
    expect(countMinutes(decodeMask(row.automated.activeMask))).toBe(5);
    expect(row.tokens).toEqual({ input: 20, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(row.tools).toEqual({ Write: 1 });
    expect(row.files).toEqual({ "report.md": 1 });
  });

  it("puts codex exec sessions in the automated block", async () => {
    const codexFiles = await listJsonl(join(fixtures, "codex-exec"));
    const { aggregates } = await parseFiles({ files: { codex: codexFiles }, timeZone: "UTC" });
    const row = aggregates[0]!;
    expect(row.sessions).toBe(0);
    expect(row.automated).toMatchObject({ sessions: 1, messages: 1, agentMinutes: 4 });
    expect(row.tokens).toEqual({ input: 400, output: 40, cacheRead: 100, cacheWrite: 0 });
    expect(row.tools).toEqual({ exec_command: 1 });
  });

  it("leaves interactive sessions alone", async () => {
    const claudeFiles = await listJsonl(join(fixtures, "claude"));
    const { aggregates } = await parseFiles({ files: { claude: claudeFiles }, timeZone: "UTC" });
    expect(aggregates[0]!.automated.sessions).toBe(0);
    expect(aggregates[0]!.sessions).toBe(1);
  });
});
