import { site } from "@codewrapped/brand";
import type { Period, PublicProfile } from "@codewrapped/stats";

const dev = process.env.NODE_ENV !== "production";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || (dev ? "http://localhost:3000" : site.apiUrl)).replace(/\/$/, "");

/** This site's origin, for absolute links and OG images. Production builds never fall back to localhost, and public hosts are always https. */
export const SITE_URL = (() => {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || (dev ? "http://localhost:3001" : site.url));
  if (url.hostname !== "localhost" && !/^[\d.]+$/.test(url.hostname)) url.protocol = "https:";
  return url.origin;
})();

export const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  year: "This year",
  all: "All time",
};

export type BoardPeriod = "week" | "month";
export type BoardMetric = "hours" | "streak" | "tokens";
export type BoardEntry = { rank: number; handle: string; displayName: string | null; avatarUrl: string | null; xHandle: string | null; value: number };
export type Board = {
  period: BoardPeriod;
  metric: BoardMetric;
  range: { start: string; end: string };
  label: string;
  participants: number;
  entries: BoardEntry[];
};

export const BOARD_PERIOD_LABELS: Record<BoardPeriod, string> = { week: "This week", month: "This month" };
export const BOARD_METRIC_LABELS: Record<BoardMetric, string> = { hours: "Hours", streak: "Streak", tokens: "Tokens" };

/** Server-side fetch of a leaderboard, cached for 60 seconds. Null when the API is down. */
export async function getBoard(period: BoardPeriod, metric: BoardMetric): Promise<Board | null> {
  try {
    const res = await fetch(`${API_URL}/leaderboard?period=${period}&metric=${metric}`, { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as Board) : null;
  } catch {
    return null;
  }
}

/**
 * Server-side fetch of a public profile. Null when the handle does not exist.
 * Uncached by default: the API keeps its own cache and clears it when the owner
 * syncs or edits the profile, so every period shows the same name and numbers.
 * Pass `revalidate` (seconds) where a slightly stale profile is fine.
 */
export async function getProfile(handle: string, period: Period, opts: { revalidate?: number } = {}): Promise<PublicProfile | null> {
  const res = await fetch(
    `${API_URL}/u/${encodeURIComponent(handle)}?period=${period}`,
    opts.revalidate === undefined ? { cache: "no-store" } : { next: { revalidate: opts.revalidate } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Profile request failed with ${res.status}`);
  return (await res.json()) as PublicProfile;
}

export type ApiFailure = { code: string; message: string };

/** Browser call to the API with the session cookie. */
export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: { code: "network", message: "Could not reach the server. Check your connection and try again." } };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const data = (await res.json().catch(() => null)) as T & { error?: ApiFailure };
  if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? { code: "http", message: `The server answered ${res.status}.` } };
  return { ok: true, data };
}

/** Starts GitHub sign-in and comes back to `returnTo`. */
export async function signIn(returnTo: string): Promise<ApiFailure | null> {
  const res = await apiCall<{ url: string }>("POST", "/auth/sign-in/social", { provider: "github", callbackURL: returnTo });
  if (!res.ok) return res.error;
  window.location.assign(res.data.url);
  return null;
}

export async function signOut(): Promise<void> {
  await apiCall("POST", "/auth/sign-out", {});
}
