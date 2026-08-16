import { describe, expect, it } from "vitest";
import {
  deriveMainnetEconomicShadowBinding,
  parseMainnetEconomicShadowMode,
} from "../apps/worker/src/mainnet-economic-shadow.js";
import {
  BASE_MAINNET,
  BASE_USDC,
  type ParsedMainnetRequest,
} from "../apps/worker/src/mainnet-protocol.js";

const PAYER = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const NONCE = `0x${"12".repeat(32)}`;

function requestFixture(): ParsedMainnetRequest {
  const paymentRequirements = {
    scheme: "exact",
    network: BASE_MAINNET,
    asset: BASE_USDC,
    amount: "5000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization",
    },
  };
  const paymentPayload = {
    x402Version: 2,
    resource: {
      url: "https://merchant.example/paid-resource",
      description: "shadow test",
      mimeType: "application/json",
    },
    accepted: { ...paymentRequirements },
    payload: {
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: "5000",
        validAfter: "0",
        validBefore: "1893456000",
        nonce: NONCE,
      },
    },
  };
  const raw = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements,
  };
  return {
    raw,
    paymentPayload,
    paymentRequirements,
    amountMicroUsd: 5000,
    payer: PAYER,
    payTo: PAY_TO,
  } as unknown as ParsedMainnetRequest;
}

describe("mainnet Economic Firewall shadow binding", () => {
  it("is deterministic for the same parsed x402 authorization", () => {
    const first = deriveMainnetEconomicShadowBinding(
      "merchant_shadow",
      requestFixture(),
    );
    const second = deriveMainnetEconomicShadowBinding(
      "merchant_shadow",
      requestFixture(),
    );

    expect(first.intent.intentId).toBe(second.intent.intentId);
    expect(first.intent.termsHash).toBe(second.intent.termsHash);
    expect(first.authorizationHash).toBe(second.authorizationHash);
    expect(first.intent.terms.protocol).toBe("x402");
    expect(first.intent.terms.money.network).toBe(BASE_MAINNET);
    expect(first.intent.terms.money.asset).toBe(BASE_USDC.toLowerCase());
    expect(first.intent.terms.money.maxAmountMicroUsd).toBe(5000);
    expect(first.intent.terms.resource.url).toBe(
      "https://merchant.example/paid-resource",
    );
    expect(first.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("binds the settlement destination into the Economic Intent terms hash", () => {
    const first = deriveMainnetEconomicShadowBinding(
      "merchant_shadow",
      requestFixture(),
    );
    const changed = requestFixture();
    changed.payTo = "0x3333333333333333333333333333333333333333";
    const second = deriveMainnetEconomicShadowBinding(
      "merchant_shadow",
      changed,
    );

    expect(second.intent.terms.metadataHash).not.toBe(
      first.intent.terms.metadataHash,
    );
    expect(second.intent.intentId).not.toBe(first.intent.intentId);
  });

  it("rejects a mainnet x402 payload that has no resource binding", () => {
    const request = requestFixture();
    delete (request.paymentPayload as unknown as Record<string, unknown>)
      .resource;

    expect(() =>
      deriveMainnetEconomicShadowBinding("merchant_shadow", request),
    ).toThrow(/paymentPayload\.resource must be an object/);
  });

  it("rejects an unusable authorization expiry", () => {
    const request = requestFixture();
    const payload = request.paymentPayload as unknown as Record<
      string,
      unknown
    >;
    const paymentBody = payload.payload as Record<string, unknown>;
    const authorization = paymentBody.authorization as Record<string, unknown>;
    authorization.validBefore = "0";

    expect(() =>
      deriveMainnetEconomicShadowBinding("merchant_shadow", request),
    ).toThrow(/validBefore is outside the supported timestamp range/);
  });

  it("defaults the mainnet shadow feature flag to off", () => {
    expect(parseMainnetEconomicShadowMode(undefined)).toBe("off");
    expect(parseMainnetEconomicShadowMode("")).toBe("off");
    expect(parseMainnetEconomicShadowMode("typo")).toBe("off");
    expect(parseMainnetEconomicShadowMode(" OBSERVE ")).toBe("observe");
  });
});
