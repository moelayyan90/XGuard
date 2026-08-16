import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mainnet revenue hardening source invariants", () => {
  it("holds prepaid fee and checks unit economics before downstream dispatch", async () => {
    const source = await readFile("apps/worker/src/mainnet-supervisor.ts", "utf8");
    const guard = source.indexOf("const economicsBlock = await guardUnitEconomics(env);");
    const funding = source.indexOf("const fundingBlock = await preparePrepaidFee(");
    const downstream = source.indexOf("const response = await delegateFetch(request, env, ctx);");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(funding).toBeGreaterThan(guard);
    expect(downstream).toBeGreaterThan(funding);
    expect(source).not.toContain("Merchant must prepay XGuard service balance before verification");
  });

  it("keeps global revenue private and runs automatic maintenance", async () => {
    const source = await readFile("apps/worker/src/mainnet-supervisor.ts", "utf8");
    expect(source).toContain("delete body.successfulBillableSettlements");
    expect(source).toContain("delete body.earnedMicroUsd");
    expect(source).toContain('body.financialMetrics = "private"');
    expect(source).toContain("scanAutomaticTopUps(env)");
    expect(source).toContain("releaseExpiredVerifyHolds(env)");
  });

  it("exposes key rotation, scopes, and protected admin economics", async () => {
    const source = await readFile("apps/worker/src/mainnet-revenue-hardening.ts", "utf8");
    expect(source).toContain('url.pathname === "/v1/api-key/rotate"');
    expect(source).toContain('url.pathname === "/v1/api-key/revoke"');
    expect(source).toContain('url.pathname === "/v1/admin/financials"');
    expect(source).toContain('url.pathname === "/v1/admin/economics"');
    expect(source).toContain("XGUARD_ADMIN_TOKEN_SHA256");
  });
});
