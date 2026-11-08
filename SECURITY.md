# Security and privacy

codewrapped runs on your computer and reads files there. This is exactly what it touches.

## What the CLI reads

**Log folders.** Without `--claude-dir` or `--codex-dir`, it looks for log folders in this order:

1. `$CLAUDE_CONFIG_DIR` (comma separated is allowed) and `$CODEX_HOME` from the environment.
2. The defaults: `~/.claude`, `~/.config/claude` and `~/.codex`.
3. Folders it found on an earlier run, saved in `~/.config/codewrapped/config.json`.
4. `CLAUDE_CONFIG_DIR=`, `CODEX_HOME=`, `PI_CODING_AGENT_DIR=` and `ZCODE_SESSION_DB_PATH=` values in `~/.zshrc`, `~/.bashrc`, `~/.zprofile` and `~/.config/fish/config.fish`, including inside aliases. From these files it keeps only those values, and only when they are a path. Nothing else from them is kept, printed or sent.
5. Folders one level deep in `~` and `~/.config` whose names start with `.claude`, `claude`, `.codex` or `codex`.

Folders from steps 4 and 5 are used only when their content looks like logs: for Claude Code, `projects/<project>/<session>.jsonl` with Claude Code events; for Codex, `sessions/YYYY/MM/DD/rollout-*.jsonl`. `--claude-dir` and `--codex-dir` replace all of this for that agent.

Inside a log folder it reads `projects/` (Claude Code) or `sessions/` and `archived_sessions/` (Codex).

**Pi and opencode (beta).** For Pi it reads `sessions/` in `$PI_CODING_AGENT_DIR`, else `~/.pi/agent`. For opencode it reads `opencode.db` in `$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`, and, from versions before the database, JSON files under `storage/session/`, `storage/message/` and `storage/part/` there. The database is copied with its `-wal` and `-shm` files into a temporary folder, opened read-only there and deleted afterwards, so a running opencode is never touched. Only the `session`, `message` and `part` tables are read, never the account or credential tables. `--pi-dir` and `--opencode-dir` replace this lookup.

**ZCode (beta).** It reads the session database ZCode's CLI and desktop app share: the file in `$ZCODE_SESSION_DB_PATH` (or `$ZCODE_SESSION_DB`), the file `storage.sessionDbPath` names in `~/.zcode/cli/config.json` (only that key is read), and `~/.zcode/cli/db/db.sqlite`. Like opencode's, the database is copied with its `-wal` and `-shm` files, opened read-only and deleted afterwards. Only the `session`, `message`, `part` and `session_task_link` tables are read, and from messages and tool calls only times, model names, token counts, tool names, shell commands (for their first word), edited file paths and patch headers (for file names). Message text and tool output are never read. `~/.zcode/v2` (credentials, settings, old snapshots) is never opened. `--zcode-dir` replaces this lookup.

**Repositories.** For each working directory in the logs, it reads `.git/config` and keeps only the repository name from the remote URL, never the owner, host or credentials. Without a remote, it uses the folder name.

## What it keeps

From the logs it counts time, tokens, tool calls, model names, file names and repository names. It never keeps your prompts, your code or full paths.

On your computer, `~/.config/codewrapped/` holds `config.json` (a random machine id, the list of log folders it found, sync state) and, after `login`, `auth.json` with your token (readable by you only). The folder list never leaves your computer.

## Network

Without an account, the CLI makes no network requests. After `npx codewrapped login`, `npx codewrapped sync` uploads daily totals: counts, tool and model names, file names without paths and repository names without owners. Run `npx codewrapped sync --dry-run` to see the exact payload without sending it. Public pages hide file and repository names until you turn them on in settings.

## Reporting a problem

Open an issue at https://github.com/SergeyGalaxyOrsik/codewrapped/issues. For something that should not be public, open an issue asking for a contact, without details, and I will reply.
