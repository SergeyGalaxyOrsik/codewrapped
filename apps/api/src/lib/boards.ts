import type { BoardPeriod, Candidate } from "./leaderboard";

export type BoardRange = { start: string; end: string };

/** A board as last built: the range it covers and the change counter it saw. */
type Built = { range: string; list: Candidate[]; version: number; builtAt: number };
type Building = { range: string; version: number; promise: Promise<Candidate[]> };

export type BoardsOptions = {
  build: (period: BoardPeriod, range: BoardRange) => Promise<Candidate[]>;
  range: (period: BoardPeriod) => BoardRange;
  /** Rebuilds after a change start at most this often. */
  refreshMs: number;
  /** A board this old is rebuilt even without a change, so holds that end with time end. */
  maxAgeMs: number;
};

const rangeKey = (r: BoardRange) => `${r.start}:${r.end}`;

/**
 * The leaderboards, built from every synced day in their range. Building one reads the whole
 * range, so it runs once for all waiting callers, and a change only marks boards stale: readers
 * keep getting the last board while a rebuild runs in the background.
 */
export class Boards {
  private version = 0;
  private readonly built = new Map<BoardPeriod, Built>();
  private readonly building = new Map<BoardPeriod, Building>();
  private readonly timers = new Map<BoardPeriod, ReturnType<typeof setTimeout>>();

  constructor(private readonly opts: BoardsOptions) {}

  /** The last board for the current range. Built now only when there is none. */
  async get(period: BoardPeriod): Promise<Candidate[]> {
    const b = this.current(period);
    if (!b) return this.run(period);
    if (!this.upToDate(b)) this.schedule(period);
    return b.list;
  }

  /** The last board for the current range, or null. Never builds. */
  peek(period: BoardPeriod): Candidate[] | null {
    return this.current(period)?.list ?? null;
  }

  /** A board that includes every change marked before this call. */
  async fresh(period: BoardPeriod): Promise<Candidate[]> {
    const b = this.current(period);
    return b && b.version >= this.version ? b.list : this.run(period);
  }

  /** Something the boards read changed. Built boards are rebuilt in the background. */
  markStale(): void {
    this.version += 1;
    for (const period of this.built.keys()) this.schedule(period);
  }

  private current(period: BoardPeriod): Built | null {
    const b = this.built.get(period);
    return b && b.range === rangeKey(this.opts.range(period)) ? b : null;
  }

  private upToDate(b: Built): boolean {
    return b.version >= this.version && Date.now() - b.builtAt < this.opts.maxAgeMs;
  }

  private schedule(period: BoardPeriod): void {
    if (this.timers.has(period)) return;
    const b = this.built.get(period);
    const delay = b ? Math.max(0, b.builtAt + this.opts.refreshMs - Date.now()) : 0;
    const timer = setTimeout(() => {
      this.timers.delete(period);
      const now = this.current(period);
      if (now && this.upToDate(now)) return;
      this.run(period).catch((err: unknown) => console.error(JSON.stringify({ event: "board_rebuild_failed", period, message: String((err as Error)?.message ?? err).split("\n")[0] })));
    }, delay);
    timer.unref?.();
    this.timers.set(period, timer);
  }

  private run(period: BoardPeriod): Promise<Candidate[]> {
    const range = this.opts.range(period);
    const key = rangeKey(range);
    const inflight = this.building.get(period);
    if (inflight && inflight.range === key && inflight.version >= this.version) return inflight.promise;
    const version = this.version;
    // One build at a time per board: a newer one starts after the running one.
    const promise = (inflight?.promise.catch(() => undefined) ?? Promise.resolve())
      .then(() => this.opts.build(period, range))
      .then((list) => {
        this.built.set(period, { range: key, list, version, builtAt: Date.now() });
        if (this.version > version) this.schedule(period);
        return list;
      })
      .finally(() => {
        if (this.building.get(period)?.promise === promise) this.building.delete(period);
      });
    this.building.set(period, { range: key, version, promise });
    return promise;
  }
}
