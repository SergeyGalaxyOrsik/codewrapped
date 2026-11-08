import { describe, expect, it } from "vitest";
import { emptyAggregate, firstProgram, harnessSplit, rowToolCategories, shellCategory, summarize, toolCategories, toolCategory, type DailyAggregate, type SourceTotals } from "../src/index";

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
    expect(toolCategory("TodoWrite")).toBe("plan");
    expect(toolCategory("update_plan")).toBe("plan");
    expect(toolCategory("Task")).toBe("subagent");
    expect(toolCategory("spawn_agent")).toBe("subagent");
    expect(toolCategory("mcp__github__create_pr")).toBe("mcp");
    expect(toolCategory("ToolSearch")).toBe("other");
  });

  it("sums calls per category", () => {
    expect(toolCategories({ Bash: 3, Grep: 2, Glob: 1, Agent: 4, mcp__x__y: 1, Skill: 2 })).toEqual({
      edit: 0, read: 0, search: 3, shell: 3, web: 0, plan: 0, subagent: 4, mcp: 1, other: 2,
    });
  });

  it("counts a shell call that searches as search", () => {
    expect(firstProgram("cd /repo && rg -n foo src")).toBe("rg");
    expect(firstProgram("bash -lc 'grep -r x .'")).toBe("grep");
    expect(firstProgram("FOO=1 timeout 30 git grep needle")).toBe("git grep");
    expect(firstProgram("/usr/bin/find . -name '*.ts' | head")).toBe("find");
    expect(shellCategory("rg foo | head -5")).toBe("search");
    expect(shellCategory("cat a.txt | grep foo")).toBe("shell");
    expect(shellCategory("pnpm test")).toBe("shell");
    expect(shellCategory(null)).toBe("shell");
  });

  it("uses stored categories and falls back to names for old rows", () => {
    expect(rowToolCategories({ tools: { Bash: 2 }, toolCategories: { search: 1, shell: 1, future: 3 } })).toMatchObject({ search: 1, shell: 1, other: 3 });
    expect(rowToolCategories({ tools: { Bash: 2 } })).toMatchObject({ shell: 2, search: 0 });
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

describe("summaries", () => {
  const row = (source: string, tools: Record<string, number>): DailyAggregate => ({ ...emptyAggregate("2026-11-08", "claude"), source: source as DailyAggregate["source"], tools });

  it("never ranks uncategorized tools", () => {
    const s = summarize([row("claude", { ToolSearch: 50, Bash: 3, Read: 2 })], { period: "7d", today: "2026-11-08" });
    expect(s.topTools.map((t) => t.name)).toEqual(["Bash", "Read"]);
    expect(s.toolCategories.other).toBe(50);
  });

  it("leaves out rows of harnesses the registry does not know", () => {
    const s = summarize([row("claude", { Bash: 3 }), row("some-new-agent", { Bash: 100 })], { period: "7d", today: "2026-11-08" });
    expect(s.totals.toolCalls).toBe(3);
  });
});
