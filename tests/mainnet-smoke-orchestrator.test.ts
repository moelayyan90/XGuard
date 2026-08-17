import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mainnet live smoke orchestration", () => {
  it("runs core and compatibility smokes through the observable orchestrator", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["smoke:mainnet"]).toBe(
      "node scripts/run-mainnet-smokes.mjs",
    );

    const source = readFileSync("scripts/run-mainnet-smokes.mjs", "utf8");
    expect(source).toContain('script: "scripts/smoke-mainnet.mjs"');
    expect(source).toContain(
      'script: "scripts/smoke-compatibility-mainnet.mjs"',
    );
    expect(source).toContain("attempt <= 3");
    expect(source).toContain('stdio: "inherit"');
  });
});
