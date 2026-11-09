import type { ParseWarnings } from "@codewrapped/parser";
import { emptyAggregate, SOURCES, summarize, type Source } from "@codewrapped/stats";
import { describe, expect, it } from "vitest";
import { trustedUrl } from "../src/card";
import { formatSummary, warningLines } from "../src/format";

const ESC = "\u001b";
const evil = (name: string) => `${ESC}]0;title${ESC}\\${ESC}[2J${ESC}[31m${name}\u202e${ESC}[0m\u0007\u009b`;
/** Anything a terminal would act on, after our own color codes are taken out. */
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const withoutOwnColors = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("the summary in the terminal", () => {
  it("prints names from logs without control characters or bidi overrides", () => {
    const d = emptyAggregate("2026-11-05", "claude");
    d.sessions = 1;
    d.messages = 1;
    d.tokens.input = 100;
    d.models = { [evil("model")]: { tokens: 100, cacheRead: 0, costUsd: null } };
    d.tools = { [evil("tool")]: 3 };
    d.files = { [evil("file.ts")]: 2 };
    d.repos = { [evil("repo")]: { minutes: 1, tokens: 100 } };
    const text = formatSummary(summarize([d], { period: "30d", today: "2026-11-09" }));
    expect(text).toContain("model");
    expect(text).toContain("Most edited");
    expect(withoutOwnColors(text)).not.toMatch(UNSAFE);
  });
});

describe("warnings", () => {
  const warnings = () => Object.fromEntries(SOURCES.map((s) => [s, { files: 1, lines: 1, badLines: 0, unknownEvents: {} }])) as Record<Source, ParseWarnings>;

  it("names a skipped database and why", () => {
    const w = warnings();
    w.opencode.unknownEvents["opencode:(unreadable database: a 0.6 GB database needs Node 22.13 or newer)"] = 1;
    w.claude.unknownEvents["claude:new-event"] = 2;
    expect(warningLines(w)).toEqual([
      "Could not read the opencode database (a 0.6 GB database needs Node 22.13 or newer), so it is not counted.",
      "Skipped 2 unknown events.",
    ]);
  });

  it("lists unreadable files and counts long lines", () => {
    const w = warnings();
    w.claude.unreadableFiles = ["a", "b", "c", "d", "e"].map((n) => ({ file: `/logs/${n}.jsonl`, reason: "EACCES" }));
    w.codex.longLines = 1;
    w.codex.badLines = 3;
    expect(warningLines(w)).toEqual([
      "Could not read these files, so they are not counted: /logs/a.jsonl (EACCES), /logs/b.jsonl (EACCES), /logs/c.jsonl (EACCES) and 2 more.",
      "Skipped 3 unreadable lines and 1 line over 64 MB.",
    ]);
  });

  it("prints file names without control characters", () => {
    const w = warnings();
    w.pi.unreadableFiles = [{ file: `/logs/${evil("x")}.jsonl`, reason: "EACCES" }];
    w.zcode.unknownEvents[`zcode:(unreadable database: ${evil("bad")})`] = 1;
    for (const line of warningLines(w)) expect(line).not.toMatch(UNSAFE);
  });
});

describe("trustedUrl", () => {
  const sites = ["https://api.codewrapped.app", "https://codewrapped.app"];

  it("allows pages on the configured sites", () => {
    expect(trustedUrl("https://codewrapped.app/cli/verify?code=ABCD-1234", sites)).toBe("https://codewrapped.app/cli/verify?code=ABCD-1234");
  });

  it("refuses other hosts, schemes and ports", () => {
    for (const url of [
      "https://evil.example/cli/verify",
      "https://codewrapped.app.evil.example/",
      "http://codewrapped.app/cli/verify",
      "https://codewrapped.app:8443/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "calc.exe",
    ]) {
      expect(trustedUrl(url, sites), url).toBeNull();
    }
  });
});
