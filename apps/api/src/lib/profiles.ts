import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { profiles } from "../db/schema";
import { HANDLE_RE } from "../validation";

/** A valid handle from a GitHub login or a name: lowercase letters, digits and dashes. */
export function slugHandle(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 39)
    .replace(/-$/, "");
  return HANDLE_RE.test(slug) ? slug : "user";
}

export async function handleTaken(db: Db, handle: string): Promise<boolean> {
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(sql`lower(${profiles.handle}) = ${handle.toLowerCase()}`)
    .limit(1);
  return rows.length > 0;
}

/** Creates the profile on first sign in. The handle is the GitHub login, or login-2 if taken. */
export async function ensureProfile(
  db: Db,
  user: { id: string; name: string; image: string | null; githubLogin: string | null },
): Promise<void> {
  const base = slugHandle(user.githubLogin ?? user.name);
  let handle = base;
  for (let i = 2; await handleTaken(db, handle); i++) handle = `${base.slice(0, 36)}-${i}`;
  await db
    .insert(profiles)
    .values({ userId: user.id, handle, displayName: user.name, avatarUrl: user.image })
    .onConflictDoNothing();
}
