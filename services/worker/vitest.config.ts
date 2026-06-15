import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite migration + bootstrap on a fresh in-memory DB is slow on the first
    // run of each file (cold module load). Give the chain jobs room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
