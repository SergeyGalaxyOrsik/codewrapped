/** Card layout without the renderer, for the browser and next/og. */
import { cardData, type CardOptions, type CardSummary } from "./data";
import type { El } from "./h";
import { layout, type CardFormat } from "./layout";

export { cardData, formatRange, heatSteps, periodLabel, type CardData, type CardOptions, type CardSummary } from "./data";
export { FORMATS, layout, type CardFormat } from "./layout";
export { exampleSummary } from "./example";
export type { El } from "./h";

export type CardRenderOptions = CardOptions & { format?: CardFormat };

export function cardElement(summary: CardSummary, opts: CardRenderOptions = {}): El {
  return layout(cardData(summary, opts), opts.format);
}
