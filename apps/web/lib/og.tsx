import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { fontFiles } from "@codewrapped/brand";
import { cardElement, FORMATS, type CardSummary } from "@codewrapped/card/element";

let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }>> | null = null;

/** Card fonts from public/fonts. next.config includes them in the function bundle. */
function loadFonts() {
  fonts ??= Promise.all(
    fontFiles.map(async (f) => ({
      name: f.family,
      weight: f.weight,
      style: "normal" as const,
      data: await readFile(join(process.cwd(), "public", "fonts", f.file)),
    })),
  );
  return fonts;
}

/** The landscape card as a PNG, the same layout the CLI renders. */
export async function cardImage(
  summary: CardSummary,
  handle: string | null,
  standing: { percentile: number; period: "month" } | null = null,
): Promise<ImageResponse> {
  const { width, height } = FORMATS.landscape;
  // The card's element tree has the shape of React elements.
  const element = cardElement(summary, { theme: "light", handle, standing }) as unknown as ReactElement;
  return new ImageResponse(element, {
    width,
    height,
    fonts: await loadFonts(),
    headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" },
  });
}
