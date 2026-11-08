import { cardType, colors } from "@codewrapped/brand";
import type { CardData } from "./data";
import { div, type El, type Style } from "./h";
import { busiest, footer, header, hero, heroLines, rankedList, ribbon, sentence, stat, toolList } from "./parts";

export type CardFormat = "landscape" | "story";

export const FORMATS = {
  landscape: { width: 1200, height: 675, padX: 56, type: cardType },
  // A phone shows the story at full width, so type is larger.
  story: { width: 1080, height: 1920, padX: 80, type: { hero: 208, secondary: 64, label: 30 } },
} as const;

export type TypeScale = { hero: number; secondary: number; label: number };

/** What every part needs: the data, the type scale and the canvas. */
export type Frame = { d: CardData; type: TypeScale; width: number; height: number; padX: number };

function frame(f: Frame, ...children: Array<El | null>): El {
  return div(
    { width: f.width, height: f.height, flexDirection: "column", backgroundColor: colors[f.d.theme].bg },
    ...children,
  );
}

const section = (f: Frame, style: Style, ...children: Array<El | null>) =>
  div({ flexDirection: "column", paddingLeft: f.padX, paddingRight: f.padX, ...style }, ...children);

/** 1200x675: hero and stats, the ribbon across the middle, three columns below. */
function landscape(f: Frame): El {
  const inner = f.width - f.padX * 2;
  return frame(
    f,
    section(f, { paddingTop: 40 }, header(f)),
    div(
      { marginTop: 22, paddingLeft: f.padX, paddingRight: f.padX, justifyContent: "space-between", alignItems: "flex-end" },
      div({ flexDirection: "column", gap: 10 }, hero(f), heroLines(f)),
      div({ flexDirection: "column", gap: 14, width: 470, paddingBottom: 4 }, ...f.d.stats.map((s) => stat(f, s))),
    ),
    div({ marginTop: 26, flexDirection: "column" }, ribbon(f, 48, f.padX)),
    div(
      { marginTop: 26, paddingLeft: f.padX, paddingRight: f.padX, justifyContent: "space-between" },
      rankedList(f, 330) ?? div({ width: 330 }),
      toolList(f, 400) ?? div({ width: 400 }),
      busiest(f, 11, 2),
    ),
    section(f, { marginTop: "auto" }, sentence(f, inner)),
    section(f, { marginTop: 18, paddingBottom: 36 }, footer(f)),
  );
}

/** 1080x1920: the same blocks, stacked. */
function story(f: Frame): El {
  const inner = f.width - f.padX * 2;
  return frame(
    f,
    section(f, { paddingTop: 72 }, header(f)),
    section(f, { marginTop: 72 }, hero(f)),
    section(f, { marginTop: 14 }, heroLines(f)),
    section(f, { marginTop: 48, gap: 18 }, ...f.d.stats.map((s) => stat(f, s))),
    div({ marginTop: 56, flexDirection: "column" }, ribbon(f, 72, f.padX)),
    section(f, { marginTop: 52 }, rankedList(f, inner)),
    section(f, { marginTop: 40 }, toolList(f, inner)),
    section(f, { marginTop: 40 }, busiest(f, 26, 6)),
    section(f, { marginTop: "auto", paddingTop: 40 }, sentence(f, inner)),
    section(f, { marginTop: 32, paddingBottom: 72 }, footer(f)),
  );
}

export function layout(d: CardData, format: CardFormat = "landscape"): El {
  const spec = FORMATS[format];
  const f: Frame = { d, type: spec.type, width: spec.width, height: spec.height, padX: spec.padX };
  return format === "story" ? story(f) : landscape(f);
}
