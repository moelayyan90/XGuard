import { describe, expect, it } from "vitest";
import {
  BASE_MAINNET,
  BASE_USDC,
  enforceBaseMainnetUsdc,
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
});
