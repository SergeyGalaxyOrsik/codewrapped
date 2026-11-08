import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Workspace packages are TypeScript source; npm packages stay in node_modules.
  noExternal: [/^@codewrapped\//],
});
