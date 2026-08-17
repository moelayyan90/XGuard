import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const deployWorkflow = readFileSync(
  ".github/workflows/deploy-mainnet.yml",
  "utf8",
);

describe("mainnet release gate", () => {
  it("uses the mainnet-specific gate in the production deploy workflow", () => {
    expect(deployWorkflow).toContain("npm run verify:mainnet-release");
    expect(deployWorkflow).not.toContain("npm run verify:release\n");
  });

  it("does not dry-run non-production Worker targets from the mainnet gate", () => {
    const script = packageJson.scripts?.["verify:mainnet-release"] ?? "";

    expect(script).toContain("build:mainnet");
    expect(script).not.toContain("run build &&");
    expect(script).not.toContain("build:economic-preview");
  });
});
