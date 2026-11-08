import { createInterface } from "node:readline/promises";
import { addDays, type DailyAggregate } from "@codewrapped/stats";
import { api, ApiError } from "../api";
import { apiUrl, loadAuth, loadConfig, saveConfig, webUrlFor } from "../config";
import { bold, dim, int } from "../ui";

/** Claude Code deletes old transcripts, so days this old may be incomplete on disk. */
const SAFE_DAYS = 27;
const MAX_CHUNK_BYTES = 900_000;
const MAX_CHUNK_DAYS = 400;

/**
 * Days to upload: everything after the last synced day, plus recent days that
 * may have grown since. Older days that were already synced are left alone,
 * so a day that is now partly deleted locally never replaces a complete one.
 */
export function daysToUpload(days: DailyAggregate[], lastSyncedDay: string | undefined, today: string): DailyAggregate[] {
  if (!lastSyncedDay) return days;
  const safeFrom = addDays(today, -SAFE_DAYS);
  return days.filter((d) => d.day > lastSyncedDay || d.day >= safeFrom);
}

/** Leaves out what the user chose not to upload. */
export function stripForUpload(days: DailyAggregate[], opts: { hideFiles: boolean; hideRepos: boolean }): DailyAggregate[] {
  return days.map((d) => ({
    ...d,
    files: opts.hideFiles ? {} : d.files,
    repos: opts.hideRepos ? {} : d.repos,
    automated: { ...d.automated, repoMinutes: opts.hideRepos ? {} : d.automated.repoMinutes },
  }));
}

/** Splits rows into requests under the server's 1 MB limit. */
export function chunk(days: DailyAggregate[]): DailyAggregate[][] {
  const chunks: DailyAggregate[][] = [];
  let current: DailyAggregate[] = [];
  let size = 0;
  for (const d of days) {
    const bytes = JSON.stringify(d).length + 1;
    if (current.length > 0 && (size + bytes > MAX_CHUNK_BYTES || current.length >= MAX_CHUNK_DAYS)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(d);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function union(days: DailyAggregate[], pick: (d: DailyAggregate) => Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const d of days) for (const k of Object.keys(pick(d))) names.add(k);
  return [...names].sort();
}

function preview(days: DailyAggregate[], timeZone: string): string[] {
  const sample = (names: string[]) => (names.length === 0 ? "none" : `${int(names.length)}, for example ${names.slice(0, 4).join(", ")}`);
  return [
    `This uploads daily totals for ${int(new Set(days.map((d) => d.day)).size)} days from this computer:`,
    "  counts: sessions, prompts, active minutes, tokens, cost estimates, tool calls",
    `  models: ${union(days, (d) => d.models).join(", ") || "none"}`,
    `  tool names: ${sample(union(days, (d) => d.tools))}`,
    `  file names without paths: ${sample(union(days, (d) => d.files))}`,
    `  repository names without owners: ${sample(union(days, (d) => d.repos))}`,
    `  your timezone: ${timeZone}`,
    "Not uploaded: prompts, messages, code, full paths, git remotes.",
    dim("File and repository names stay hidden on your public page until you turn them on in settings."),
  ];
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export type SyncInput = {
  aggregates: DailyAggregate[];
  timeZone: string;
  today: string;
  dryRun: boolean;
  yes: boolean;
  hideFiles: boolean;
  hideRepos: boolean;
};

export async function sync(input: SyncInput, out: (s?: string) => void): Promise<number> {
  const base = apiUrl();
  const config = await loadConfig();
  const days = stripForUpload(
    daysToUpload(input.aggregates, config.lastSyncedDay?.[base], input.today),
    input,
  ).sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));
  const chunks = chunk(days);

  if (input.dryRun) {
    // The exact request bodies, nothing sent.
    out(JSON.stringify(chunks.map((c) => ({ machineId: config.machineId, timeZone: input.timeZone, days: c })), null, 2));
    return 0;
  }

  const auth = await loadAuth();
  if (!auth || auth.apiUrl !== base) {
    out('This computer is not connected. Run "npx codewrapped login" first.');
    return 1;
  }
  if (days.length === 0) {
    out("Nothing new to upload.");
    return 0;
  }

  if (!config.syncConsentAt) {
    for (const line of preview(days, input.timeZone)) out(line);
    if (!input.yes) {
      if (!process.stdin.isTTY) {
        out('Run "npx codewrapped sync" in a terminal once to confirm, or add --yes.');
        return 1;
      }
      if (!(await confirm("Upload now? [y/N] "))) {
        out("Nothing was uploaded.");
        return 0;
      }
    }
    config.syncConsentAt = new Date().toISOString();
    await saveConfig(config);
  }

  let profileUrl: string | null = null;
  try {
    for (const [i, c] of chunks.entries()) {
      if (chunks.length > 1) out(dim(`Uploading part ${i + 1} of ${chunks.length}...`));
      const res = await api<{ received: number; profileUrl: string | null }>(base, "POST", "/sync", {
        token: auth.token,
        body: { machineId: config.machineId, timeZone: input.timeZone, days: c },
      });
      profileUrl = res.profileUrl;
    }
  } catch (e) {
    if (e instanceof ApiError) {
      out(e.message);
      return 1;
    }
    throw e;
  }

  const lastDay = days[days.length - 1]!.day;
  config.lastSyncedDay = { ...config.lastSyncedDay, [base]: lastDay };
  await saveConfig(config);
  out(`Uploaded ${int(new Set(days.map((d) => d.day)).size)} days, ${days[0]!.day} to ${lastDay}.`);
  out(`Your page: ${bold(profileUrl ?? `${webUrlFor(base)}/@${auth.handle}`)}`);
  return 0;
}
