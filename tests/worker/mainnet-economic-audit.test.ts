import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { MainnetEconomicShadowBinding } from "../../apps/worker/src/mainnet-economic-shadow.js";
import { recordMainnetEconomicShadowObservation } from "../../apps/worker/src/mainnet-economic-shadow-telemetry.js";
import {
  evaluateMainnetEconomicSettlementAudit,
  mainnetEconomicAuditStats,
  parseMainnetEconomicAuditMode,
  recordMainnetEconomicAuditDecision,
} from "../../apps/worker/src/mainnet-economic-audit.js";

const MERCHANT = "merchant_audit_test";
const TERMS_HASH = "a".repeat(64);
const AUTH_HASH = "b".repeat(64);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM economic_firewall_audit_summary").run();
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
          url: "https://merchant.example/audit-resource",
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
        metadataHash: "c".repeat(64),
      },
    },
    authorizationHash,
    amountMicroUsd: 5_000,
    payer: "0x1111111111111111111111111111111111111111",
    payTo: "0x2222222222222222222222222222222222222222",
    resourceUrl: "https://merchant.example/audit-resource",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

describe("mainnet Economic Firewall audit mode", () => {
  it("defaults to off and only accepts the explicit audit value", () => {
    expect(parseMainnetEconomicAuditMode(undefined)).toBe("off");
    expect(parseMainnetEconomicAuditMode("")).toBe("off");
    expect(parseMainnetEconomicAuditMode("enforce")).toBe("off");
    expect(parseMainnetEconomicAuditMode(" AUDIT ")).toBe("audit");
  });

  it("reviews a settle when no verify observation exists yet", async () => {
    await expect(
      evaluateMainnetEconomicSettlementAudit(env.DB, MERCHANT, shadow()),
    ).resolves.toEqual({
      verdict: "REVIEW",
      reason: "VERIFY_NOT_OBSERVED",
    });
  });

  it("passes a settle correlated to the same observed authorization", async () => {
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "verify",
    );

    await expect(
      evaluateMainnetEconomicSettlementAudit(env.DB, MERCHANT, shadow()),
    ).resolves.toEqual({
      verdict: "PASS",
      reason: "CORRELATED_AUTHORIZATION",
    });
  });

  it("reviews an authorization hash mismatch", async () => {
    await recordMainnetEconomicShadowObservation(
      env.DB,
      MERCHANT,
      shadow(),
      "verify",
    );

    await expect(
      evaluateMainnetEconomicSettlementAudit(
        env.DB,
        MERCHANT,
        shadow("d".repeat(64)),
      ),
    ).resolves.toEqual({
      verdict: "REVIEW",
      reason: "AUTHORIZATION_MISMATCH",
    });
  });

  it("stores only aggregate verdict counts", async () => {
    await recordMainnetEconomicAuditDecision(env.DB, {
      verdict: "PASS",
      reason: "CORRELATED_AUTHORIZATION",
    });
    await recordMainnetEconomicAuditDecision(env.DB, {
      verdict: "REVIEW",
      reason: "VERIFY_NOT_OBSERVED",
    });
    await recordMainnetEconomicAuditDecision(env.DB, {
      verdict: "REVIEW",
      reason: "VERIFY_NOT_OBSERVED",
    });
    await recordMainnetEconomicAuditDecision(env.DB, {
      verdict: "REVIEW",
      reason: "AUTHORIZATION_MISMATCH",
    });

    await expect(mainnetEconomicAuditStats(env.DB)).resolves.toEqual({
      evaluatedSettles: 4,
      pass: 1,
      review: 3,
      correlatedAuthorization: 1,
      verifyNotObserved: 2,
      authorizationMismatch: 1,
    });
  });
});
