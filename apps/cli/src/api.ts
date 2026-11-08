import pkg from "../package.json";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the API. Network failures become an ApiError with a message the user can act on. */
export async function api<T>(base: string, method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": `codewrapped-cli/${pkg.version}`,
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "network", `Could not reach ${new URL(base).host}. Check your connection and try again.`);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? `The server answered ${res.status}. Try again later.`);
  }
  return data as T;
}
