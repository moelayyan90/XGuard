import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watchdogConfig = readFileSync(
  "apps/worker/wrangler.watchdog.jsonc",
  "utf8",
);
const watchdogWorker = readFileSync(
  "apps/worker/src/mainnet-watchdog.ts",
  "utf8",
);
const mainnetWorker = readFileSync("apps/worker/src/mainnet-modern.ts", "utf8");
const migration = readFileSync(
  "apps/worker/migrations/0012_watchdog_control_plane.sql",
  "utf8",
);
const deployWorkflow = readFileSync(
  ".github/workflows/deploy-watchdog.yml",
  "utf8",
);
const rollbackWorkflow = readFileSync(
  ".github/workflows/auto-rollback-mainnet.yml",
  "utf8",
);

describe("watchdog control plane source", () => {
  it("deploys as an independent Worker with logs, traces, analytics and cron probes", () => {
    expect(watchdogConfig).toContain('"name": "xguard-watchdog"');
    expect(watchdogConfig).toContain('"main": "src/mainnet-watchdog.ts"');
    expect(watchdogConfig).toContain('"analytics_engine_datasets"');
    expect(watchdogConfig).toContain('"binding": "ANALYTICS"');
    expect(watchdogConfig).toContain('"traces"');
    expect(watchdogConfig).toContain('"crons": ["*/1 * * * *"]');
  });

  it("contains both tail-time detection and scheduled synthetic probes", () => {
    expect(watchdogWorker).toContain("tail(");
    expect(watchdogWorker).toContain("processTail(events, env)");
    expect(watchdogWorker).toContain("runSyntheticProbes");
    expect(watchdogWorker).toContain("recordWatchdogSignal");
    expect(watchdogWorker).toContain("openRouteBreaker");
    expect(watchdogWorker).toContain("openGlobalWriteBreaker");
  });

  it("fails closed before risky mainnet writes when a watchdog circuit is open", () => {
    expect(mainnetWorker).toContain(
      'import { watchdogGuardResponse } from "./watchdog-store.js";',
    );
    expect(mainnetWorker).toContain(
      "watchdogGuardResponse(standardRequest, env.DB)",
    );
    expect(mainnetWorker).toContain('event: "watchdog_circuit_open"');
    expect(
      mainnetWorker.indexOf("watchdogGuardResponse(standardRequest, env.DB)"),
    ).toBeLessThan(
      mainnetWorker.indexOf("routeSettlementTruth(standardRequest, env)"),
    );
  });

  it("persists incidents, breakers and probe streaks in D1", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS watchdog_incidents",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS watchdog_breakers");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS watchdog_probe_state",
    );
  });

  it("has an automated deployment and live health verification workflow", () => {
    expect(deployWorkflow).toContain("Deploy XGuard watchdog");
    expect(deployWorkflow).toContain("group: xguard-mainnet-deploy");
    expect(deployWorkflow).toContain("wrangler deploy --config");
    expect(deployWorkflow).toContain("xguard-watchdog.maqamapp.workers.dev");
    expect(deployWorkflow).toContain("/healthz");
  });

  it("only auto-rolls back after deployment succeeded and live verification failed", () => {
    expect(rollbackWorkflow).toContain('workflows: ["Deploy XGuard mainnet"]');
    expect(rollbackWorkflow).toContain(
      'step.name === "Deploy guarded production Worker" && step.conclusion === "success"',
    );
    expect(rollbackWorkflow).toContain(
      'step.name === "Verify live mainnet readiness" && step.conclusion === "failure"',
    );
    expect(rollbackWorkflow).toContain("npx wrangler rollback");
    expect(rollbackWorkflow).toContain("Verify recovered mainnet");
  });
});
