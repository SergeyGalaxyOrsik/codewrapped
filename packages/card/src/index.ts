import satori from "satori";
import type { Summary } from "@codewrapped/stats";
import { cardData, type CardOptions } from "./data";
import type { El } from "./h";
import { FORMATS, layout, type CardFormat } from "./layout";

export { cardData, formatRange, heatSteps, periodLabel, type CardData, type CardOptions } from "./data";
export { FORMATS, layout, type CardFormat } from "./layout";
export type { El } from "./h";

export type FontData = { name: string; data: ArrayBuffer | Uint8Array; weight: 400 | 500 | 600; style: "normal" };

export type CardRenderOptions = CardOptions & { format?: CardFormat };

/** The card as an element tree, for next/og and satori. */
export function cardElement(summary: Summary, opts: CardRenderOptions = {}): El {
  return layout(cardData(summary, opts), opts.format);
}

/** The card as SVG. Text is converted to paths, so the SVG needs no fonts. */
export async function cardSvg(summary: Summary, opts: CardRenderOptions & { fonts: FontData[] }): Promise<string> {
  const { width, height } = FORMATS[opts.format ?? "landscape"];
  // satori's types expect React nodes; the element tree has the same shape.
  return satori(cardElement(summary, opts) as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: opts.fonts.map((f) => ({ ...f, data: f.data as ArrayBuffer })),
  });
}
