/** Renders the example card for the README: pnpm --filter @codewrapped/card readme-card */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fontFiles } from "@codewrapped/brand";
import { cardSvg, exampleSummary, type FontData } from "../src/index";
import { svgToPng } from "../src/png";

const require = createRequire(import.meta.url);
const fonts: FontData[] = await Promise.all(
  fontFiles.map(async (f) => ({
    name: f.family,
    weight: f.weight,
    style: "normal" as const,
    data: await readFile(new URL(`../../brand/fonts/${f.file}`, import.meta.url)),
  })),
);
const wasm = () => readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
// A fixed date keeps the image stable between runs.
const summary = exampleSummary("2026-11-08");
for (const theme of ["light", "dark"] as const) {
  const svg = await cardSvg(summary, { theme, handle: "you", fonts });
  await writeFile(new URL(`../../../docs/card-${theme}.png`, import.meta.url), await svgToPng(svg, wasm, 1));
}
console.log("docs/card-light.png, docs/card-dark.png");
