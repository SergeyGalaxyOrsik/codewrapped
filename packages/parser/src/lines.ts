import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type ParseWarnings = {
  files: number;
  lines: number;
  /** Lines that are not valid JSON, usually a half-written last line. */
  badLines: number;
  /** Event types this parser does not know, with counts. They are skipped. */
  unknownEvents: Record<string, number>;
};

export function emptyWarnings(): ParseWarnings {
  return { files: 0, lines: 0, badLines: 0, unknownEvents: {} };
}

/** Streams a JSONL file and calls `onEvent` for each parsed object. */
export async function readJsonl(
  file: string,
  warnings: ParseWarnings,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  warnings.files += 1;
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    warnings.lines += 1;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      warnings.badLines += 1;
      continue;
    }
    if (event && typeof event === "object" && !Array.isArray(event)) onEvent(event as Record<string, unknown>);
    else warnings.badLines += 1;
  }
}

export function countUnknown(warnings: ParseWarnings, type: string): void {
  warnings.unknownEvents[type] = (warnings.unknownEvents[type] ?? 0) + 1;
}

export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
