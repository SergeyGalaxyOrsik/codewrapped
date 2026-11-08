/**
 * A tiny element builder for satori, so the card needs no React. The output
 * has the same shape as React elements and also works with next/og.
 */
export type Style = Record<string, string | number>;
export type Child = El | string | null | false | undefined;
export type El = { type: string; key?: null; props: { style?: Style; children?: Child | Child[]; [k: string]: unknown } };

export function h(type: string, props: { style?: Style; [k: string]: unknown } | null, ...children: Child[]): El {
  const kids = children.filter((c) => c !== null && c !== false && c !== undefined);
  const style: Style = { display: "flex", ...(props?.style ?? {}) };
  if (type === "img") delete style.display;
  return {
    type,
    key: null,
    props: { ...props, style, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids },
  };
}

export const div = (style: Style, ...children: Child[]) => h("div", { style }, ...children);
export const text = (style: Style, value: string) => h("div", { style }, value);
