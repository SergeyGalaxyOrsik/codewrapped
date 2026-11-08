import {
  createGitRepoResolver,
  findLocalLogs,
  LocalClock,
  parseFiles,
  systemTimeZone,
  type Agent,
  type LocalLogs,
  type ParseWarnings,
} from "@codewrapped/parser";
import { summarize, PRICING_CHECKED_ON } from "@codewrapped/stats";
import pkg from "../package.json";
import { HELP, parseCli, UsageError, type CliOptions } from "./args";
import { openFile, shareUrl, writeCard } from "./card";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { sync } from "./commands/sync";
import { loadAuth, loadConfig, saveConfig, type Config } from "./config";
import { formatSummary, SOURCE_NAMES } from "./format";
import { dim, int, pad, tildify } from "./ui";

const out = (s = "") => process.stdout.write(`${s}\n`);
const err = (s = "") => process.stderr.write(`${s}\n`);

function warningLine(w: { claude: ParseWarnings; codex: ParseWarnings }): string | null {
  const bad = w.claude.badLines + w.codex.badLines;
  const unknown = [w.claude, w.codex].reduce(
    (n, x) => n + Object.values(x.unknownEvents).reduce((a, b) => a + b, 0),
    0,
  );
  const parts: string[] = [];
  if (bad > 0) parts.push(`${int(bad)} unreadable ${bad === 1 ? "line" : "lines"}`);
  if (unknown > 0) parts.push(`${int(unknown)} unknown ${unknown === 1 ? "event" : "events"}`);
  return parts.length > 0 ? `Skipped ${parts.join(" and ")}.` : null;
}

type LocalData = Awaited<ReturnType<typeof parseFiles>> & {
  timeZone: string;
  today: string;
  counts: string[];
  started: number;
  folders: string[];
  files: { claude: number; codex: number };
};

const AGENT_NAMES: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };
const sessions = (n: number) => `${int(n)} ${n === 1 ? "session" : "sessions"}`;

/**
 * Lists the log folders on the first run and saves them; later runs mention
 * only folders that are new. Folders given with --claude-dir or --codex-dir
 * are not saved.
 */
async function reportFolders(opts: CliOptions, logs: LocalLogs, config: Config, say: (s?: string) => void): Promise<void> {
  const agents = (["claude", "codex"] as const).filter(
    (a) => (opts.source === "all" || opts.source === a) && (a === "claude" ? opts.claudeDirs : opts.codexDirs).length === 0,
  );
  const roots = logs.roots.filter((r) => agents.includes(r.agent));
  if (agents.length === 0 || roots.length === 0) return;
  const before = config.logFolders;
  const fresh = before ? roots.filter((r) => !(before[r.agent] ?? []).includes(r.root)) : roots;
  if (!before) {
    const width = Math.max(...roots.map((r) => tildify(r.root).length)) + 3;
    say(dim("Found logs in"));
    for (const r of roots) say(dim(`  ${pad(tildify(r.root), width)}${AGENT_NAMES[r.agent]}, ${sessions(r.sessions)}`));
  } else if (fresh.length > 0) {
    const list = fresh.map((r) => `${tildify(r.root)} (${AGENT_NAMES[r.agent]}, ${sessions(r.sessions)})`).join(", ");
    say(dim(`New log ${fresh.length === 1 ? "folder" : "folders"}: ${list}`));
  }
  if (!before || fresh.length > 0) {
    const next = { ...before };
    for (const a of agents) next[a] = [...new Set([...(before?.[a] ?? []), ...roots.filter((r) => r.agent === a).map((r) => r.root)])];
    await saveConfig({ ...(await loadConfig()), logFolders: next });
  }
}

/** Finds and parses local logs. Prints a friendly message and returns null when there are none. */
async function readLocal(opts: CliOptions, say: (s?: string) => void): Promise<LocalData | null> {
  const timeZone = opts.timeZone ?? systemTimeZone();
  const config = await loadConfig();
  const logs = await findLocalLogs(opts.source, {
    claudeDirs: opts.claudeDirs,
    codexDirs: opts.codexDirs,
    saved: config.logFolders,
  });
  await reportFolders(opts, logs, config, say);
  const fileCount = logs.claudeFiles.length + logs.codexFiles.length;
  if (fileCount === 0) {
    const which = opts.source === "all" ? "Claude Code or Codex" : SOURCE_NAMES[opts.source];
    err(`\nNo ${which} logs found. Checked:`);
    for (const f of logs.folders.checked) err(`  ${tildify(f)}`);
    if (opts.claudeDirs.length > 0 || opts.codexDirs.length > 0) {
      err("\nCheck the paths given to --claude-dir and --codex-dir.");
    } else {
      err("\nRun Claude Code or Codex once, then try again.");
      err("If your logs are somewhere else, pass --claude-dir or --codex-dir.");
    }
    return null;
  }

  const counts = [
    logs.claudeFiles.length > 0 ? `${int(logs.claudeFiles.length)} Claude Code` : null,
    logs.codexFiles.length > 0 ? `${int(logs.codexFiles.length)} Codex` : null,
  ].filter((x): x is string => x !== null);
  if (process.stderr.isTTY) process.stderr.write(dim(`Reading ${counts.join(" and ")} logs...`));
  const started = Date.now();
  const parsed = await parseFiles({
    claudeFiles: logs.claudeFiles,
    codexFiles: logs.codexFiles,
    timeZone,
    // Reads .git/config of each working directory to name its repository.
    repoResolver: createGitRepoResolver(),
  });
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
  return {
    ...parsed,
    timeZone,
    today: new LocalClock(timeZone).local(Date.now()).day,
    counts,
    started,
    folders: [...logs.folders.claude, ...logs.folders.codex].map(tildify),
    files: { claude: logs.claudeFiles.length, codex: logs.codexFiles.length },
  };
}

async function wrap(opts: CliOptions): Promise<number> {
  const log = opts.json ? err : out;
  log(dim("codewrapped -- reads logs on this computer. No network calls."));
  const local = await readLocal(opts, log);
  if (!local) return 1;
  const { aggregates, warnings, timeZone, today, counts, started } = local;

  const summary = summarize(aggregates, {
    period: opts.period,
    today,
    source: opts.source,
    hideFiles: opts.hideFiles,
    hideRepos: opts.hideRepos,
    includeAutomated: opts.includeAutomated,
  });

  if (opts.json) {
    out(
      JSON.stringify(
        {
          summary,
          meta: {
            version: pkg.version,
            timeZone,
            pricingCheckedOn: PRICING_CHECKED_ON,
            folders: local.folders,
            files: local.files,
            warnings,
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const cardPath = await writeCard(summary, {
    theme: opts.theme,
    format: opts.story ? "story" : "landscape",
    out: opts.out,
  });
  if (process.stdout.isTTY) openFile(cardPath);

  out();
  out(formatSummary(summary));
  out();
  out(`Saved ${tildify(cardPath)}`);
  out(`Share it: ${shareUrl(summary)}`);
  out(dim("Attach the image to the post."));
  out();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  out(dim(`Read ${counts.join(" and ")} log files in ${seconds}s. Times in ${timeZone}.`));
  const w = warningLine(warnings);
  if (w) out(dim(w));
  if (summary.truncated) {
    out();
    out(`Your logs start on ${summary.firstDataDay}, so this covers ${summary.range.days} days.`);
    // The 30 day cleanup is a Claude Code setting. Codex keeps its logs.
    if (opts.source !== "codex") out(
      dim(
        'Claude Code deletes transcripts after 30 days. Set "cleanupPeriodDays" in ~/.claude/settings.json to keep more,\nor run "npx codewrapped sync" regularly to keep daily totals online.',
      ),
    );
  }
  if (!(await loadAuth())) {
    out();
    out(`Keep your history past 30 days and get a public page: ${"npx codewrapped login"}`);
  }
  return 0;
}

async function runSync(opts: CliOptions): Promise<number> {
  if (!opts.dryRun) out(dim("codewrapped sync -- uploads daily totals, never prompts, code or paths."));
  else err(dim("codewrapped sync --dry-run -- prints what would be uploaded. Nothing is sent."));
  const local = await readLocal(opts, opts.dryRun ? err : out);
  if (!local) return 1;
  return sync(
    {
      aggregates: local.aggregates,
      timeZone: local.timeZone,
      today: local.today,
      dryRun: opts.dryRun,
      yes: opts.yes,
      hideFiles: opts.hideFiles,
      hideRepos: opts.hideRepos,
    },
    out,
  );
}

async function main(): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      err(e.message);
      return 2;
    }
    throw e;
  }
  switch (opts.command) {
    case "help":
      out(HELP);
      return 0;
    case "version":
      out(pkg.version);
      return 0;
    case "login":
      return login(out);
    case "sync":
      return runSync(opts);
    case "logout":
      return logout(out);
    case "wrap":
      return wrap(opts);
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    err(`codewrapped stopped on an unexpected error: ${(e as Error)?.message ?? e}`);
    err("Run it again. If it stops at the same place, run with --source claude or --source codex to find the log that causes it.");
    process.exit(1);
  },
);
