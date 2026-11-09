import { defineConfig } from "vitest/config";

export default defineConfig({
  // Each test starts an in-process Postgres, which takes seconds on a shared CI runner.
  test: { testTimeout: 30_000 },
});
