import { parseArgs } from "node:util";
import { PERIODS, SOURCE_NAMES, SOURCES, type Period, type Source, type SourceFilter } from "@codewrapped/stats";

export type Command = "wrap" | "login" | "sync" | "logout" | "help" | "version";

export type CliOptions = {
  command: Command;
  period: Period;
  source: SourceFilter;
  theme: "light" | "dark";
  story: boolean;
  hideFiles: boolean;
  hideRepos: boolean;
  out: string | null;
  json: boolean;
  dryRun: boolean;
  timeZone: string | null;
  /** --claude-dir, --codex-dir: folders that replace auto-detection for that harness. */
  dirs: Partial<Record<Source, string[]>>;
  includeAutomated: boolean;
  yes: boolean;
};

export class UsageError extends Error {}

const COMMANDS = new Set(["login", "sync", "logout", "help"]);
const SOURCE_FILTERS = [...SOURCES, "all"] as const;
const dirFlag = (s: Source) => `${s}-dir` as const;
const THEMES = ["light", "dark"] as const;

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`Unknown value "${value}" for --${flag}. Use ${allowed.join(", ")}.`);
}

export function parseCli(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        period: { type: "string" },
        source: { type: "string" },
        theme: { type: "string" },
        story: { type: "boolean" },
        "hide-files": { type: "boolean" },
        "hide-repos": { type: "boolean" },
        out: { type: "string" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
        tz: { type: "string" },
        ...Object.fromEntries(SOURCES.map((s) => [dirFlag(s), { type: "string", multiple: true } as const])),
        "include-automated": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    throw new UsageError(`${(err as Error).message.split("\n")[0]} Run "npx codewrapped help" to see all flags.`);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Expected one command, got "${positionals.join(" ")}".`);
  const first = positionals[0];
  if (first !== undefined && !COMMANDS.has(first)) {
    throw new UsageError(`Unknown command "${first}". Commands: login, sync, logout, help.`);
  }
  let command: Command = (first as Command | undefined) ?? "wrap";
  if (values.help) command = "help";
  if (values.version) command = "version";

  if (values.tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.tz });
    } catch {
      throw new UsageError(`Unknown timezone "${values.tz}". Use an IANA name such as Europe/Berlin.`);
    }
  }

  return {
    command,
    period: oneOf("period", values.period, PERIODS, "30d"),
    source: oneOf("source", values.source, SOURCE_FILTERS, "all"),
    theme: oneOf("theme", values.theme, THEMES, "light"),
    story: values.story ?? false,
    hideFiles: values["hide-files"] ?? false,
    hideRepos: values["hide-repos"] ?? false,
    out: values.out ?? null,
    json: values.json ?? false,
    dryRun: values["dry-run"] ?? false,
    timeZone: values.tz ?? null,
    dirs: Object.fromEntries(
      SOURCES.flatMap((s) => {
        const v = (values as Record<string, unknown>)[dirFlag(s)];
        return Array.isArray(v) && v.length > 0 ? [[s, v as string[]]] : [];
      }),
    ),
    includeAutomated: values["include-automated"] ?? false,
    yes: values.yes ?? false,
  };
}

/** Pads a flag to the help column. */
const pad = (s: string) => s.padEnd(32);

export const HELP = `codewrapped -- a Wrapped for your coding agents

Usage
  npx codewrapped                 Read local logs and show your stats
  npx codewrapped login           Connect this computer to codewrapped.app
  npx codewrapped sync            Upload daily totals to your profile
  npx codewrapped logout          Disconnect this computer

Flags
  --period 7d|30d|90d|year|all    Period to show (default 30d)
  ${pad(`--source ${SOURCE_FILTERS.join("|")}`)}Which agent to include (default all)
  --hide-files                    Leave file names out (also from uploads)
  --hide-repos                    Leave repository names out (also from uploads)
  --include-automated             Count claude -p, Agent SDK and codex exec runs in hours
  --json                          Print the summary as JSON
  --tz <zone>                     Timezone for days and hours (default: system)
${SOURCES.map((s) => `  ${pad(`--${dirFlag(s)} <path>`)}Only these ${SOURCE_NAMES[s]} folders, no auto-detection (repeatable)`).join("\n")}
  --theme light|dark              Card theme
  --story                         Card in story size, 1080x1920
  --out <path>                    Where to write the card
  --dry-run                       For sync: print the payload, send nothing
  --yes                           For sync: skip the first-time confirmation

The default run reads files on this computer and makes no network calls.`;
