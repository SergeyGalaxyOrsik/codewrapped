# Contributing

Issues and pull requests are welcome. Run `pnpm install`, then `pnpm test` and `pnpm typecheck` before you open a pull request.

Never commit real logs, real numbers, project names or paths from your machine. Fixtures are written by hand.

## Adding a harness

Each coding agent harness is one adapter in `packages/parser/src/adapters/`. An adapter finds the logs and turns them into a small set of events. Everything after that (days, hours, repositories, cost, the card) is shared and does not change.

An adapter ships only after it was checked against real logs of that harness. If you cannot do that, open an issue with the "Add support for a coding agent" template instead.

### 1. Know the format

Find where the harness keeps sessions and which environment variables move that folder. Write down the version you looked at. Note:

- what a session is, and whether subagents, forks or branches write extra sessions or copy events;
- where prompts, model replies, token usage, tool calls and file edits are, and how to tell a person's prompt from a tool result;
- whether the harness records its own cost per request;
- how a run started by a script (like `claude -p` or `codex exec`) differs from one a person started.

### 2. Write the adapter

Implement `Adapter` from `packages/parser/src/adapter.ts`:

| Member | What it does |
| --- | --- |
| `id` | Short id, also stored with every synced row. Add it to `SOURCES` and `SOURCE_NAMES` in `packages/stats/src/types.ts`. |
| `discover(ctx)` | Candidate folders in order: env variable, defaults, `ctx.saved`, `ctx.shellValues(VAR)`, matching `ctx.homeFolders`. Mark guesses `verify: true`. |
| `shellVars`, `subdirs` | Variables to look for in shell config files, and the folders under an account folder that hold logs. |
| `looksLike(root)` | Checks a few files to confirm a guessed folder holds this harness's logs. Must stay cheap. |
| `listFiles(dirs)` | Log files as sorted real paths, each once. |
| `countSessions(dirs, files)` | Main sessions, for the "Found logs in" line. |
| `parse(files, emit, warnings)` | Reads files and calls `emit` with `HarnessEvent`s. Never throws on bad input; counts it in `warnings`. |

Events (`HarnessEvent`):

- `session`: id, optional `parent` for subagents (their time and tokens go to the root session), `automated`.
- `tick`: anything that happened at a time, with the `cwd`. `active: true` for a prompt or model reply. The session timeline is built from ticks.
- `prompt`: a prompt a person sent.
- `usage`: one model request, split into input, output, cache read and cache write. Pass `costUsd` when the harness records it; it wins over the price table.
- `tool`: one call, with the raw name and `toolCategory(name)`. If the harness has tool names the table in `packages/stats/src/tools.ts` does not know, add them there.
- `edit`: one file edit, basename only.

Rules:

- Pass the working directory, never a repository name: the aggregator resolves repositories the same way for every harness.
- Count each request, tool call and prompt once, even when the harness copies them into forks, resumed sessions or a second folder.
- Read only what the events need. Prompts, replies, code and full paths never leave the adapter.
- Open databases read-only, on a copy, so a running harness is never affected.

### 3. Register and test

Add the adapter to `ADAPTERS` in `packages/parser/src/adapters/index.ts` and to `--source` docs in the README. The CLI gets `--<id>-dir` on its own.

Add hand-written fixtures under `packages/parser/fixtures/<id>/` and tests next to the others: one session with a prompt, usage, a tool call and an edit; a subagent or branch; a duplicate; an automated run; a bad line. Update `test/__snapshots__` only for the new adapter: the snapshots of existing adapters must not change.

Run the CLI on your own logs (`pnpm cli --source <id> --json`) and compare a few days with what the harness itself reports.

Deploy the API before releasing a CLI with a new `id`: the API rejects rows from harnesses it does not know.

### Prices

Add missing models to `packages/stats/src/pricing.ts` with the official price page in the comment at the top. Leave a model out rather than guess.
