import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fontFiles, site, type Theme } from "@codewrapped/brand";
import { cardData, cardSvg, periodLabel, type CardFormat, type FontData } from "@codewrapped/card";
import { svgToPng } from "@codewrapped/card/png";
import { formatCompact, formatHours, type Summary } from "@codewrapped/stats";

/** Fonts and the resvg wasm are copied next to the bundle at build time. */
const asset = (name: string) => new URL(`./${name}`, import.meta.url);

async function loadFonts(): Promise<FontData[]> {
  return Promise.all(
    fontFiles.map(async (f) => ({
      name: f.family,
      weight: f.weight,
      style: "normal" as const,
      data: await readFile(asset(`fonts/${f.file}`)),
    })),
  );
}

export type CardFileOptions = {
  theme: Theme;
  format: CardFormat;
  out: string | null;
  handle?: string | null;
};

export function defaultCardPath(format: CardFormat): string {
  return format === "story" ? "codewrapped-story.png" : "codewrapped.png";
}

/** Renders the card at 2x for sharp text on high-density screens. Returns the absolute path. */
export async function writeCard(summary: Summary, opts: CardFileOptions): Promise<string> {
  const svg = await cardSvg(summary, { theme: opts.theme, format: opts.format, handle: opts.handle ?? null, fonts: await loadFonts() });
  const png = await svgToPng(svg, () => readFile(asset("resvg.wasm")), 2);
  const path = resolve(opts.out ?? defaultCardPath(opts.format));
  await writeFile(path, png);
  return path;
}

/**
 * Opens a file or URL with the system handler. Failing to open is not an
 * error. On Windows it goes to rundll32 rather than `cmd /c start`, which
 * would parse & | ^ in the target as commands.
 */
export function openFile(target: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No viewer available.
  }
}

/**
 * The URL, normalized, when it is on one of the trusted sites (same scheme,
 * host and port), else null. Only those are opened in the browser.
 */
export function trustedUrl(url: string, trusted: readonly string[]): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const origins = trusted.flatMap((t) => (URL.canParse(t) ? [new URL(t).origin] : []));
  return (u.protocol === "https:" || u.protocol === "http:") && origins.includes(u.origin) ? u.href : null;
}

/** Opens a URL from the server in the browser when it is on a trusted site. */
export function openUrl(url: string, trusted: readonly string[]): void {
  const safe = trustedUrl(url, trusted);
  if (safe) openFile(safe);
}

/** A post intent with the text filled in. The user attaches the image. */
export function shareUrl(summary: Summary): string {
  const d = cardData(summary);
  const lines = [
    `My ${periodLabel(summary)} with coding agents: ${formatCompact(summary.totals.tokens.headline)} tokens, ${formatHours(summary.totals.activeMinutes)}.`,
    `${d.archetype.name}. ${d.archetype.sentence}`,
    "",
    `Made with ${site.command}`,
    site.host,
  ];
  return `https://x.com/intent/tweet?text=${encodeURIComponent(lines.join("\n"))}`;
}
