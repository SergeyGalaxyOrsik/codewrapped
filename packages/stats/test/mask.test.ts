import { describe, expect, it } from "vitest";
import {
  countMinutes,
  decodeMask,
  EMPTY_MASK,
  emptyMask,
  encodeMask,
  hasMinute,
  hoursOf,
  MASK_BASE64_LENGTH,
  setRange,
  unionMasks,
} from "../src/index";

function maskOf(...ranges: Array<[number, number]>): string {
  const m = emptyMask();
  for (const [a, b] of ranges) setRange(m, a, b);
  return encodeMask(m);
}

describe("minute mask", () => {
  it("is 1440 bits in 240 base64 characters", () => {
    expect(EMPTY_MASK).toHaveLength(MASK_BASE64_LENGTH);
    expect(maskOf([0, 1439])).toHaveLength(MASK_BASE64_LENGTH);
    expect(countMinutes(decodeMask(maskOf([0, 1439])))).toBe(1440);
  });

  it("round-trips through base64", () => {
    const encoded = maskOf([0, 0], [59, 61], [1439, 1439]);
    const m = decodeMask(encoded);
    expect([0, 59, 60, 61, 1439].every((i) => hasMinute(m, i))).toBe(true);
    expect(hasMinute(m, 1)).toBe(false);
    expect(hasMinute(m, 62)).toBe(false);
    expect(encodeMask(m)).toBe(encoded);
  });

  it("unions with OR, so overlap counts once", () => {
    const a = maskOf([600, 629]); // 10:00 to 10:29
    const b = maskOf([615, 644]); // 10:15 to 10:44
    expect(countMinutes(decodeMask(unionMasks([a, b])))).toBe(45);
    expect(unionMasks([a, b])).toBe(unionMasks([b, a]));
    expect(unionMasks([a, a])).toBe(a);
  });

  it("gives minutes per hour", () => {
    const hours = hoursOf(decodeMask(maskOf([630, 689])));
    expect(hours[10]).toBe(30);
    expect(hours[11]).toBe(30);
    expect(hours.reduce((x, y) => x + y, 0)).toBe(60);
  });

  it("rejects input of the wrong size", () => {
    expect(() => decodeMask("AAAA")).toThrow(/180 bytes/);
  });
});
