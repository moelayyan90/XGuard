import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mainnet revenue hardening source invariants", () => {
  it("holds prepaid fee and checks unit economics before downstream dispatch", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-supervisor.ts",
      "utf8",
    );
    const guard = source.indexOf(
      "const economicsBlock = await guardUnitEconomics(env);",
    );
    const funding = source.indexOf(
      "const fundingBlock = await preparePrepaidFee(",
    );
    const downstream = source.indexOf(
      "const response = await delegateFetch(request, env, ctx);",
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(funding).toBeGreaterThan(guard);
    expect(downstream).toBeGreaterThan(funding);
    expect(source).not.toContain(
      "Merchant must prepay XGuard service balance before verification",
    );
  });

  it("keeps global revenue private and runs automatic maintenance", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-supervisor.ts",
      "utf8",
    );
    expect(source).toContain("delete body.successfulBillableSettlements");
    expect(source).toContain("delete body.earnedMicroUsd");
    expect(source).toContain('body.financialMetrics = "private"');
    expect(source).toContain("scanAutomaticTopUpsWithFailover(env)");
    expect(source).toContain("releaseExpiredVerifyHolds(env)");
  });

  it("does not call Base RPC unless a current or recently expired top-up intent exists", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-supervisor.ts",
      "utf8",
    );
    const gate = source.indexOf("const relevantIntent = await env.DB.prepare(");
    const reset = source.indexOf(
      "DELETE FROM treasury_scan_state WHERE scanner_id='base-usdc'",
      gate,
    );
    const scan = source.indexOf(
      "const result = await scanAutomaticTopUpsWithFailover(env);",
      gate,
    );
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(gate);
    expect(scan).toBeGreaterThan(reset);
    expect(source).toContain("TOPUP_SCAN_RECOVERY_GRACE_SECONDS");
    expect(source).toContain("state IN ('OPEN','EXPIRED')");
    expect(source).toContain("expires_at_epoch>=?");
  });

  it("uses a Cloudflare-supported redirect mode for automatic top-up RPC calls", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-revenue-hardening.ts",
      "utf8",
    );
    expect(source).toContain('redirect: "manual"');
    expect(source).not.toContain('redirect: "error"');
    expect(source).toContain(
      "if (!response.ok) throw new Error(`rpc_http_${response.status}`);",
    );
  });

  it("uses bounded RPC fallback without the Cloudflare-blocked PublicNode endpoint", async () => {
    const config = await readFile("apps/worker/wrangler.mainnet.jsonc", "utf8");
    expect(config).toContain('"BASE_RPC_URL": "https://public.1rpc.io/base"');
    expect(config).toContain("https://base.drpc.org");
    expect(config).toContain("https://mainnet.base.org");
    expect(config).not.toContain("base-rpc.publicnode.com");
  });

  it("exposes key rotation, scopes, and protected admin economics", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-revenue-hardening.ts",
      "utf8",
    );
    expect(source).toContain('url.pathname === "/v1/api-key/rotate"');
    expect(source).toContain('url.pathname === "/v1/api-key/revoke"');
    expect(source).toContain('url.pathname === "/v1/admin/financials"');
    expect(source).toContain('url.pathname === "/v1/admin/economics"');
    expect(source).toContain("XGUARD_ADMIN_TOKEN_SHA256");
  });
});
