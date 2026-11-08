/**
 * Tool categories. Rows keep raw tool names for details and per-day counts
 * per category. Rows synced before categories existed are categorized from
 * their names with the table below.
 */
export const TOOL_CATEGORIES = ["edit", "read", "search", "shell", "web", "plan", "subagent", "mcp", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Lowercased raw names per category, across harnesses. MCP tools go by their mcp__ prefix. */
const NAMES: Record<Exclude<ToolCategory, "mcp" | "other">, string[]> = {
  // Claude Code: Edit, MultiEdit, Write, NotebookEdit. Codex: apply_patch. Pi: edit, write. opencode: also patch. ZCode: also ApplyPatch.
  // Cursor: edit_file(_v2), search_replace, write, apply_patch, edit_notebook, delete_file.
  edit: ["edit", "multiedit", "write", "notebookedit", "apply_patch", "patch", "applypatch", "edit_file", "edit_file_v2", "search_replace", "edit_notebook", "delete_file"],
  // Claude Code: Read, LS, NotebookRead. Codex: view_image. Pi: read, ls. opencode: read, list. Cursor: read_file(_v2), list_dir(_v2), read_lints.
  read: ["read", "ls", "notebookread", "view_image", "list", "read_file", "read_file_v2", "list_dir", "list_dir_v2", "read_lints"],
  // Claude Code: Grep, Glob. Codex: find. Pi: grep, find. opencode: grep, glob.
  // Cursor: ripgrep_raw_search, glob_file_search, codebase_search and older names.
  search: [
    "grep",
    "glob",
    "find",
    "ripgrep_raw_search",
    "ripgrep",
    "rg",
    "grep_search",
    "glob_file_search",
    "file_search",
    "codebase_search",
    "semantic_search_full",
  ],
  // Claude Code: Bash, BashOutput, KillShell. Codex: shell, exec_command, write_stdin, local_shell. Cursor: run_terminal_cmd, run_terminal_command_v2.
  shell: [
    "bash",
    "shell",
    "exec_command",
    "write_stdin",
    "shell_command",
    "local_shell",
    "bashoutput",
    "killshell",
    "killbash",
    "run_terminal_cmd",
    "run_terminal_command_v2",
  ],
  // Claude Code: WebFetch, WebSearch. Codex: web_search, web__run. opencode: webfetch, websearch, codesearch. ZCode: WebFetch, WebSearch, web_search. Cursor: web_search, web_fetch.
  web: ["webfetch", "websearch", "web_search", "web__run", "codesearch", "web_fetch"],
  // Claude Code: TodoWrite, plan mode. Codex: update_plan. opencode: todowrite, todoread. ZCode: TodoWrite, TodoRead, plan mode.
  // Cursor: todo_write, create_plan, update_current_step.
  plan: ["todowrite", "todoread", "exitplanmode", "enterplanmode", "update_plan", "todo_write", "create_plan", "update_current_step"],
  // Claude Code: Task, Agent and agent messaging. Codex: spawn_agent and friends. ZCode: Agent, Task, SendMessage. Cursor: task_v2.
  subagent: [
    "task",
    "task_v2",
    "agent",
    "subagenthandback",
    "sendmessage",
    "listagents",
    "spawn_agent",
    "send_message",
    "followup_task",
    "wait",
    "wait_agent",
    "list_agents",
    "close_agent",
  ],
};

const CATEGORY = new Map<string, ToolCategory>();
for (const [category, names] of Object.entries(NAMES)) for (const n of names) CATEGORY.set(n, category as ToolCategory);

export function toolCategory(name: string): ToolCategory {
  const n = name.toLowerCase();
  if (n.startsWith("mcp__")) return "mcp";
  return CATEGORY.get(n) ?? "other";
}

/** Commands that look for text or files, as the first program of a shell command. */
const SEARCH_COMMANDS = new Set(["rg", "grep", "egrep", "fgrep", "find", "fd", "ag", "ack", "git grep"]);

/**
 * The program a shell command runs first, skipping `cd dir &&`, variable
 * assignments, `timeout N`, `bash -lc` wrappers and quotes. Only this word is
 * read; the rest of the command is never kept.
 */
export function firstProgram(command: string): string | null {
  let s = command.trim().replace(/^(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+/, "").replace(/^['"]/, "");
  for (;;) {
    const before = s;
    s = s
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "")
      .replace(/^[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+/, "")
      .replace(/^(?:timeout\s+\S+|command|exec|nice|time)\s+/, "");
    if (s === before) break;
  }
  const words = s.split(/[\s;&|()]+/).filter(Boolean);
  const first = words[0]?.replace(/^.*\//, "");
  if (!first) return null;
  return first === "git" && words[1] === "grep" ? "git grep" : first;
}

/** A shell call counts as search when its first program searches. */
export function shellCategory(command: string | null | undefined): "search" | "shell" {
  const p = command ? firstProgram(command) : null;
  return p && SEARCH_COMMANDS.has(p) ? "search" : "shell";
}

export const emptyToolCategories = (): Record<ToolCategory, number> =>
  Object.fromEntries(TOOL_CATEGORIES.map((c) => [c, 0])) as Record<ToolCategory, number>;

/** Calls per category from raw-name counts, for rows without stored categories. */
export function toolCategories(tools: Record<string, number>): Record<ToolCategory, number> {
  const out = emptyToolCategories();
  for (const [name, n] of Object.entries(tools)) out[toolCategory(name)] += n;
  return out;
}

/** A row's stored categories, or ones derived from its tool names. Unknown keys count as other. */
export function rowToolCategories(row: { tools: Record<string, number>; toolCategories?: Record<string, number> }): Record<ToolCategory, number> {
  if (!row.toolCategories) return toolCategories(row.tools);
  const out = emptyToolCategories();
  for (const [k, n] of Object.entries(row.toolCategories)) out[(TOOL_CATEGORIES as readonly string[]).includes(k) ? (k as ToolCategory) : "other"] += n;
  return out;
}
