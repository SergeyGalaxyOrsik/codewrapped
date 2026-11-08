import { initWasm, Resvg } from "@resvg/resvg-wasm";

let ready: Promise<void> | null = null;

/**
 * Rasterizes an SVG with resvg compiled to WebAssembly, so it runs on every
 * platform without native builds. `wasm` is the resvg wasm binary.
 */
export async function svgToPng(svg: string, wasm: () => Promise<ArrayBuffer | Uint8Array>, scale = 2): Promise<Uint8Array> {
  ready ??= wasm().then((bytes) => initWasm(bytes));
  await ready;
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
