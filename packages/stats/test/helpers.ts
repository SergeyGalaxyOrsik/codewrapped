import { emptyAggregate, emptyMask, encodeMask, setRange, type DailyAggregate, type Source } from "../src/index";

type AggInput = Omit<Partial<DailyAggregate>, "tokens" | "activeMask"> & {
  tokens?: Partial<DailyAggregate["tokens"]>;
  /** Active minutes from the start of each hour: { 23: 30 } is 23:00 to 23:29. */
  hours?: Record<number, number>;
  /** Extra active minute ranges of the day, inclusive: [[600, 629]]. */
  ranges?: Array<[number, number]>;
};

/** Builds a valid aggregate. agentMinutes defaults to the active wall-clock minutes. */
export function agg(day: string, source: Source, p: AggInput = {}): DailyAggregate {
  const { hours = {}, ranges = [], tokens, ...rest } = p;
  const mask = emptyMask();
  let minutes = 0;
  for (const [h, m] of Object.entries(hours)) {
    setRange(mask, Number(h) * 60, Number(h) * 60 + m - 1);
    minutes += m;
  }
  for (const [from, to] of ranges) {
    setRange(mask, from, to);
    minutes += to - from + 1;
  }
  const base = emptyAggregate(day, source);
  return {
    ...base,
    agentMinutes: minutes,
    sessions: minutes > 0 ? 1 : 0,
    peakSessions: minutes > 0 ? 1 : 0,
    ...rest,
    tokens: { ...base.tokens, ...tokens },
    activeMask: encodeMask(mask),
  };
}

/** An automated block with the given active minute ranges, inclusive. */
export function automated(ranges: Array<[number, number]>, extra: Partial<DailyAggregate["automated"]> = {}): DailyAggregate["automated"] {
  const mask = emptyMask();
  let minutes = 0;
  for (const [from, to] of ranges) {
    setRange(mask, from, to);
    minutes += to - from + 1;
  }
  return {
    sessions: 1,
    messages: 1,
    agentMinutes: minutes,
    longestSessionMinutes: minutes,
    peakSessionsAll: 1,
    repoMinutes: {},
    ...extra,
    activeMask: encodeMask(mask),
  };
}
