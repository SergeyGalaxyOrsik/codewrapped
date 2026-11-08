/**
 * Tool categories. Rows keep raw tool names, and the category is derived from
 * the name here, so the server can categorize synced rows the same way and
 * old rows pick up names added later.
 */
export const TOOL_CATEGORIES = ["edit", "read", "search", "shell", "web", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Lowercased raw names per category, across harnesses. Anything else is "other". */
const NAMES: Record<Exclude<ToolCategory, "other">, string[]> = {
  // Claude Code: Edit, MultiEdit, Write, NotebookEdit. Codex: apply_patch.
  edit: ["edit", "multiedit", "write", "notebookedit", "apply_patch"],
  // Claude Code: Read, LS, NotebookRead. Codex: view_image.
  read: ["read", "ls", "notebookread", "view_image"],
  // Claude Code: Grep, Glob. Codex: find.
  search: ["grep", "glob", "find"],
  // Claude Code: Bash, BashOutput, KillShell. Codex: shell, exec_command, write_stdin, local_shell.
  shell: ["bash", "shell", "exec_command", "write_stdin", "shell_command", "local_shell", "bashoutput", "killshell", "killbash"],
  // Claude Code: WebFetch, WebSearch. Codex: web_search, web__run.
  web: ["webfetch", "websearch", "web_search", "web__run"],
};

const CATEGORY = new Map<string, ToolCategory>();
for (const [category, names] of Object.entries(NAMES)) for (const n of names) CATEGORY.set(n, category as ToolCategory);

export function toolCategory(name: string): ToolCategory {
  return CATEGORY.get(name.toLowerCase()) ?? "other";
}

/** Calls per category from raw-name counts. */
export function toolCategories(tools: Record<string, number>): Record<ToolCategory, number> {
  const out = Object.fromEntries(TOOL_CATEGORIES.map((c) => [c, 0])) as Record<ToolCategory, number>;
  for (const [name, n] of Object.entries(tools)) out[toolCategory(name)] += n;
  return out;
}
