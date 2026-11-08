/**
 * Copies fonts and the mark from packages/brand and writes the color tokens
 * as CSS, so the brand package stays the single source. Runs before dev and build.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { colors, fontFiles, markSvg } from "@codewrapped/brand";

const brand = new URL("../../../packages/brand/", import.meta.url);
const web = new URL("../", import.meta.url);

await mkdir(new URL("public/fonts/", web), { recursive: true });
for (const f of fontFiles) await copyFile(new URL(`fonts/${f.file}`, brand), new URL(`public/fonts/${f.file}`, web));

await writeFile(new URL("app/icon.svg", web), markSvg(64, "light"));

const vars = (theme: "light" | "dark") =>
  Object.entries(colors[theme])
    .map(([k, v]) => `  --cw-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v};`)
    .join("\n");
await writeFile(
  new URL("app/brand.css", web),
  `/* Generated from packages/brand by scripts/prepare-brand.ts. Do not edit. */\n:root {\n${vars("light")}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${vars("dark").replace(/^/gm, "  ")}\n  }\n}\n`,
);
console.log("brand assets ready");
