import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const smokeRunner = readFileSync("scripts/run-mainnet-smokes.mjs", "utf8");
const tailWorkflow = readFileSync(
  ".github/workflows/verify-watchdog-tail.yml",
  "utf8",
);
const watchdogWorkflow = readFileSync(
  ".github/workflows/deploy-watchdog.yml",
  "utf8",
);
const watchdogWorker = readFileSync(
  "apps/worker/src/mainnet-watchdog.ts",
  "utf8",
);

describe("watchdog-aware deployment verification", () => {
  it("requires the current watchdog policy and a quiet circuit before protected smokes", () => {
    expect(smokeRunner).toContain("waitForWatchdogQuiescence");
    expect(smokeRunner).toContain('WATCHDOG_POLICY_VERSION = "2026-08-17-v2"');
    expect(smokeRunner).toContain(
      "body?.policyVersion === WATCHDOG_POLICY_VERSION",
    );
    expect(smokeRunner).toContain("body.openBreakers === 0");
    expect(smokeRunner).toContain("WATCHDOG_QUIET_ATTEMPTS = 40");
    expect(
      smokeRunner.indexOf("await waitForWatchdogQuiescence()"),
    ).toBeLessThan(smokeRunner.indexOf("for (const check of checks)"));
  });

  it("fails if an old watchdog is reachable instead of testing against stale policy", () => {
    expect(smokeRunner).toContain("if (watchdogReachable)");
    expect(smokeRunner).toContain(
      "did not become live before mainnet protocol smokes",
    );
    expect(smokeRunner).toContain(
      "watchdog health could not be observed; proceeding with direct protocol smokes",
    );
  });

  it("publishes the same policy version from watchdog health", () => {
    expect(watchdogWorker).toContain(
      'WATCHDOG_POLICY_VERSION = "2026-08-17-v2"',
    );
    expect(watchdogWorker).toContain("policyVersion: WATCHDOG_POLICY_VERSION");
  });

  it("deploys watchdog independently on every main push unless emergency shutdown is active", () => {
    if (watchdogWorkflow.includes("intentionally disabled")) {
      expect(watchdogWorkflow).toContain("workflow_dispatch");
      expect(watchdogWorkflow).toContain("if: ${{ false }}");
      return;
    }
    expect(watchdogWorkflow).toContain("push:\n    branches: [main]");
    expect(watchdogWorkflow).not.toContain("paths:");
    expect(watchdogWorkflow).toContain("group: xguard-watchdog-deploy");
    expect(watchdogWorkflow).toContain("cancel-in-progress: true");
    expect(watchdogWorkflow).toContain('x.policyVersion!=="2026-08-17-v2"');
  });

  it("verifies canonical mainnet health after successful deploys", () => {
    expect(tailWorkflow).toContain('workflows: ["Deploy XGuard mainnet"]');
    expect(tailWorkflow).toContain('BASE_URL="https://xguardgate.com"');
    expect(tailWorkflow).toContain("${BASE_URL}/healthz");
    expect(tailWorkflow).toContain("${BASE_URL}/status");
    expect(tailWorkflow).toContain("${BASE_URL}/.well-known/agent-card.json");
    expect(tailWorkflow).toContain('i.protocolVersion==="1.0"');
    expect(tailWorkflow).not.toContain("wrangler tail xguard-watchdog");
    expect(tailWorkflow).not.toContain("maqamapp.workers.dev");
  });
});
