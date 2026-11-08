import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Errors say what happened and what to do. */
export function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}
