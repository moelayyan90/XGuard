import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainnetConfig = readFileSync(
  "apps/worker/wrangler.mainnet.jsonc",
  "utf8",
);
const watchdogWorker = readFileSync(
  "apps/worker/src/mainnet-watchdog.ts",
  "utf8",
);

describe("watchdog Tail Worker wiring", () => {
  it("attaches xguard-watchdog to the production Worker", () => {
    expect(mainnetConfig).toContain('"tail_consumers"');
    expect(mainnetConfig).toContain('"service": "xguard-watchdog"');
    expect(watchdogWorker).toContain("tail(events");
  });
});
