/** Fixed-window limiter per key, in memory. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns 0 when allowed, or the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return 0;
    }
    if (w.count < this.limit) {
      w.count += 1;
      return 0;
    }
    return Math.ceil((w.start + this.windowMs - now) / 1000);
  }
}
