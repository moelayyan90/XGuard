import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watchdogDeploy = readFileSync(
  ".github/workflows/deploy-watchdog.yml",
  "utf8",
);
const mainnetDeploy = readFileSync(
  ".github/workflows/deploy-mainnet.yml",
  "utf8",
);

describe("watchdog deployment concurrency", () => {
  it("deploys independently from the mainnet Worker", () => {
    expect(watchdogDeploy).toContain("group: xguard-watchdog-deploy");
    expect(watchdogDeploy).not.toContain("group: xguard-mainnet-deploy");
    expect(mainnetDeploy).toContain("group: xguard-mainnet-deploy");
  });
});
