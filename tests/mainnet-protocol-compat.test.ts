import { describe, expect, it } from "vitest";
import {
  BASE_MAINNET,
  BASE_USDC,
  enforceBaseMainnetUsdc,
  normalizeXPayHealthResponse,
  normalizeXPaySupportedResponse,
} from "../apps/worker/src/mainnet-protocol.js";
import { fixturePayment } from "./fixtures.js";

function standardBasePayment() {
  const { payload, requirements } = fixturePayment({ network: BASE_MAINNET });
  requirements.asset = BASE_USDC;
  requirements.extra = { name: "USDC", version: "2" };
  payload.accepted = structuredClone(requirements);
  return { payload, requirements };
}

describe("mainnet x402 v2 compatibility", () => {
  it("accepts the standard exact EVM requirements without non-standard transfer hints", () => {
    const { payload, requirements } = standardBasePayment();

    expect(() => enforceBaseMainnetUsdc(payload, requirements)).not.toThrow();
  });

  it("still rejects an explicitly incompatible transfer method", () => {
    const { payload, requirements } = standardBasePayment();
    requirements.extra = {
      ...requirements.extra,
      assetTransferMethod: "permit2",
    };
    payload.accepted = structuredClone(requirements);

    expect(() => enforceBaseMainnetUsdc(payload, requirements)).toThrow(
      "XGuard mainnet requires exact EIP-3009 authorization payments",
    );
  });

  it("accepts the canonical x402 supported response", () => {
    const supported = normalizeXPaySupportedResponse({
      kinds: [
        { x402Version: 2, scheme: "exact", network: BASE_MAINNET },
      ],
      extensions: [],
      signers: {},
    });

    expect(supported.kinds).toContainEqual({
      x402Version: 2,
      scheme: "exact",
      network: BASE_MAINNET,
    });
  });

  it("normalizes the XPay documented supportedNetworks response", () => {
    const supported = normalizeXPaySupportedResponse({
      supportedNetworks: [
        { networkId: BASE_MAINNET, version: "v2" },
        { networkId: "eip155:84532", version: "v2" },
        { networkId: "base", version: "v1" },
      ],
    });

    expect(supported.kinds).toEqual([
      { x402Version: 2, scheme: "exact", network: BASE_MAINNET },
      { x402Version: 2, scheme: "exact", network: "eip155:84532" },
    ]);
  });

  it("derives canonical capabilities from XPay health metadata", () => {
    const supported = normalizeXPayHealthResponse({
      status: "ok",
      supportedNetworks: [BASE_MAINNET, "eip155:84532"],
      supportedVersions: [1, 2],
    });

    expect(supported?.kinds).toContainEqual({
      x402Version: 2,
      scheme: "exact",
      network: BASE_MAINNET,
    });
  });

  it("does not invent capabilities when health omits support metadata", () => {
    expect(normalizeXPayHealthResponse({ status: "ok" })).toBeNull();
  });
});
