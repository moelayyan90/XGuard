import { describe, expect, it } from "vitest";
import {
  assertEconomicIntentTransition,
  bindEconomicAuthorization,
  bindEconomicFulfillment,
  bindEconomicIntent,
  bindEconomicSettlement,
  buildXGuardProof,
  sha256Hex,
} from "@xguard/core";

function intent(overrides: Record<string, unknown> = {}) {
  return bindEconomicIntent({
    merchantId: "merchant_1",
    actorId: "agent_1",
    protocol: "x402",
    resource: {
      method: "post",
      url: "https://api.example.com/analyze?mode=full#ignored",
      bodyHash: sha256Hex({ file: "abc" }),
    },
    money: {
      maxAmountMicroUsd: 40_000,
      currency: "usd",
      network: "eip155:8453",
      asset: "usdc",
    },
    expiresAt: "2030-01-01T00:00:00Z",
    nonce: "nonce-1",
    metadataHash: null,
    ...overrides,
  });
}

describe("economic intent binding", () => {
  it("normalizes stable terms into one deterministic intent", () => {
    const first = intent();
    const second = bindEconomicIntent({
      merchantId: "merchant_1",
      actorId: "agent_1",
      protocol: "X402",
      resource: {
        method: "POST",
        url: "https://api.example.com/analyze?mode=full",
        bodyHash: sha256Hex({ file: "abc" }).toUpperCase(),
      },
      money: {
        maxAmountMicroUsd: 40_000,
        currency: "USD",
        network: "EIP155:8453",
        asset: "USDC",
      },
      expiresAt: "2030-01-01T00:00:00.000Z",
      nonce: "nonce-1",
      metadataHash: null,
    });

    expect(second.intentId).toBe(first.intentId);
    expect(second.termsHash).toBe(first.termsHash);
    expect(first.terms.resource.method).toBe("POST");
    expect(first.terms.resource.url).toBe(
      "https://api.example.com/analyze?mode=full",
    );
  });

  it("changes the binding if economic terms change", () => {
    const first = intent();
    const moreExpensive = intent({
      money: {
        maxAmountMicroUsd: 50_000,
        currency: "USD",
        network: "eip155:8453",
        asset: "usdc",
      },
    });
    const differentResource = intent({
      resource: {
        method: "POST",
        url: "https://api.example.com/analyze?mode=summary",
        bodyHash: sha256Hex({ file: "abc" }),
      },
    });

    expect(moreExpensive.termsHash).not.toBe(first.termsHash);
    expect(differentResource.termsHash).not.toBe(first.termsHash);
  });

  it("rejects authorization and settlement above the intent ceiling", () => {
    const bound = intent();
    expect(() =>
      bindEconomicAuthorization({
        intent: bound,
        authorization: { signature: "0xabc" },
        authorizedAmountMicroUsd: 40_001,
      }),
    ).toThrow(/exceeds/);
    expect(() =>
      bindEconomicSettlement({
        intent: bound,
        protocol: "x402",
        settlement: { tx: "0x123" },
        chargedAmountMicroUsd: 40_001,
      }),
    ).toThrow(/exceeds/);
  });
});

describe("economic intent exactly-once proof", () => {
  it("binds authorization, fulfillment and settlement to the same intent", () => {
    const bound = intent();
    const authorization = bindEconomicAuthorization({
      intent: bound,
      authorization: { signature: "0xabc", payer: "0x1" },
      authorizedAmountMicroUsd: 40_000,
    });
    const fulfillment = bindEconomicFulfillment({
      intent: bound,
      fulfillment: { resultHash: "0xfeed", status: 200 },
    });
    const settlement = bindEconomicSettlement({
      intent: bound,
      protocol: "x402",
      settlement: { tx: "0x123", facilitator: "payai" },
      chargedAmountMicroUsd: 34_000,
    });

    const proof = buildXGuardProof({
      intent: bound,
      authorization,
      fulfillment,
      settlement,
    });

    expect(proof.intentId).toBe(bound.intentId);
    expect(proof.result).toBe("EXACTLY_ONCE");
    expect(proof.chargedAmountMicroUsd).toBe(34_000);
    expect(proof.proofHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects artifacts copied from another intent", () => {
    const first = intent();
    const second = intent({ nonce: "nonce-2" });
    const authorization = bindEconomicAuthorization({
      intent: first,
      authorization: { signature: "0xabc" },
      authorizedAmountMicroUsd: 40_000,
    });
    const fulfillment = bindEconomicFulfillment({
      intent: second,
      fulfillment: { status: 200 },
    });
    const settlement = bindEconomicSettlement({
      intent: first,
      protocol: "x402",
      settlement: { tx: "0x123" },
      chargedAmountMicroUsd: 35_000,
    });

    expect(() =>
      buildXGuardProof({
        intent: first,
        authorization,
        fulfillment,
        settlement,
      }),
    ).toThrow(/different intent terms/);
  });

  it("rejects settlement above the amount actually authorized", () => {
    const bound = intent();
    const authorization = bindEconomicAuthorization({
      intent: bound,
      authorization: { signature: "0xabc" },
      authorizedAmountMicroUsd: 30_000,
    });
    const fulfillment = bindEconomicFulfillment({
      intent: bound,
      fulfillment: { status: 200 },
    });
    const settlement = bindEconomicSettlement({
      intent: bound,
      protocol: "x402",
      settlement: { tx: "0x123" },
      chargedAmountMicroUsd: 35_000,
    });

    expect(() =>
      buildXGuardProof({
        intent: bound,
        authorization,
        fulfillment,
        settlement,
      }),
    ).toThrow(/authorized amount/);
  });
});

describe("economic intent state machine", () => {
  it("allows the exact transaction lifecycle and rejects skipping it", () => {
    const path = [
      ["CREATED", "BOUND"],
      ["BOUND", "AUTHORIZED"],
      ["AUTHORIZED", "LOCKED"],
      ["LOCKED", "EXECUTING"],
      ["EXECUTING", "FULFILLED"],
      ["FULFILLED", "SETTLED"],
      ["SETTLED", "FINAL"],
    ] as const;

    for (const [from, to] of path) {
      expect(() => assertEconomicIntentTransition(from, to)).not.toThrow();
    }
    expect(() => assertEconomicIntentTransition("BOUND", "SETTLED")).toThrow(
      /Invalid economic intent transition/,
    );
    expect(() => assertEconomicIntentTransition("FINAL", "EXECUTING")).toThrow(
      /Invalid economic intent transition/,
    );
  });
});
