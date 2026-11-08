import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { accounts } from "../db/schema";

/**
 * When the user's GitHub account was created. Asks GitHub by the numeric account id,
 * which survives login renames, with the user's own token for the higher rate limit.
 * Null when there is no GitHub account or GitHub does not answer.
 */
export async function githubCreatedAt(db: Db, userId: string, fetchImpl: typeof fetch = fetch): Promise<Date | null> {
  const [account] = await db
    .select({ id: accounts.accountId, token: accounts.accessToken })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")))
    .limit(1);
  if (!account || !/^\d+$/.test(account.id)) return null;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "codewrapped-api" };
  if (account.token) headers.authorization = `Bearer ${account.token}`;
  let res = await fetchImpl(`https://api.github.com/user/${account.id}`, { headers, signal: AbortSignal.timeout(5000) });
  // A revoked token fails; the endpoint is public, so try once without it.
  if (res.status === 401 && headers.authorization) {
    delete headers.authorization;
    res = await fetchImpl(`https://api.github.com/user/${account.id}`, { headers, signal: AbortSignal.timeout(5000) });
  }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { created_at?: unknown } | null;
  const at = typeof body?.created_at === "string" ? new Date(body.created_at) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}
