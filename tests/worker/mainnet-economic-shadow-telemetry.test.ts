import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { MainnetEconomicShadowBinding } from "../../apps/worker/src/mainnet-economic-shadow.js";
import {
  mainnetEconomicShadowStats,
  pruneMainnetEconomicShadowTelemetry,
  recordMainnetEconomicShadowObservation,
} from "../../apps/worker/src/mainnet-economic-shadow-telemetry.js";

const MERCHANT = "merchant_shadow_test";
const TERMS_HASH = "1".repeat(64);
const AUTH_HASH = "2".repeat(64);

beforeEach(async () => {
  await env.DB.prepare(
    "DELETE FROM economic_firewall_shadow_observations",
  ).run();
});

function shadow(
  authorizationHash = AUTH_HASH,
): MainnetEconomicShadowBinding {
  return {
    intent: {
      intentId: `xi_${TERMS_HASH.slice(0, 40)}`,
      termsHash: TERMS_HASH,
      terms: {
        version: 1,
        merchantId: MERCHANT,
        actorId: "0x1111111111111111111111111111111111111111",
        protocol: "x402",
        resource: {
          method: "X402",
          url: "https://merchant.example/resource",
          bodyHash: null,
        },
        money: {
          maxAmountMicroUsd: 5_000,
          currency: "USD",
          network: "eip155:8453",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        },
        expiresAt: "2030-01-01T00:00:00.000Z",
        nonce: `0x${"12".repeat(32)}`,
        metadataHash: "3".repeat(64),
      },
    },
    authorizationHash,
    amountMicroUsd: 5_000,
    payer: "0x1111111111111111111111111111111111111111",
    payTo: "0x2222222222222222222222222222222222222222",
    resourceUrl: "https://merchant.example/resource",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

describe("mainnet Economic Firewall shadow telemetry", () => {
  it("correlates verify and settle observations for one intent", async () => {
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "verify",
    );
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "settle",
    );

    await expect(mainnetEconomicShadowStats(env.DB)).resolves.toEqual({
      intents: 1,
      verifyEvents: 1,
      settleEvents: 1,
      correlatedIntents: 1,
      settleWithoutVerifyIntents: 0,
      authorizationMismatchEvents: 0,
    });
  });

  it("counts an authorization hash change without creating another intent", async () => {
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "verify",
    );
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow("4".repeat(64)),
      "verify",
    );

    const stats = await mainnetEconomicShadowStats(env.DB);
    expect(stats.intents).toBe(1);
    expect(stats.verifyEvents).toBe(2);
    expect(stats.authorizationMismatchEvents).toBe(1);
  });

  it("surfaces settle observations that have no prior verify", async () => {
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "settle",
    );

    const stats = await mainnetEconomicShadowStats(env.DB);
    expect(stats.settleEvents).toBe(1);
    expect(stats.settleWithoutVerifyIntents).toBe(1);
    expect(stats.correlatedIntents).toBe(0);
  });

  it("prunes observations that have been inactive for more than 48 hours", async () => {
    const old = new Date("2026-08-10T00:00:00.000Z");
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "verify",
      old,
    );

    await pruneMainnetEconomicShadowTelemetry(
      env.DB,
      Date.parse("2026-08-13T00:00:00.000Z"),
    );

    const stats = await mainnetEconomicShadowStats(env.DB);
    expect(stats.intents).toBe(0);
  });
});
