import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countUnknown, emptyWarnings } from "../src/lines";
import { MAX_LINE_BYTES, parseFiles } from "../src/index";

const fixture = join(import.meta.dirname, "../fixtures/claude/projects/-home-dev-shop/sess-1.jsonl");
const parse = (files: string[]) => parseFiles({ files: { claude: files }, timeZone: "Europe/Berlin" });

describe("reading JSONL files", () => {
  it("skips lines over the size limit and keeps every other line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-lines-"));
    const lines = (await readFile(fixture, "utf8")).trimEnd().split("\n");
    const huge = `{"type":"user","pad":"${"x".repeat(MAX_LINE_BYTES)}"}`;
    const file = join(dir, "long.jsonl");
    // One over-long line in the middle and one at the end without a newline.
    await writeFile(file, [lines[0], huge, ...lines.slice(1), huge].join("\n"));

    const clean = await parse([fixture]);
    const withLong = await parse([file]);
    expect(withLong.aggregates).toEqual(clean.aggregates);
    expect(withLong.warnings.claude.longLines).toBe(2);
    expect(withLong.warnings.claude.badLines).toBe(clean.warnings.claude.badLines);
  });

  it("reads CRLF files the same as LF files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-lines-"));
    const file = join(dir, "crlf.jsonl");
    await writeFile(file, (await readFile(fixture, "utf8")).replace(/\n/g, "\r\n"));
    const lf = await parse([fixture]);
    const crlf = await parse([file]);
    expect(crlf.aggregates).toEqual(lf.aggregates);
    expect(crlf.warnings.claude.badLines).toBe(lf.warnings.claude.badLines);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("reports a file it may not read and goes on with the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-lines-"));
    const locked = join(dir, "locked.jsonl");
    await writeFile(locked, await readFile(fixture));
    await chmod(locked, 0o000);

    const clean = await parse([fixture]);
    const result = await parse([locked, fixture]);
    expect(result.aggregates).toEqual(clean.aggregates);
    expect(result.warnings.claude.unreadableFiles).toEqual([{ file: locked, reason: "EACCES" }]);
  });
});

describe("countUnknown", () => {
  it("counts event types named like Object.prototype members as plain keys", () => {
    for (const warnings of [emptyWarnings(), { ...emptyWarnings(), unknownEvents: {} }]) {
      for (const type of ["__proto__", "constructor", "toString", "__proto__"]) countUnknown(warnings, type);
      expect(Object.entries(warnings.unknownEvents)).toEqual([
        ["__proto__", 2],
        ["constructor", 1],
        ["toString", 1],
      ]);
    }
  });
});
