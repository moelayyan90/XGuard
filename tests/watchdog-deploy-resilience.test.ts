import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const smokeRunner = readFileSync("scripts/run-mainnet-smokes.mjs", "utf8");
const tailWorkflow = readFileSync(
  ".github/workflows/verify-watchdog-tail.yml",
  "utf8",
);

describe("watchdog-aware deployment verification", () => {
  it("waits for active watchdog circuits to quiesce before protected protocol smokes", () => {
    expect(smokeRunner).toContain("waitForWatchdogQuiescence");
    expect(smokeRunner).toContain("openBreakers === 0");
    expect(smokeRunner).toContain("WATCHDOG_QUIET_ATTEMPTS = 40");
    expect(smokeRunner.indexOf("await waitForWatchdogQuiescence()"))
      .toBeLessThan(smokeRunner.indexOf("for (const check of checks)"));
  });

  it("falls back to direct smokes if watchdog health is completely unavailable", () => {
    expect(smokeRunner).toContain("if (watchdogObserved)");
    expect(smokeRunner).toContain(
      "watchdog health could not be observed; proceeding with direct protocol smokes",
    );
  });

  it("proves real mainnet invocations arrive in watchdog logs after successful deploys", () => {
    expect(tailWorkflow).toContain(
      'workflows: ["Deploy XGuard mainnet"]',
    );
    expect(tailWorkflow).toContain("wrangler tail xguard-watchdog");
    expect(tailWorkflow).toContain("--search watchdog_invocation");
    expect(tailWorkflow).toContain("/healthz?tailVerify=");
    expect(tailWorkflow).toContain("grep -Fq 'xguard-mainnet'");
  });
});
