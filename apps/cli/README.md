# codewrapped

Your month with coding agents, on one card. Reads your coding agent logs on your computer and makes a shareable card: tokens, hours, repositories, tools and when you work. Works with Claude Code, Codex, Pi (beta), opencode (beta), ZCode (beta), Cursor (beta) and oh-my-pi (beta).

```sh
npx codewrapped
```

![An example codewrapped card](https://raw.githubusercontent.com/SergeyGalaxyOrsik/codewrapped/main/docs/card-light.png)

- **What it reads:** session logs in `~/.claude`, `~/.codex`, `~/.pi/agent`, `~/.local/share/opencode`, `~/.zcode/cli/db`, Cursor's chat database, `~/.omp/agent` and any other Claude Code or Codex folders it finds (see [SECURITY.md](https://github.com/SergeyGalaxyOrsik/codewrapped/blob/main/SECURITY.md) for exactly where it looks), and from `.git/config` only the repository name from the remote URL, never credentials.
- **What it never keeps:** your prompts, your code, full paths.
- **Without an account:** it makes zero network requests.

Claude Code deletes logs after 30 days. To keep your history and get a public page at codewrapped.app/@you:

```sh
npx codewrapped login
npx codewrapped sync
```

Run `npx codewrapped help` for all options. Source, details and how the numbers are counted: [github.com/SergeyGalaxyOrsik/codewrapped](https://github.com/SergeyGalaxyOrsik/codewrapped).

Not affiliated with Anthropic or OpenAI.
