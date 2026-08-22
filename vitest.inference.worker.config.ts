import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("apps/worker/migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "apps/worker/wrangler.inference.test.jsonc",
      },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ["tests/worker/inference-provider-worker.test.ts"],
    setupFiles: ["tests/worker/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 0,
  },
});
