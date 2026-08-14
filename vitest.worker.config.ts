import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("apps/worker/migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "apps/worker/wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    setupFiles: ["tests/worker/setup.ts"],
    testTimeout: 30_000,
    retry: 1,
  },
});
