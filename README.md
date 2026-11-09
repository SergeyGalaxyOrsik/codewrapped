# codewrapped

Your month with coding agents, on one card. One command reads your coding agent logs on your computer and makes a shareable card: tokens, hours, repositories, tools and when you work. Works with Claude Code, Codex, Pi (beta), opencode (beta), ZCode (beta), Cursor (beta) and oh-my-pi (beta).

```sh
npx codewrapped
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/card-dark.png">
  <img alt="An example codewrapped card: 44M tokens, 132 hours with agents, $330 at API prices, top repositories, tools and a weekly heatmap" src="docs/card-light.png">
</picture>

Example card with made-up numbers. Yours comes from your own logs.

## What you get

Run the command and you get `codewrapped.png` and a summary in the terminal:

- Tokens, without cache reads, and what they would cost at public API prices (an estimate)
- Hours with agents, counted on the wall clock, plus agent time when sessions run in parallel
- Sessions, prompts and your longest streak
- Top repositories, most edited files and favorite tools
- When you work, as a weekday by hour heatmap
- An archetype, such as Night shift or Shell first

## Private by default

- **What it reads:** session logs in `~/.claude`, `~/.codex`, `~/.pi/agent`, `~/.local/share/opencode`, `~/.zcode/cli/db`, Cursor's chat database, `~/.omp/agent` and any other Claude Code or Codex folders it finds in `~` and `~/.config`. From `~/.zshrc`, `~/.bashrc`, `~/.zprofile` and fish's `config.fish` it keeps only the paths in `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`, `ZCODE_SESSION_DB_PATH` and `ZCODE_SESSION_DB`. From `.git/config` it keeps only the repository name from the remote URL, never credentials. [SECURITY.md](SECURITY.md) lists exactly where it looks.
- **What it counts:** time, tokens, tool calls, model names, file and repository names.
- **What it never uploads:** your prompts, your code, full paths. The list of log folders it found stays in `~/.config/codewrapped/config.json` on your computer.
- **Without an account:** the CLI itself makes no network requests. `npx` downloads the package from npm.

Several Claude Code accounts, such as `~/.claude` and `~/.claude-work`, are found and added up automatically. Folders elsewhere: pass `--claude-dir`, `--codex-dir`, `--pi-dir`, `--opencode-dir`, `--zcode-dir`, `--cursor-dir` or `--omp-dir`. Several computers: run `npx codewrapped sync` on each and the totals add up on your profile.

## Keep your history

Claude Code deletes logs after 30 days. Sign in at [codewrapped.app](https://codewrapped.app) and sync, and your history keeps growing. You also get a public page at `codewrapped.app/@you` and a spot on the leaderboard if you want one.

```sh
npx codewrapped login   # connect this computer in the browser
npx codewrapped sync    # upload daily totals
npx codewrapped logout
```

`login` sends your computer's hostname as the name of the connection, which only you see in settings. `sync` uploads, per day and per agent: counts, tokens, model names with the estimated cost per model, tool names and tool categories, file names without paths, repository names without owners, separate counts for automated runs, and which minutes of the day you were active with an agent. Each upload also carries a random machine id and your time zone.

For a working folder that no longer exists, its folder name is uploaded as a repository name, even if it was never a repository. `--hide-files` and `--hide-repos` leave those names out of the upload.

The first sync shows what will be uploaded and asks before sending. `npx codewrapped sync --dry-run` prints the exact upload and sends nothing. By default, your public page shows totals, cost, models, tools and when you work. File and repository names stay off it until you turn them on.

## Options

```
--period 7d|30d|90d|year|all    Period to show (default 30d)
--source claude|codex|pi|opencode|zcode|cursor|omp|all
                                Which agent to include
--theme light|dark              Card theme
--story                         Story size card, 1080x1920
--out <path>                    Where to write the card
--hide-files, --hide-repos      Leave names out of the card and uploads
--include-automated             Count claude -p, Agent SDK and codex exec runs in hours
--json                          Print the summary as JSON
--claude-dir, --codex-dir, --pi-dir, --opencode-dir, --zcode-dir, --cursor-dir, --omp-dir
                                Read logs from these folders instead
```

Without a folder flag such as `--claude-dir`, the CLI looks in each agent's default folders and environment variables, in folders saved from earlier runs, in shell config files and, for Claude Code and Codex, in a scan of `~` and `~/.config`. A log in more than one folder is counted once. Three more variables change behavior: `CODEWRAPPED_API_URL` sets the server for `login` and `sync`, `XDG_CONFIG_HOME` moves `~/.config/codewrapped`, and `CODEWRAPPED_SQLITE=sql.js` reads databases with sql.js instead of `node:sqlite`. [SECURITY.md](SECURITY.md) has the details.

## How the numbers are counted

- **Hours** are minutes when at least one session was active, with gaps over 5 minutes left out. Parallel sessions count once. Their sum is shown as agent time.
- **Tokens** are input, output and cache writes. Cache reads are listed separately because they are most of the total and would hide everything else.
- **Cost** uses public API prices for every token type, checked on the date in `packages/stats/src/pricing.ts`. Subscription plans are billed differently.
- **Automated runs** (`claude -p`, the Agent SDK, `codex exec`) count in tokens and tools, not in hours, unless you pass `--include-automated`.
- **The leaderboard** is self-reported from local logs. It ranks wall-clock hours, streaks and tokens, never cost, and only shows people who opted in.

## Repository

| Path | What it is |
|---|---|
| `apps/cli` | The `codewrapped` npm package |
| `apps/api` | Hono API on Node with Postgres, deployed with Docker. See [apps/api/README.md](apps/api/README.md) |
| `apps/web` | Next.js site. See [apps/web/README.md](apps/web/README.md) |
| `packages/parser` | One adapter per coding agent (Claude Code, Codex, Pi, opencode, ZCode, Cursor, oh-my-pi) that reads its logs into daily totals. To add one, see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-harness) |
| `packages/stats` | Summaries, archetypes, pricing. Shared by the CLI, API and site, so numbers match everywhere |
| `packages/card` | The card, rendered with satori |
| `packages/brand` | Colors, fonts and the mark |

```sh
pnpm install
pnpm test
pnpm build
pnpm cli          # build the CLI and run it on your logs
```

Requires Node 20.12 or newer.

## Not affiliated

codewrapped is an independent project. It is not affiliated with or endorsed by Anthropic or OpenAI. Claude and Claude Code are trademarks of Anthropic. Codex is a trademark of OpenAI.

Fonts: [Geist](https://vercel.com/font) and [Commit Mono](https://commitmono.com), both under the SIL Open Font License.
