import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countMinutes, decodeMask } from "@codewrapped/stats";
import { listJsonl, parseFiles, patchFiles } from "../src/index";

const root = join(import.meta.dirname, "../fixtures/codex/sessions");

async function parse() {
  const codexFiles = await listJsonl(root);
  const result = await parseFiles({ codexFiles, timeZone: "Europe/Berlin" });
  expect(result.aggregates).toHaveLength(1);
  return { ...result, row: result.aggregates[0]! };
}

describe("codex parser", () => {
  it("counts tokens from last_token_usage and skips repeated running totals", async () => {
    const { row } = await parse();
    // Turn 1: 1000 in (400 cached), 50 out, emitted twice with the same total.
    // Turn 2: 1500 in (1000 cached), 30 out. Subagent: 300 in, 20 out.
    expect(row.tokens).toEqual({ input: 600 + 500 + 300, output: 100, cacheRead: 1400, cacheWrite: 0 });
    // Model tokens leave out cache reads: (600 + 50) + (500 + 30).
    expect(row.models["gpt-6.1-sol"]).toMatchObject({ tokens: 1180, cacheRead: 1400 });
    expect(row.models["gpt-6.1-terra"]).toMatchObject({ tokens: 320, cacheRead: 0 });
  });

  it("prices each model at its own rate", async () => {
    const { row } = await parse();
    // sol: (600*2 + 400*0.1 + 50*10) + (500*2 + 1000*0.1 + 30*10) = 3140 per MTok
    expect(row.models["gpt-6.1-sol"]!.costUsd).toBe(0.00314);
    // terra: 300*1 + 20*5 = 400 per MTok
    expect(row.models["gpt-6.1-terra"]!.costUsd).toBe(0.0004);
  });

  it("counts tools inside code mode exec calls, once per call id", async () => {
    const { row } = await parse();
    // The subagent rollout replays call c1 from its parent.
    expect(row.tools).toEqual({ exec_command: 1, apply_patch: 1, spawn_agent: 1 });
    expect(row.files).toEqual({ "server.ts": 1, "new.ts": 1 });
  });

  it("folds subagent threads into the parent session", async () => {
    const { row } = await parse();
    expect(row.sessions).toBe(1);
    // Turns u1 and u2 come from the user. u3 runs inside the subagent.
    expect(row.messages).toBe(2);
    // 10:00:00 to 10:02:00 UTC, then an 18 minute pause that is dropped.
    expect(row.agentMinutes).toBe(2);
    expect(countMinutes(decodeMask(row.activeMask))).toBe(2);
    expect(row.peakSessions).toBe(1);
    // Named from session_meta.git.repository_url, not the folder.
    expect(row.repos).toEqual({ "payments-api": { minutes: 2, tokens: 1180 + 320 } });
  });

  it("skips unknown events", async () => {
    const { warnings } = await parse();
    expect(warnings.codex.unknownEvents).toEqual({ "codex:mystery_event": 1 });
    expect(warnings.codex.badLines).toBe(0);
  });
});

describe("patchFiles", () => {
  it("reads paths from raw and escaped patches", () => {
    const raw = "*** Begin Patch\n*** Update File: a/b.ts\n@@\n*** Delete File: old.md\n*** Add File: c d.txt\n+x\n*** End Patch";
    expect(patchFiles(raw)).toEqual(["a/b.ts", "old.md", "c d.txt"]);
    expect(patchFiles('"*** Begin Patch\\n*** Update File: src/x.rs\\n@@"')).toEqual(["src/x.rs"]);
  });
});
