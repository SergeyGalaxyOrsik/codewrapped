# Security and privacy

codewrapped runs on your computer and reads files there. This is exactly what it touches.

## What the CLI reads

**Log folders.** Without `--claude-dir` or `--codex-dir`, it looks for log folders in this order:

1. `$CLAUDE_CONFIG_DIR` (comma separated is allowed) and `$CODEX_HOME` from the environment.
2. The defaults: `~/.claude`, `~/.config/claude` and `~/.codex`.
3. Folders it found on an earlier run, saved in `~/.config/codewrapped/config.json`.
4. `CLAUDE_CONFIG_DIR=` and `CODEX_HOME=` values in `~/.zshrc`, `~/.bashrc`, `~/.zprofile` and `~/.config/fish/config.fish`, including inside aliases. From these files it keeps only those two values, and only when they are a path. Nothing else from them is kept, printed or sent.
5. Folders one level deep in `~` and `~/.config` whose names start with `.claude`, `claude`, `.codex` or `codex`.

Folders from steps 4 and 5 are used only when their content looks like logs: for Claude Code, `projects/<project>/<session>.jsonl` with Claude Code events; for Codex, `sessions/YYYY/MM/DD/rollout-*.jsonl`. `--claude-dir` and `--codex-dir` replace all of this for that agent.

Inside a log folder it reads `projects/` (Claude Code) or `sessions/` and `archived_sessions/` (Codex).

**Repositories.** For each working directory in the logs, it reads `.git/config` and keeps only the repository name from the remote URL, never the owner, host or credentials. Without a remote, it uses the folder name.

## What it keeps

From the logs it counts time, tokens, tool calls, model names, file names and repository names. It never keeps your prompts, your code or full paths.

On your computer, `~/.config/codewrapped/` holds `config.json` (a random machine id, the list of log folders it found, sync state) and, after `login`, `auth.json` with your token (readable by you only). The folder list never leaves your computer.

## Network

Without an account, the CLI makes no network requests. After `npx codewrapped login`, `npx codewrapped sync` uploads daily totals: counts, tool and model names, file names without paths and repository names without owners. Run `npx codewrapped sync --dry-run` to see the exact payload without sending it. Public pages hide file and repository names until you turn them on in settings.

## Reporting a problem

Open an issue at https://github.com/SergeyGalaxyOrsik/codewrapped/issues. For something that should not be public, open an issue asking for a contact, without details, and I will reply.
