import { describe, expect, it } from "vitest";
import { harnessSplit, toolCategories, toolCategory, type SourceTotals } from "../src/index";

describe("tool categories", () => {
  it("maps raw names across harnesses", () => {
    expect(toolCategory("Edit")).toBe("edit");
    expect(toolCategory("apply_patch")).toBe("edit");
    expect(toolCategory("Read")).toBe("read");
    expect(toolCategory("Grep")).toBe("search");
    expect(toolCategory("Bash")).toBe("shell");
    expect(toolCategory("exec_command")).toBe("shell");
    expect(toolCategory("WebFetch")).toBe("web");
    expect(toolCategory("web__run")).toBe("web");
    expect(toolCategory("mcp__github__create_pr")).toBe("other");
  });

  it("sums calls per category", () => {
    expect(toolCategories({ Bash: 3, Grep: 2, Glob: 1, Agent: 4 })).toEqual({ edit: 0, read: 0, search: 3, shell: 3, web: 0, other: 4 });
  });
});

describe("harnessSplit", () => {
  const t = (tokens: number, activeMinutes = 0): SourceTotals => ({ tokens, activeMinutes, agentMinutes: 0, sessions: 0 });

  it("ranks harnesses and leaves out unused ones", () => {
    expect(harnessSplit({ claude: t(300, 10), codex: t(100, 50) }, "tokens")).toEqual([
      { source: "claude", name: "Claude Code", tokens: 300, activeMinutes: 10, share: 0.75 },
      { source: "codex", name: "Codex", tokens: 100, activeMinutes: 50, share: 0.25 },
    ]);
    expect(harnessSplit({ claude: t(0), codex: t(100, 5) }, "activeMinutes").map((x) => [x.source, x.share])).toEqual([["codex", 1]]);
  });

  it("folds everything after the top n into other", () => {
    const split = harnessSplit({ claude: t(300), codex: t(100) }, "tokens", 1);
    expect(split.map((x) => x.source)).toEqual(["claude", "codex"]);
    // With n = 0 there is nothing to name, so all of it is "other".
    expect(harnessSplit({ claude: t(300), codex: t(100) }, "tokens", 0)).toEqual([
      { source: "other", name: "other", tokens: 400, activeMinutes: 0, share: 1 },
    ]);
  });
});
