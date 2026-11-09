# Security and privacy

codewrapped runs on your computer and reads files there. This is exactly what it touches and what it sends.

## What the CLI reads

**For every agent.** A flag such as `--claude-dir` or `--cursor-dir` replaces the lookup for that agent. Without one, the CLI checks the places listed below for each agent, plus the folders it found on earlier runs, saved in `~/.config/codewrapped/config.json`. Folders given with a flag are not saved.

**Shell config files.** It reads `~/.zshrc`, `~/.bashrc`, `~/.zprofile` and `~/.config/fish/config.fish` and looks for five variables, including inside aliases: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`, `ZCODE_SESSION_DB_PATH` and `ZCODE_SESSION_DB`. It keeps a value only when it is a path, and uses that path only when its content looks like that agent's logs. Nothing else from these files is kept, printed or sent.

**Claude Code and Codex.** Without `--claude-dir` or `--codex-dir`, it looks for log folders in this order:

1. `$CLAUDE_CONFIG_DIR` (comma separated is allowed) and `$CODEX_HOME` from the environment.
2. The defaults: `~/.claude`, `~/.config/claude` and `~/.codex`.
3. Folders saved from earlier runs.
4. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` values in shell config files.
5. Folders one level deep in `~` and `~/.config` whose names start with `.claude`, `claude`, `.codex` or `codex`, in any case. To find them it lists the folder names in those two places.

Folders from steps 4 and 5 are used only when their content looks like logs. For Claude Code that is `projects/<project>/<session>.jsonl` with Claude Code events, and for Codex it is `sessions/YYYY/MM/DD/rollout-*.jsonl`.

Inside a log folder it reads `projects/` (Claude Code) or `sessions/` and `archived_sessions/` (Codex).

**Pi (beta).** It reads the folder in `$PI_CODING_AGENT_SESSION_DIR`, then `sessions/` in `$PI_CODING_AGENT_DIR` and in `~/.pi/agent`. When `settings.json` in one of those two folders sets `sessionDir`, it reads that folder instead of `sessions/`. That is the only key it reads from `settings.json`. After that come saved folders, and `PI_CODING_AGENT_DIR` values in shell config files when they hold Pi sessions. `--pi-dir` replaces this lookup.

**opencode (beta).** It reads `opencode.db` in `$XDG_DATA_HOME/opencode` and `~/.local/share/opencode`, and, from versions before the database, JSON files under `storage/session/`, `storage/message/` and `storage/part/` there. The database is copied with its `-wal` and `-shm` files into a temporary folder, opened read-only there and deleted afterwards, so a running opencode is never touched. Only the `session`, `message` and `part` tables are read, plus the row count of `session_message`, never the account or credential tables. Message and part rows hold message text and tool output. The CLI reads them and keeps only what is listed under [What it keeps](#what-it-keeps). `--opencode-dir` replaces this lookup.

**ZCode (beta).** It reads the session database ZCode's CLI and desktop app share: the file in `$ZCODE_SESSION_DB_PATH` (or `$ZCODE_SESSION_DB`), the file `storage.sessionDbPath` names in `~/.zcode/cli/config.json` (only that key is read), and `~/.zcode/cli/db/db.sqlite`. Like opencode's, the database is copied with its `-wal` and `-shm` files, opened read-only and deleted afterwards. Only the `session`, `message`, `part` and `session_task_link` tables are read. From messages and tool calls it reads only times, model names, token counts, tool names, shell commands, edited file paths and patch text. From a shell command it uses only the first word, to sort the call as a search or a shell command. From a patch it uses only the file names in its headers. Message text and tool output are never read. `~/.zcode/v2` (credentials, settings, old snapshots) is never opened. `--zcode-dir` replaces this lookup.

**Cursor (beta).** It reads the agent chats of the Cursor editor from its state database, `User/globalStorage/state.vscdb` in Cursor's folder (`~/Library/Application Support/Cursor` on macOS, `$XDG_CONFIG_HOME/Cursor` or `~/.config/Cursor` on Linux, `%APPDATA%\Cursor` on Windows). The file runs to gigabytes, so with `node:sqlite` it is opened read-only where it is instead of copied. SQLite lets a reader share it with a running Cursor. From its `cursorDiskKV` table only `composerData:` and `bubbleId:` rows are read, plus `composerHeaders`. From them it reads only times, model names, token counts, tool names, shell commands, edited file paths and patch text. From a shell command it uses only the first word, to sort the call as a search or a shell command. From a patch it uses only the file names in its headers. Prompts, replies and tool output are never read. The `ItemTable` of this global database, where Cursor keeps its login tokens, is never queried. To find a chat's folder it reads `workspace.json` and the `composer.composerData` key of the `ItemTable` in each workspace's own `state.vscdb` in `User/workspaceStorage`, and the folder list of a `.code-workspace` file. Cursor keeps token counts only for some older chats, so Cursor tokens are partial. The cursor-agent CLI (`~/.cursor`) is not read. `--cursor-dir` replaces this lookup.

**oh-my-pi (beta).** It reads `sessions/` in `~/.omp/agent` (or `~` joined with `$PI_CONFIG_DIR`), in each profile under `~/.omp/profiles/`, and in `$XDG_DATA_HOME/omp` when that folder exists. oh-my-pi reads Pi's `$PI_CODING_AGENT_DIR` and `$PI_CODING_AGENT_SESSION_DIR` too, so those folders are used only when a session there starts with oh-my-pi's title line, and the Pi adapter skips files that start with it. From each session it takes only times, the working directory, model names, token counts, recorded cost, tool names, shell commands (for their first word), edited file paths and patch headers (for file names). Prompts, replies and tool output are never kept. Settings, `agent.db` (credentials) and the rest of `~/.omp` are never opened. Not read yet: archives from `omp gc` (`archive/sessions/`), collab replicas in `~/.omp/collab`, and sessions placed elsewhere with `--session-dir`. Pass that folder with `--omp-dir`, which replaces this lookup.

**Repositories.** For each working directory in the logs, it walks up to the git root, reads `.git/config` and keeps only the repository name from the remote URL, never the owner, host or credentials. In a git worktree, `.git` is a file. The CLI follows its `gitdir:` line and the `commondir` file there to the main repository's `config`. Without a remote, it uses the main checkout's folder name. A folder outside a git repository has no repository name. When a Codex session recorded its remote URL, only the last part of that URL is kept, the same way.

A working directory that no longer exists cannot be checked for git, so its folder name is used as the repository name, even if it was never a repository. Agent worktrees under `.claude/worktrees/` and `~/.codex/worktrees/` map to their repository, and temporary folders such as `/tmp` are skipped. Pass `--hide-repos` to keep every repository name out of the card and the upload.

**Environment variables.** Besides the folder variables above, three change what the CLI does:

- `CODEWRAPPED_API_URL` sets the server that `login`, `sync` and `logout` talk to. The default is `https://api.codewrapped.app`.
- `XDG_CONFIG_HOME` moves `~/.config/codewrapped/` to `$XDG_CONFIG_HOME/codewrapped/`. On Linux it also moves Cursor's folder.
- `CODEWRAPPED_SQLITE=sql.js` reads databases with the bundled sql.js instead of `node:sqlite`. sql.js is also used on Node versions without `node:sqlite`. With sql.js, Cursor's database is copied to a temporary folder like the others, and a database over 512 MB is skipped.

## What it keeps

From the logs it counts time, tokens, tool calls, model names, file names and repository names. Logs contain your prompts and code. The CLI reads them and keeps only those counts and names. It never uploads your prompts, your code or full paths.

On your computer, `~/.config/codewrapped/` holds `config.json` and, after `login`, `auth.json` with your token (readable by you only). `config.json` holds a random machine id, the full paths of the log folders it found and sync state. The folder paths never leave your computer. The card is written to `codewrapped.png`, or `codewrapped-story.png` with `--story`, in the current folder unless you pass `--out`.

## Network

The CLI itself makes no network requests unless you run `login`, `sync` or `logout`. Making a card never contacts a server, even when you are signed in. `npx codewrapped` downloads the package from npm before it runs.

`login` sends your computer's hostname and the random machine id. The hostname is the name of the connection in your settings, and only you see it.

`sync` uploads one row per day and per agent:

- Counts: sessions, prompts, active minutes, agent minutes, the most sessions at once, the minutes of the longest session and tokens by type.
- Which minutes of the day you were active with an agent, as a map of 1,440 bits, one per minute.
- Model names, with tokens and the estimated cost per model.
- Tool names with call counts, and calls per tool category such as `shell`, `edit` or `search`.
- File names without paths, with edit counts.
- Repository names without owners, with minutes and tokens.
- For automated runs (`claude -p`, the Agent SDK, `codex exec`), the same session and minute counts, the minute map and minutes per repository, kept apart from your own sessions.

Each request also carries the random machine id and your time zone, such as `Europe/Berlin`. `--hide-files` and `--hide-repos` leave file and repository names out. Run `npx codewrapped sync --dry-run` to print the exact request bodies without sending them.

By default, your public page at `codewrapped.app/@you` shows totals, cost, models, tools and when you work, as an hour by weekday heatmap and minutes per day. File and repository names stay hidden until you turn them on in settings. The leaderboard shows only people who opt in.

## Reporting a vulnerability

Report it privately on GitHub: open the **Security** tab of [the repository](https://github.com/SergeyGalaxyOrsik/codewrapped) and click **Report a vulnerability**, or go straight to [the new advisory form](https://github.com/SergeyGalaxyOrsik/codewrapped/security/advisories/new). Do not open a public issue for a vulnerability.

For anything else, open an issue at https://github.com/SergeyGalaxyOrsik/codewrapped/issues.
