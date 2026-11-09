import { createReadStream } from "node:fs";

export type ParseWarnings = {
  files: number;
  lines: number;
  /** Lines that are not valid JSON, usually a half-written last line. */
  badLines: number;
  /** Lines over MAX_LINE_BYTES. They are skipped without being held in memory. */
  longLines?: number;
  /** Files that could not be read, such as ones without read permission. */
  unreadableFiles?: Array<{ file: string; reason: string }>;
  /** Event types this parser does not know, with counts. They are skipped. */
  unknownEvents: Record<string, number>;
};

export function emptyWarnings(): ParseWarnings {
  return { files: 0, lines: 0, badLines: 0, unknownEvents: Object.create(null) };
}

/** Longer lines are skipped. No harness writes one this long; a file that has one is damaged or not a log. */
export const MAX_LINE_BYTES = 64 * 1024 * 1024;

const NEWLINE = 0x0a;
const CR = 0x0d;

function parseLine(bytes: Buffer, warnings: ParseWarnings, onEvent: (event: Record<string, unknown>) => void): void {
  const end = bytes.length > 0 && bytes[bytes.length - 1] === CR ? bytes.length - 1 : bytes.length;
  if (end === 0) return;
  warnings.lines += 1;
  let event: unknown;
  try {
    event = JSON.parse(bytes.toString("utf8", 0, end));
  } catch {
    warnings.badLines += 1;
    return;
  }
  if (event && typeof event === "object" && !Array.isArray(event)) onEvent(event as Record<string, unknown>);
  else warnings.badLines += 1;
}

/**
 * Streams a JSONL file and calls `onEvent` for each parsed object. A file
 * that cannot be read is recorded in `warnings.unreadableFiles`; events read
 * before the error are kept.
 */
export async function readJsonl(
  file: string,
  warnings: ParseWarnings,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  warnings.files += 1;
  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
  const chunks: AsyncIterator<Buffer> = stream[Symbol.asyncIterator]();
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let tooLong = false;

  const endLine = (tail: Buffer) => {
    if (tooLong || pendingBytes + tail.length > MAX_LINE_BYTES) warnings.longLines = (warnings.longLines ?? 0) + 1;
    else parseLine(pending.length > 0 ? Buffer.concat([...pending, tail]) : tail, warnings, onEvent);
    pending = [];
    pendingBytes = 0;
    tooLong = false;
  };

  try {
    for (;;) {
      let next: IteratorResult<Buffer>;
      try {
        next = await chunks.next();
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        (warnings.unreadableFiles ??= []).push({ file, reason: err.code ?? err.message ?? String(e) });
        return;
      }
      if (next.done) break;
      const chunk = next.value;
      let start = 0;
      for (let nl = chunk.indexOf(NEWLINE); nl !== -1; nl = chunk.indexOf(NEWLINE, start)) {
        endLine(chunk.subarray(start, nl));
        start = nl + 1;
      }
      if (tooLong || start === chunk.length) continue;
      pendingBytes += chunk.length - start;
      if (pendingBytes > MAX_LINE_BYTES) {
        tooLong = true;
        pending = [];
        pendingBytes = 0;
      } else pending.push(chunk.subarray(start));
    }
    if (tooLong || pendingBytes > 0) endLine(Buffer.alloc(0));
  } finally {
    stream.destroy();
  }
}

/** The type comes from the log, so "__proto__" or "constructor" must count as plain keys. */
export function countUnknown(warnings: ParseWarnings, type: string): void {
  const events = warnings.unknownEvents;
  const n = Object.hasOwn(events, type) ? events[type]! : 0;
  Object.defineProperty(events, type, { value: n + 1, enumerable: true, writable: true, configurable: true });
}

export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
