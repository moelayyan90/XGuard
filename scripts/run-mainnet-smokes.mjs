import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const checks = [
  { name: "core mainnet smoke", script: "scripts/smoke-mainnet.mjs" },
  {
    name: "x402 compatibility smoke",
    script: "scripts/smoke-compatibility-mainnet.mjs",
  },
];

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
  }),
);
