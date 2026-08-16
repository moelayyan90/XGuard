import { describe, expect, it } from "vitest";
import { bindEconomicIntent } from "@xguard/core";
import { parseEconomicX402Envelope } from "../apps/worker/src/x402-economic-adapter.js";

const NETWORK = "eip155:84532";
const ASSET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const PAYER = "0x3333333333333333333333333333333333333333";

function intent() {
  return bindEconomicIntent({
    merchantId: "merchant_x402",
    actorId: "agent_x402",
    protocol: "x402",
    resource: {
      method: "GET",
      url: "https://merchant.example/paid-resource",
      bodyHash: null,
    },
    money: {
      maxAmountMicroUsd: 10_000,
      currency: "USD",
      network: NETWORK,
      asset: ASSET,
    },
    expiresAt: "2030-01-01T00:00:00Z",
    nonce: "x402-adapter-test",
    metadataHash: null,
  });
}

function envelope(overrides: Record<string, unknown> = {}) {
  const requirements = {
    scheme: "exact",
    network: NETWORK,
    asset: ASSET,
    amount: "5000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization",
    },
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: {
        url: "https://merchant.example/paid-resource",
        description: "adapter test",
        mimeType: "application/json",
      },
      accepted: requirements,
      payload: {
        signature: `0x${"ab".repeat(65)}`,
        authorization: {
          from: PAYER,
          to: PAY_TO,
          value: requirements.amount,
          validAfter: "0",
          validBefore: "1893456000",
          nonce: `0x${"12".repeat(32)}`,
        },
      },
    },
    paymentRequirements: requirements,
    ...overrides,
  };
}

describe("x402 Economic Firewall adapter", () => {
  it("binds an official x402 v2 envelope to the Economic Intent", () => {
    const parsed = parseEconomicX402Envelope(envelope(), intent().terms);
    expect(parsed.amountMicroUsd).toBe(5_000);
    expect(parsed.payer).toBe(PAYER);
    expect(parsed.payTo).toBe(PAY_TO);
    expect(parsed.authorizationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an x402 envelope for another resource", () => {
    const raw = envelope();
    (raw.paymentPayload.resource as { url: string }).url =
      "https://merchant.example/other-resource";
    expect(() => parseEconomicX402Envelope(raw, intent().terms)).toThrow(
      /resource URL does not match/,
    );
  });

  it("rejects an amount above the agent intent ceiling", () => {
    const raw = envelope();
    (raw.paymentRequirements as { amount: string }).amount = "15000";
    (raw.paymentPayload.accepted as { amount: string }).amount = "15000";
    expect(() => parseEconomicX402Envelope(raw, intent().terms)).toThrow(
      /exceeds the Economic Intent ceiling/,
    );
  });

  it("rejects accepted terms that differ from paymentRequirements", () => {
    const raw = envelope();
    (raw.paymentPayload.accepted as { payTo: string }).payTo =
      "0x4444444444444444444444444444444444444444";
    expect(() => parseEconomicX402Envelope(raw, intent().terms)).toThrow(
      /accepted does not match paymentRequirements/,
    );
  });
});
