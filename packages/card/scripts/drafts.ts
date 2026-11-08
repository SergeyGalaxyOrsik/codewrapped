/**
 * Renders every landscape variant for the given summaries.
 *
 *   pnpm --filter @codewrapped/card drafts <outDir> real=<summary.json> [no-codex=<summary.json>]
 *
 * Summary files are the output of `codewrapped --json`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFiles, type Theme } from "@codewrapped/brand";
import type { Summary } from "@codewrapped/stats";
import { cardSvg, type CardFormat, type FontData } from "../src/index";
import { svgToPng } from "../src/png";
import { samples } from "./samples";

const require = createRequire(import.meta.url);
const brandDir = fileURLToPath(new URL("../../brand/", import.meta.url));

const [outDir, ...inputs] = process.argv.slice(2);
if (!outDir) throw new Error("usage: drafts <outDir> name=<summary.json> ...");
await mkdir(outDir, { recursive: true });

const fonts: FontData[] = await Promise.all(
  fontFiles.map(async (f) => ({
    name: f.family,
    weight: f.weight,
    style: "normal" as const,
    data: await readFile(join(brandDir, "fonts", f.file)),
  })),
);
const wasm = () => readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));

const cases: Array<{ name: string; summary: Summary; handle: string | null }> = [];
for (const arg of inputs) {
  const [name, file] = arg.split("=");
  const json = JSON.parse(await readFile(file!, "utf8"));
  cases.push({ name: name!, summary: json.summary ?? json, handle: null });
}
const today = cases[0]?.summary.range.end ?? new Date().toISOString().slice(0, 10);
for (const [name, s] of Object.entries(samples(today))) cases.push({ name, ...s });

const variants: CardFormat[] = (process.env.FORMATS?.split(",") as CardFormat[] | undefined) ?? ["landscape", "story"];
const themes: Theme[] = (process.env.THEMES?.split(",") as Theme[] | undefined) ?? ["light", "dark"];
const written: string[] = [];
for (const theme of themes) {
  for (const variant of variants) {
    for (const c of cases) {
      const svg = await cardSvg(c.summary, { format: variant, theme, handle: c.handle, fonts });
      const png = await svgToPng(svg, wasm, 1);
      const file = `${variant}-${theme}-${c.name}.png`;
      await writeFile(join(outDir, file), png);
      written.push(file);
    }
  }
}

const sections = variants
  .map(
    (v) => `<section><h2>${v}</h2><div class="grid">${written
      .filter((f) => f.startsWith(`${v}-`))
      .map((f) => `<figure><img src="${f}" width="${v === "story" ? 270 : 600}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`)
      .join("")}</div></section>`,
  )
  .join("");
await writeFile(
  join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>codewrapped card drafts</title>
<style>body{font:14px system-ui;margin:24px;background:#f2f2f2}h2{margin:32px 0 12px}.grid{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0}img{border:1px solid #ddd;border-radius:12px;background:#fff;display:block}figcaption{margin-top:6px;color:#666}</style>
${sections}`,
);
console.log(`${written.length} cards in ${outDir}`);
