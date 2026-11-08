/**
 * codewrapped brand: the single source for colors, type and the mark.
 * Neutral and quiet. The ribbon is the one bold element.
 */

export type Theme = "light" | "dark";

export type Palette = {
  /** Page and card background. */
  bg: string;
  /** Panels. */
  surface: string;
  /** 1px hairlines. */
  border: string;
  /** Secondary text. */
  muted: string;
  /** Text and primary buttons. */
  fg: string;
  /** Logo ribbon and the card band only. Never buttons, links or errors. */
  ribbon: string;
  /** Text on the ribbon. */
  onRibbon: string;
};

export const colors: Record<Theme, Palette> = {
  light: {
    bg: "#FFFFFF",
    surface: "#F7F7F7",
    border: "#EAEAEA",
    muted: "#6F6F6F",
    fg: "#000000",
    ribbon: "#E5322D",
    onRibbon: "#FFFFFF",
  },
  dark: {
    bg: "#000000",
    surface: "#0F0F0F",
    border: "#222222",
    muted: "#8F8F8F",
    fg: "#FFFFFF",
    ribbon: "#FF453A",
    onRibbon: "#000000",
  },
};

/** Heatmap steps as opacity of `fg`. Step 0 is an empty cell. */
export const heatSteps = [0, 0.2, 0.4, 0.65, 1] as const;

export const fonts = {
  sans: "Geist",
  mono: "Commit Mono",
} as const;

/** Font files in packages/brand/fonts, all SIL Open Font License 1.1. */
export const fontFiles = [
  { family: fonts.sans, weight: 400, file: "Geist-Regular.ttf" },
  { family: fonts.sans, weight: 500, file: "Geist-Medium.ttf" },
  { family: fonts.sans, weight: 600, file: "Geist-SemiBold.ttf" },
  // Official Commit Mono 1.143 release, ttfautohint build.
  { family: fonts.mono, weight: 400, file: "CommitMono-400-Regular.ttf" },
] as const;

export type FontWeight = (typeof fontFiles)[number]["weight"];

/** Card type scale in px. */
export const cardType = {
  hero: 160,
  secondary: 56,
  label: 22,
} as const;

export const radius = {
  control: 8,
  card: 12,
} as const;

/** Production domains, confirmed 2026-11-08. The CLI can point elsewhere with CODEWRAPPED_API_URL. */
export const site = {
  host: "codewrapped.app",
  url: "https://codewrapped.app",
  apiUrl: "https://api.codewrapped.app",
  repo: "https://github.com/SergeyGalaxyOrsik/codewrapped",
  command: "npx codewrapped",
} as const;

/**
 * Mark geometry, as fractions of the size: a rounded square tied with one
 * vertical and one horizontal ribbon, off-center so it reads as a knot, not
 * a plus sign.
 */
export const mark = {
  radius: 0.22,
  ribbonX: 0.58,
  ribbonY: 0.42,
  ribbonWidth: 0.1,
} as const;

/** The mark as SVG. Fill follows the theme so it shows on both backgrounds. */
export function markSvg(size = 64, theme: Theme = "light"): string {
  const c = colors[theme];
  const r = round(size * mark.radius);
  const w = round(size * mark.ribbonWidth);
  const x = round(size * mark.ribbonX - w / 2);
  const y = round(size * mark.ribbonY - w / 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><clipPath id="m"><rect width="${size}" height="${size}" rx="${r}"/></clipPath></defs>` +
    `<g clip-path="url(#m)">` +
    `<rect width="${size}" height="${size}" fill="${c.fg}"/>` +
    `<rect x="${x}" y="0" width="${w}" height="${size}" fill="${c.ribbon}"/>` +
    `<rect x="0" y="${y}" width="${size}" height="${w}" fill="${c.ribbon}"/>` +
    `</g></svg>`
  );
}

export function markDataUri(size = 64, theme: Theme = "light"): string {
  return `data:image/svg+xml;base64,${btoa(markSvg(size, theme))}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
