/** User-supplied text as one plain line: no bidi or zero-width characters that could disguise it, no control characters or line breaks. */
export function plainText(text: string): string {
  return text
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, " ")
    .trim();
}
