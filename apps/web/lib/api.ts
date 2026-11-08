import type { Period, PublicProfile } from "@codewrapped/stats";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/$/, "");

export const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  year: "This year",
  all: "All time",
};

/** Server-side fetch of a public profile, cached for 60 seconds. Null when the handle does not exist. */
export async function getProfile(handle: string, period: Period): Promise<PublicProfile | null> {
  const res = await fetch(`${API_URL}/u/${encodeURIComponent(handle)}?period=${period}`, { next: { revalidate: 60 } });
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
