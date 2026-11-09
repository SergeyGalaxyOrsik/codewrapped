/** Fixed-window limiter per key, in memory. One API instance, so this is enough. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Returns 0 when allowed, or the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(now);
      this.windows.set(key, { start: now, count: 1 });
      return 0;
    }
    if (w.count < this.limit) {
      w.count += 1;
      return 0;
    }
    return Math.ceil((w.start + this.windowMs - now) / 1000);
  }

  /** Drops ended windows, or the oldest ones when every window is still open. */
  private prune(now: number): void {
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }
}

/**
 * The caller's address. Traefik in front of the API appends the address it saw as the last
 * X-Forwarded-For entry, and anything before it came from the client.
 */
export function clientIp(req: Request, socketAddress: string | undefined): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || socketAddress || "unknown";
  return ip.includes(":") && !ip.includes(".") ? ipv6Prefix(ip) : ip;
}

/** One IPv6 customer usually holds a whole /64, so limits apply per /64. */
function ipv6Prefix(ip: string): string {
  const [head = "", tail] = ip.split("::");
  const groups = head ? head.split(":") : [];
  if (tail !== undefined) {
    const rest = tail ? tail.split(":") : [];
    groups.push(...Array<string>(Math.max(0, 8 - groups.length - rest.length)).fill("0"), ...rest);
  }
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
