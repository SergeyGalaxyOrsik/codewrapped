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

**Cursor (beta).** It reads the agent chats of the Cursor editor from its state database, `User/globalStorage/state.vscdb` in Cursor's folder (`~/Library/Application Support/Cursor` on macOS, `$XDG_CONFIG_HOME/Cursor` or `~/.config/Cursor` on Linux, `%APPDATA%\Cursor` on Windows). The file runs to gigabytes, so it is opened read-only where it is instead of copied; SQLite lets a reader share it with a running Cursor. From its `cursorDiskKV` table only `composerData:` and `bubbleId:` rows are read, plus `composerHeaders`, and from them only times, model names, token counts, tool names, shell commands (for their first word), edited file paths and patch headers (for file names). Prompts, replies, code and tool output are never read. `ItemTable`, where Cursor keeps its login tokens, is never queried. To find a chat's folder it reads `workspace.json` and the `composer.composerData` key of each workspace's own `state.vscdb` in `User/workspaceStorage`, and the folder list of a `.code-workspace` file. Cursor keeps token counts only for some older chats, so Cursor tokens are partial. The cursor-agent CLI (`~/.cursor`) is not read. `--cursor-dir` replaces this lookup.

**oh-my-pi (beta).** It reads `sessions/` in `~/.omp/agent` (or `~` joined with `$PI_CONFIG_DIR`), in each profile under `~/.omp/profiles/`, and in `$XDG_DATA_HOME/omp` when that folder exists. oh-my-pi reads Pi's `$PI_CODING_AGENT_DIR` and `$PI_CODING_AGENT_SESSION_DIR` too, so those folders are used only when a session there starts with oh-my-pi's title line, and the Pi adapter skips files that start with it. From each session it keeps only times, the working directory, model names, token counts, recorded cost, tool names, shell commands (for their first word), edited file paths and patch headers (for file names). Prompts, replies and tool output are never kept. Settings, `agent.db` (credentials) and the rest of `~/.omp` are never opened. Not read yet: archives from `omp gc` (`archive/sessions/`), collab replicas in `~/.omp/collab`, and sessions placed elsewhere with `--session-dir`; pass that folder with `--omp-dir`. `--omp-dir` replaces this lookup.

**Repositories.** For each working directory in the logs, it reads `.git/config` and keeps only the repository name from the remote URL, never the owner, host or credentials. Without a remote, it uses the folder name.

## What it keeps

From the logs it counts time, tokens, tool calls, model names, file names and repository names. It never keeps your prompts, your code or full paths.

On your computer, `~/.config/codewrapped/` holds `config.json` (a random machine id, the list of log folders it found, sync state) and, after `login`, `auth.json` with your token (readable by you only). The folder list never leaves your computer.

## Network

Without an account, the CLI makes no network requests. After `npx codewrapped login`, `npx codewrapped sync` uploads daily totals: counts, tool and model names, file names without paths and repository names without owners. Run `npx codewrapped sync --dry-run` to see the exact payload without sending it. Public pages hide file and repository names until you turn them on in settings.

## Reporting a problem

Open an issue at https://github.com/SergeyGalaxyOrsik/codewrapped/issues. For something that should not be public, open an issue asking for a contact, without details, and I will reply.
