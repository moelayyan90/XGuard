import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const WATCHDOG_URL = new URL(
  process.env.XGUARD_WATCHDOG_URL ??
    "https://xguard-watchdog.maqamapp.workers.dev",
);
const WATCHDOG_QUIET_ATTEMPTS = 40;
const WATCHDOG_QUIET_INTERVAL_MS = 5_000;

const checks = [
  { name: "core mainnet smoke", script: "scripts/smoke-mainnet.mjs" },
  {
    name: "x402 compatibility smoke",
    script: "scripts/smoke-compatibility-mainnet.mjs",
  },
];

async function waitForWatchdogQuiescence() {
  let watchdogObserved = false;
  for (let attempt = 1; attempt <= WATCHDOG_QUIET_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        new URL(`/healthz?smokeQuiescence=${attempt}`, WATCHDOG_URL),
        {
          headers: { "Cache-Control": "no-cache" },
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = await response.json();
      if (response.status === 200 && Number.isInteger(body?.openBreakers)) {
        watchdogObserved = true;
        if (body.openBreakers === 0) {
          console.log(
            JSON.stringify({
              watchdogQuiescent: true,
              attempt,
              openIncidents: body.openIncidents ?? null,
            }),
          );
          return;
        }
        console.log(
          JSON.stringify({
            watchdogQuiescent: false,
            attempt,
            openBreakers: body.openBreakers,
            openIncidents: body.openIncidents ?? null,
          }),
        );
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          watchdogProbeUnavailable: true,
          attempt,
          code: error instanceof Error ? error.name : "unknown_error",
        }),
      );
    }
    if (attempt < WATCHDOG_QUIET_ATTEMPTS)
      await delay(WATCHDOG_QUIET_INTERVAL_MS);
  }

  if (watchdogObserved)
    throw new Error(
      `watchdog circuits did not quiesce within ${
        (WATCHDOG_QUIET_ATTEMPTS * WATCHDOG_QUIET_INTERVAL_MS) / 1000
      } seconds`,
    );

  console.warn(
    "XGuard watchdog health could not be observed; proceeding with direct protocol smokes.",
  );
}

await waitForWatchdogQuiescence();

for (const check of checks) {
  let passed = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`=== ${check.name} (attempt ${attempt}/3) ===`);
    const result = spawnSync(process.execPath, [check.script], {
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status === 0) {
      passed = true;
      break;
    }
    if (attempt < 3) await delay(2_000);
  }
  if (!passed) throw new Error(`${check.name} failed after 3 attempts`);
}

console.log(
  JSON.stringify({
    mainnetSmokeSuite: true,
    coreMainnet: true,
    x402CompatibilityBridge: true,
    watchdogQuiescenceChecked: true,
  }),
);
