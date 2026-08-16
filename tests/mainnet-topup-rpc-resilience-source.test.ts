import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supervisor = readFileSync(
  "apps/worker/src/mainnet-supervisor.ts",
  "utf8",
);
const hardening = readFileSync(
  "apps/worker/src/mainnet-revenue-hardening.ts",
  "utf8",
);
const mainnetConfig = readFileSync(
  "apps/worker/wrangler.mainnet.jsonc",
  "utf8",
);

describe("automatic top-up RPC resilience", () => {
  it("uses demand-bounded polling and multiple RPC candidates", () => {
    expect(supervisor).toContain("TOPUP_SCAN_INTERVAL_MINUTES = 5");
    expect(supervisor).toContain("state IN ('OPEN','EXPIRED')");
    expect(supervisor).toContain("DELETE FROM treasury_scan_state");
    expect(supervisor).toContain("scanAutomaticTopUpsWithFailover");
    expect(supervisor).toContain("automatic_topup_scan_deferred");
    expect(supervisor).toContain("automatic_topup_rpc_failover_recovered");
    expect(mainnetConfig).toContain("BASE_RPC_FALLBACK_URLS");
    expect(mainnetConfig).toContain("https://rpc.ankr.com/base");
    expect(mainnetConfig).toContain("https://base.drpc.org");
    expect(mainnetConfig).toContain("https://public.1rpc.io/base");
    expect(mainnetConfig).toContain("https://mainnet.base.org");
    expect(mainnetConfig).not.toContain("base-rpc.publicnode.com");
  });

  it("allows the scanner to receive a per-attempt RPC override", () => {
    expect(hardening).toContain("baseRpcUrl = env.BASE_RPC_URL");
    expect(hardening).toContain("const rpcUrl = new URL(baseRpcUrl)");
  });
});
