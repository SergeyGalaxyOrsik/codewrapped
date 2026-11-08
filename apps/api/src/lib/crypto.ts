import { createHash, randomBytes, randomInt } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function randomId(): string {
  return randomBytes(12).toString("base64url");
}

// No vowels or look-alikes, so codes are easy to read and spell no words.
const LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const DIGITS = "23456789";

/** ABCD-1234 */
export function userCode(): string {
  let a = "";
  let b = "";
  for (let i = 0; i < 4; i++) a += LETTERS[randomInt(LETTERS.length)];
  for (let i = 0; i < 4; i++) b += DIGITS[randomInt(DIGITS.length)];
  return `${a}-${b}`;
}
