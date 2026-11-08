/** Tool names that run shell commands, across Claude Code and Codex. */
const SHELL = new Set(["bash", "shell", "exec_command", "write_stdin", "shell_command", "local_shell", "bashoutput", "killshell", "killbash"]);

/** Tools that read or search without changing files. */
const READ = new Set(["read", "grep", "glob", "ls", "notebookread", "webfetch", "websearch", "web_search", "web__run", "view_image", "find"]);

/** Tools that change files. These are the tools counted in `files`. */
const EDIT = new Set(["edit", "multiedit", "write", "notebookedit", "apply_patch"]);

export type ToolKind = "shell" | "read" | "edit" | "other";

export function toolKind(name: string): ToolKind {
  const n = name.toLowerCase();
  if (SHELL.has(n)) return "shell";
  if (READ.has(n)) return "read";
  if (EDIT.has(n)) return "edit";
  return "other";
}

export function isEditTool(name: string): boolean {
  return EDIT.has(name.toLowerCase());
}
