import { lt } from "drizzle-orm";
import type { Db } from "../db";
import { deviceCodes, verifications } from "../db/schema";

/** A CLI that polls a code this long after it expired is told the code is not valid. */
const DEVICE_CODE_GRACE_MS = 24 * 60 * 60_000;

/** Deletes login codes and Better Auth verifications that can no longer be used. */
export async function purgeExpired(db: Db, now: Date): Promise<{ deviceCodes: number; verifications: number }> {
  const codes = await db
    .delete(deviceCodes)
    .where(lt(deviceCodes.expiresAt, new Date(now.getTime() - DEVICE_CODE_GRACE_MS)))
    .returning({ hash: deviceCodes.deviceCodeHash });
  const verified = await db.delete(verifications).where(lt(verifications.expiresAt, now)).returning({ id: verifications.id });
  return { deviceCodes: codes.length, verifications: verified.length };
}
