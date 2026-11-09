import pkg from "../package.json";
import { safeText } from "./ui";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const API_TIMEOUT_MS = 30_000;

/**
 * Calls the API. Network failures and requests that take longer than
 * `timeoutMs` become an ApiError with a message the user can act on. Error
 * messages from the server are made safe to print.
 */
export async function api<T>(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const host = new URL(base).host;
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": `codewrapped-cli/${pkg.version}`,
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") {
      throw new ApiError(0, "network", `${host} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Try again later.`);
    }
    throw new ApiError(0, "network", `Could not reach ${host}. Check your connection and try again.`);
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: { code?: unknown; message?: unknown } } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON, such as a proxy's error page.
  }
  if (!res.ok) {
    const code = typeof data?.error?.code === "string" ? data.error.code : "http_error";
    const message = typeof data?.error?.message === "string" ? data.error.message : `The server answered ${res.status}. Try again later.`;
    throw new ApiError(res.status, code, safeText(message));
  }
  return data as T;
}
