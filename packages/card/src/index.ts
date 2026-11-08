import satori from "satori";
import { cardElement, FORMATS, type CardRenderOptions, type CardSummary } from "./element";

export * from "./element";

export type FontData = { name: string; data: ArrayBuffer | Uint8Array; weight: 400 | 500 | 600; style: "normal" };

/** The card as SVG. Text is converted to paths, so the SVG needs no fonts. */
export async function cardSvg(summary: CardSummary, opts: CardRenderOptions & { fonts: FontData[] }): Promise<string> {
  const { width, height } = FORMATS[opts.format ?? "landscape"];
  // satori's types expect React nodes; the element tree has the same shape.
  return satori(cardElement(summary, opts) as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: opts.fonts.map((f) => ({ ...f, data: f.data as ArrayBuffer })),
  });
}
