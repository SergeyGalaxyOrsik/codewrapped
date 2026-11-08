import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAll, parseFiles } from "../src/index";

const fixtures = join(import.meta.dirname, "../fixtures");

/**
 * Pins the numbers the Claude Code and Codex adapters produce on every
 * fixture. A refactor of the parsing pipeline must leave this unchanged.
 */
describe("fixture snapshot", () => {
  it("produces the same daily aggregates", async () => {
    const claudeFiles = await listAll([join(fixtures, "claude"), join(fixtures, "claude-sdk")]);
    const codexFiles = await listAll([join(fixtures, "codex"), join(fixtures, "codex-exec")]);
    for (const timeZone of ["UTC", "Europe/Berlin", "America/Los_Angeles"]) {
      const { aggregates, warnings } = await parseFiles({ files: { claude: claudeFiles, codex: codexFiles }, timeZone });
      expect({ aggregates, warnings }).toMatchSnapshot(timeZone);
    }
  });
});
