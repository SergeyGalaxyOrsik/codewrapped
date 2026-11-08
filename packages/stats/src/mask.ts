/**
 * A day of local wall-clock time as 1440 bits, one per minute. A bit is set
 * when any session was active at any point in that minute. Masks from
 * different sources and machines combine with a bitwise OR, so the union of
 * active time can be computed after sync without double counting.
 *
 * Bit i is minute i of the local day (00:00 is 0, 23:59 is 1439), stored
 * least significant bit first: byte i >> 3, bit i & 7. Serialized as base64
 * (180 bytes, 240 characters).
 *
 * On the day clocks go back, the repeated hour shares bits with itself.
 */
export const MINUTES_PER_DAY = 1440;
export const MASK_BYTES = MINUTES_PER_DAY / 8;
export const MASK_BASE64_LENGTH = 240;

export type MinuteMask = Uint8Array;

export function emptyMask(): MinuteMask {
  return new Uint8Array(MASK_BYTES);
}

export function setMinute(mask: MinuteMask, minute: number): void {
  if (minute < 0 || minute >= MINUTES_PER_DAY) return;
  mask[minute >> 3]! |= 1 << (minute & 7);
}

/** Sets minutes from..to, inclusive. */
export function setRange(mask: MinuteMask, from: number, to: number): void {
  for (let m = Math.max(0, from); m <= Math.min(MINUTES_PER_DAY - 1, to); m++) setMinute(mask, m);
}

export function hasMinute(mask: MinuteMask, minute: number): boolean {
  return (mask[minute >> 3]! & (1 << (minute & 7))) !== 0;
}

/** ORs b into a. */
export function orInto(a: MinuteMask, b: MinuteMask): void {
  for (let i = 0; i < MASK_BYTES; i++) a[i]! |= b[i]!;
}

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, i) => {
  let n = 0;
  for (let x = i; x; x >>= 1) n += x & 1;
  return n;
});

export function countMinutes(mask: MinuteMask): number {
  let n = 0;
  for (let i = 0; i < MASK_BYTES; i++) n += POPCOUNT[mask[i]!]!;
  return n;
}

/** Active minutes in each local hour. */
export function hoursOf(mask: MinuteMask): number[] {
  const hours = new Array<number>(24).fill(0);
  for (let m = 0; m < MINUTES_PER_DAY; m++) if (hasMinute(mask, m)) hours[Math.floor(m / 60)]! += 1;
  return hours;
}

export function encodeMask(mask: MinuteMask): string {
  let s = "";
  for (let i = 0; i < MASK_BYTES; i++) s += String.fromCharCode(mask[i]!);
  return btoa(s);
}

/** Throws on input that is not a 1440 bit mask. */
export function decodeMask(base64: string): MinuteMask {
  const s = atob(base64);
  if (s.length !== MASK_BYTES) throw new Error(`activeMask must be ${MASK_BYTES} bytes, got ${s.length}`);
  const mask = emptyMask();
  for (let i = 0; i < MASK_BYTES; i++) mask[i] = s.charCodeAt(i);
  return mask;
}

/** ORs base64 masks. */
export function unionMasks(masks: readonly string[]): string {
  const out = emptyMask();
  for (const m of masks) orInto(out, decodeMask(m));
  return encodeMask(out);
}

export const EMPTY_MASK = encodeMask(emptyMask());
