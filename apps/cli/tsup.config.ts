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
    // Some bundled CommonJS code calls require() or reads __dirname (sql.js).
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __cwCreateRequire } from 'node:module';",
      "import { dirname as __cwDirname } from 'node:path';",
      "import { fileURLToPath as __cwFileURLToPath } from 'node:url';",
      "const require = __cwCreateRequire(import.meta.url);",
      "const __filename = __cwFileURLToPath(import.meta.url);",
      "const __dirname = __cwDirname(__filename);",
    ].join("\n"),
  },
  async onSuccess() {
    // The renderer loads these next to dist/index.js at runtime.
    await mkdir("dist/fonts", { recursive: true });
    await copyFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"), "dist/resvg.wasm");
    // SQLite for opencode on Node versions without node:sqlite.
    await copyFile(require.resolve("sql.js/dist/sql-wasm.wasm"), "dist/sql-wasm.wasm");
    for (const f of fontFiles) await copyFile(`../../packages/brand/fonts/${f.file}`, `dist/fonts/${f.file}`);
    await copyFile("../../packages/brand/fonts/LICENSE-Geist.txt", "dist/fonts/LICENSE-Geist.txt");
    await copyFile("../../packages/brand/fonts/LICENSE-CommitMono.txt", "dist/fonts/LICENSE-CommitMono.txt");
  },
});
