const SLOT_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

export type LocalTime = { day: string; hour: number };

/**
 * Converts UTC instants to local day and hour for one IANA timezone.
 * Offsets are cached per 15 minute slot, which covers every real DST rule.
 */
export class LocalClock {
  readonly timeZone: string;
  private readonly fmt: Intl.DateTimeFormat;
  private readonly offsets = new Map<number, number>();

  constructor(timeZone: string) {
    this.timeZone = timeZone;
    this.fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /** Local time minus UTC, in ms, at the given instant. */
  offsetMs(ms: number): number {
    const slot = Math.floor(ms / SLOT_MS);
    const cached = this.offsets.get(slot);
    if (cached !== undefined) return cached;
    const at = slot * SLOT_MS;
    const p: Record<string, number> = {};
    for (const part of this.fmt.formatToParts(at)) {
      if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
    const offset = asUtc - at;
    this.offsets.set(slot, offset);
    return offset;
  }

  /** Minute of the local day, 0-1439. */
  minuteOfDay(ms: number): number {
    const d = new Date(ms + this.offsetMs(ms));
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  local(ms: number): LocalTime {
    const d = new Date(ms + this.offsetMs(ms));
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }

  /**
   * Splits [start, end) at local hour boundaries (and so at midnight) and
   * reports each piece with its local time and length in minutes.
   */
  split(start: number, end: number, add: (t: LocalTime, minutes: number, from: number, to: number) => void): void {
    let t = start;
    while (t < end) {
      const offset = this.offsetMs(t);
      const localMs = t + offset;
      const nextBoundary = (Math.floor(localMs / HOUR_MS) + 1) * HOUR_MS - offset;
      const segEnd = nextBoundary > t ? Math.min(end, nextBoundary) : end;
      add(this.local(t), (segEnd - t) / 60_000, t, segEnd);
      t = segEnd;
    }
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
