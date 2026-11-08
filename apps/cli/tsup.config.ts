import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";
import { fontFiles } from "../../packages/brand/src/index";

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Everything is bundled into one file so npx installs no dependencies.
  noExternal: [/.*/],
  banner: {
    // Some bundled CommonJS code calls require().
    js: "#!/usr/bin/env node\nimport { createRequire as __cwCreateRequire } from 'node:module';\nconst require = __cwCreateRequire(import.meta.url);",
  },
  async onSuccess() {
    // The renderer loads these next to dist/index.js at runtime.
    await mkdir("dist/fonts", { recursive: true });
    await copyFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"), "dist/resvg.wasm");
    for (const f of fontFiles) await copyFile(`../../packages/brand/fonts/${f.file}`, `dist/fonts/${f.file}`);
    await copyFile("../../packages/brand/fonts/LICENSE-Geist.txt", "dist/fonts/LICENSE-Geist.txt");
    await copyFile("../../packages/brand/fonts/LICENSE-CommitMono.txt", "dist/fonts/LICENSE-CommitMono.txt");
  },
});
