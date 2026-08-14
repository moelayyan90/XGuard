import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/gateway/src/config.js";
import { GatewayMetrics } from "../apps/gateway/src/metrics.js";
import { createXGuardFacilitator, XGUARD_DEFAULT_FEE_USD } from "@xguard/sdk";

describe("gateway configuration", () => {
  it("loads fail-closed testnet defaults with exact fee and reserve", () => {
    const config = loadConfig({});
    expect(config.mainnetEnabled).toBe(false);
    expect(config.feeMicroUsd).toBe(2_000n);
    expect(config.reservePercent).toBe(20);
    expect(config.minimumReserveMicroUsd).toBe(25_000_000n);
    expect(config.lowBalanceThresholdMicroUsd).toBe(20_000n);
    expect(config.supportedNetworks).toEqual(new Set(["eip155:84532"]));
    expect(config.facilitatorDefinitions[0]).toMatchObject({
      id: "x402-public-testnet",
      downstreamCostMicroUsd: 0n,
    });
  });

  it("requires a pepper for production and keeps mainnet compile-time disabled", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/PEPPER/);
    expect(() =>
      loadConfig({
        XGUARD_MAINNET_ENABLED: "true",
        XGUARD_API_KEY_PEPPER: "pepper",
      }),
    ).toThrow(/compile-time disabled/);

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        XGUARD_API_KEY_PEPPER: "pepper",
        XGUARD_MAINNET_ENABLED: "true",
        XGUARD_MAINNET_LEGAL_GATE: "APPROVED",
        XGUARD_MAINNET_SECURITY_GATE: "APPROVED",
        XGUARD_MAINNET_RECONCILIATION_GATE: "APPROVED",
        XGUARD_MAINNET_OPERATIONAL_GATE: "APPROVED",
      }),
    ).toThrow(/compile-time disabled/);

    const configured = loadConfig({
      NODE_ENV: "production",
      XGUARD_API_KEY_PEPPER: "pepper",
    });
    expect(configured.mainnetEnabled).toBe(false);
  });

  it("rejects malformed money, facilitator origins, and reserve percentages", () => {
    expect(() => loadConfig({ XGUARD_FEE_MICRO_USD: "0.2" })).toThrow(
      /unsigned.*integer/,
    );
    expect(() => loadConfig({ OPERATING_RESERVE_PERCENT: "101" })).toThrow(
      /between/,
    );
    expect(() =>
      loadConfig({
        XGUARD_FACILITATORS_JSON: JSON.stringify([
          { id: "bad", url: "http://127.0.0.1", downstreamCostUsd: "0" },
        ]),
      }),
    ).toThrow(/HTTPS/);
  });
});

describe("SDK and metrics", () => {
  it("creates an official facilitator client and enforces secure origins", () => {
    const client = createXGuardFacilitator({
      url: "https://gateway.example/",
      apiKey: "xg_test_value",
      timeoutMs: 3_000,
    });
    expect(client).toBeDefined();
    expect(XGUARD_DEFAULT_FEE_USD).toBe("0.002000");
    expect(() =>
      createXGuardFacilitator({ url: "http://gateway.example" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      createXGuardFacilitator({ url: "http://localhost:8787" }),
    ).not.toThrow();
  });

  it("exports counters and p50/p95/p99 latency without floating-point money", () => {
    const metrics = new GatewayMetrics();
    metrics.increment("settlement-success.total");
    metrics.increment("settlement-success.total", 2n);
    for (const latency of [1, 2, 3, 4, 100]) metrics.observeLatency(latency);
    expect(metrics.percentile(0.5)).toBe(3);
    expect(metrics.percentile(0.95)).toBe(100);
    const output = metrics.prometheus();
    expect(output).toContain("xguard_settlement_success_total 3");
    expect(output).toContain('quantile="0.99"');
  });
});
