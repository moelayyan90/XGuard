import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@xguard\/core\/edge$/,
        replacement: fileURLToPath(
          new URL("./packages/core/src/edge.ts", import.meta.url),
        ),
      },
      {
        find: /^@xguard\/core$/,
        replacement: fileURLToPath(
          new URL("./packages/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@xguard\/sdk$/,
        replacement: fileURLToPath(
          new URL("./packages/sdk/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.ts", "apps/gateway/src/**/*.ts"],
      exclude: [
        "**/bin.ts",
        "**/server.ts",
        "**/demo.ts",
        // This module is DOM/AudioContext integration code. Its pure sampling
        // helpers are covered in the node suite; browser execution is verified
        // separately rather than lowering the repository-wide coverage gate.
        "packages/sdk/src/child-safety-browser-media.ts",
      ],
      thresholds: { lines: 75, functions: 75, statements: 75, branches: 65 },
    },
  },
});
