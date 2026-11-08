import { colors, fonts, heatSteps as STEPS, markDataUri, type Palette } from "@codewrapped/brand";
import { truncateMiddle } from "@codewrapped/stats";
import type { CardStat } from "./data";
import { div, h, text, type El, type Style } from "./h";
import type { Frame } from "./layout";

/** Average advance per character, as a share of font size, for fitting names without measuring. */
const SANS_CHAR = 0.536;
const MONO_CHAR = 0.6;

export const sans = (size: number, color: string, weight = 400, extra: Style = {}): Style => ({
  fontFamily: fonts.sans,
  fontSize: size,
  fontWeight: weight,
  color,
  lineHeight: 1.25,
  ...extra,
});

export const mono = (size: number, color: string, extra: Style = {}): Style => ({
  fontFamily: fonts.mono,
  fontSize: size,
  fontWeight: 400,
  color,
  lineHeight: 1,
  ...extra,
});

export function palette(f: Frame): Palette {
  return colors[f.d.theme];
}

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function header(f: Frame): El {
  const c = palette(f);
  const { d, type } = f;
  const size = Math.round(type.label * 1.27);
  const markSize = Math.round(size * 1.15);
  return div(
    { justifyContent: "space-between", alignItems: "center" },
    div(
      { alignItems: "center", gap: Math.round(size * 0.45) },
      h("img", { src: markDataUri(markSize, d.theme), width: markSize, height: markSize }),
      text(sans(size, c.fg, 500, { letterSpacing: -0.02 * size, lineHeight: 1 }), "codewrapped"),
    ),
    div(
      { alignItems: "center", gap: Math.round(type.label * 0.6) },
      d.standing ? text(sans(type.label, c.muted), d.standing) : null,
      text(sans(type.label, d.handle ? c.fg : c.muted, d.handle ? 500 : 400), d.handle ? `@${d.handle}` : d.range),
    ),
  );
}

/** The red band. The one bold element: it carries the period and nothing else. */
export function ribbon(f: Frame, height: number, paddingX: number): El {
  const c = palette(f);
  // data-part lets the web page animate the band; satori ignores it.
  return h(
    "div",
    {
      "data-part": "ribbon",
      style: { height, backgroundColor: c.ribbon, alignItems: "center", paddingLeft: paddingX, paddingRight: paddingX },
    },
    text(sans(f.type.label, c.onRibbon, 500, { lineHeight: 1 }), f.d.period),
  );
}

export function hero(f: Frame): El {
  const c = palette(f);
  const size = f.type.hero;
  return div(
    { alignItems: "flex-end" },
    text(mono(size, c.fg, { letterSpacing: -0.04 * size }), f.d.hero.value),
    text(
      mono(Math.round(size * 0.3), c.fg, { marginLeft: Math.round(size * 0.12), paddingBottom: Math.round(size * 0.075) }),
      f.d.hero.unit,
    ),
  );
}

export function heroLines(f: Frame): El {
  const c = palette(f);
  return div(
    { flexDirection: "column", gap: Math.round(f.type.label * 0.3) },
    text(sans(f.type.label, c.fg, 500), f.d.heroLabel),
    f.d.parallel ? text(sans(f.type.label, c.muted), f.d.parallel) : null,
  );
}

export function stat(f: Frame, s: CardStat): El {
  const c = palette(f);
  const size = f.type.secondary;
  return div(
    { alignItems: "flex-end", gap: Math.round(f.type.label * 0.55) },
    text(mono(size, c.fg, { letterSpacing: -0.03 * size }), s.value),
    text(sans(f.type.label, c.muted, 400, { paddingBottom: Math.round(size * 0.06), lineHeight: 1 }), s.label),
  );
}

export function sectionTitle(f: Frame, title: string): El {
  return text(sans(f.type.label, palette(f).muted), title);
}

/** Repositories by tokens, or most edited files. */
export function rankedList(f: Frame, width: number): El | null {
  const { d, type } = f;
  if (!d.ranked || d.ranked.rows.length === 0) return null;
  const c = palette(f);
  const rows = d.ranked.rows;
  const countWidth = Math.max(...rows.map((x) => x.count.length)) * MONO_CHAR * type.label + type.label * 0.7;
  const maxChars = Math.floor((width - countWidth) / (SANS_CHAR * type.label));
  return div(
    { flexDirection: "column", width, gap: Math.round(type.label * 0.45) },
    sectionTitle(f, d.ranked.title),
    ...rows.map((x) =>
      div(
        { justifyContent: "space-between", alignItems: "center", width },
        text(sans(type.label, c.fg, 400, { lineHeight: 1.1 }), truncateMiddle(x.name, maxChars)),
        text(mono(type.label, c.muted), x.count),
      ),
    ),
  );
}

export function toolList(f: Frame, width: number): El | null {
  const { d, type } = f;
  if (d.tools.length === 0) return null;
  const c = palette(f);
  const charW = SANS_CHAR * type.label;
  const longest = Math.max(...d.tools.map((t) => t.name.length));
  const countWidth = Math.max(...d.tools.map((t) => t.count.length)) * MONO_CHAR * type.label + type.label * 0.7;
  // The name column fits the longest name, up to just over half the width.
  const nameWidth = Math.round(Math.min(width * 0.55, Math.max(type.label * 4, longest * charW + type.label)));
  const barGap = Math.round(type.label * 0.5);
  const barMax = Math.round(width - nameWidth - countWidth - barGap * 2);
  return div(
    { flexDirection: "column", width, gap: Math.round(type.label * 0.45) },
    sectionTitle(f, "Tools"),
    ...d.tools.map((t) =>
      div(
        { alignItems: "center", width },
        text(
          sans(type.label, c.fg, 400, { width: nameWidth, lineHeight: 1.1 }),
          truncateMiddle(t.name, Math.floor((nameWidth - type.label) / charW)),
        ),
        div(
          { width: barMax, height: type.label, alignItems: "center", marginLeft: barGap, marginRight: barGap },
          div({ width: Math.max(4, Math.round(barMax * t.share)), height: Math.round(type.label * 0.45), backgroundColor: c.fg }),
        ),
        text(mono(type.label, c.muted, { width: countWidth, justifyContent: "flex-end" }), t.count),
      ),
    ),
  );
}

export function heatmap(f: Frame, cell: number, gap: number): El | null {
  const steps = f.d.heatmap;
  if (!steps) return null;
  const c = palette(f);
  const fill = (step: number) => (step === 0 ? c.border : rgba(c.fg, STEPS[step]!));
  return div(
    { flexDirection: "column", gap },
    ...steps.map((row) =>
      div(
        { gap },
        ...row.map((step) =>
          div({ width: cell, height: cell, borderRadius: Math.max(1, Math.round(cell / 5)), backgroundColor: fill(step) }),
        ),
      ),
    ),
  );
}

export function busiest(f: Frame, cell: number, gap: number): El | null {
  if (!f.d.heatmap) return null;
  const c = palette(f);
  return div(
    { flexDirection: "column", gap: Math.round(f.type.label * 0.55) },
    sectionTitle(f, "Busiest"),
    heatmap(f, cell, gap),
    f.d.busiest ? text(sans(f.type.label, c.fg, 400, { lineHeight: 1 }), f.d.busiest) : null,
  );
}

/** "Night shift. 46% of your agent time was between 22:00 and 04:00." Wraps by word. */
export function sentence(f: Frame, width: number): El {
  const c = palette(f);
  const size = f.type.label;
  const word = (w: string, weight: number) => text(sans(size, c.fg, weight, { lineHeight: 1.3 }), w);
  return div(
    { flexWrap: "wrap", columnGap: Math.round(size * 0.3), rowGap: Math.round(size * 0.15), width },
    word(`${f.d.archetype.name}.`, 600),
    ...f.d.archetype.sentence.split(" ").map((w) => word(w, 400)),
  );
}

export function footer(f: Frame): El {
  const c = palette(f);
  return div(
    { justifyContent: "space-between", alignItems: "center" },
    text(mono(f.type.label, c.fg), f.d.command),
    text(sans(f.type.label, c.muted, 400, { lineHeight: 1 }), f.d.url),
  );
}
