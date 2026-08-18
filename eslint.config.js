import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "apps/worker/worker-configuration.d.ts",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["browser-extension/recovery-layer.js"],
    languageOptions: {
      globals: {
        crypto: "readonly",
        getComputedStyle: "readonly",
      },
    },
  },
);
