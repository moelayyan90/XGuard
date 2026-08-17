import { describe, expect, it } from "vitest";
import {
  adaptCompatibilityResponse,
  augmentSupportedCompatibility,
  normalizeX402CompatibilityRequest,
  translateV1FacilitatorEnvelope,
} from "../apps/worker/src/x402-compatibility-bridge.js";

const ORIGIN = "https://xguardgate.com";
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NONCE = `0x${"11".repeat(32)}`;
const SIGNATURE = `0x${"22".repeat(65)}`;

function v1Envelope(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: {
        signature: SIGNATURE,
        authorization: {
          from: PAYER,
          to: PAY_TO,
          value: "10000",
          validAfter: "0",
          validBefore: "1999999999",
          nonce: NONCE,
        },
      },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "10000",
      resource: "https://merchant.example/paid",
      description: "Legacy paid resource",
      mimeType: "application/json",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      asset: USDC,
      extra: { name: "USD Coin", version: "2" },
    },
    ...overrides,
  };
}

describe("x402 compatibility bridge", () => {
  it("normalizes a Base x402 v1 facilitator envelope into canonical v2", () => {
    const translated = translateV1FacilitatorEnvelope(v1Envelope());
    expect(translated.x402Version).toBe(2);

    const payload = translated.paymentPayload as Record<string, unknown>;
    expect(payload.x402Version).toBe(2);
    expect(payload.resource).toEqual({
      url: "https://merchant.example/paid",
      description: "Legacy paid resource",
      mimeType: "application/json",
    });
    expect(payload.accepted).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    });
    expect(translated.paymentRequirements).toEqual(payload.accepted);
    expect(payload.payload).toEqual(
      (v1Envelope().paymentPayload as Record<string, unknown>).payload,
    );
  });

  it("rewrites the live facilitator request while preserving merchant authorization", async () => {
    const request = new Request(`${ORIGIN}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer xg_live_${"a".repeat(48)}`,
      },
      body: JSON.stringify(v1Envelope()),
    });
    const normalized = await normalizeX402CompatibilityRequest(request);
    expect(normalized).not.toBeNull();
    if (normalized === null) throw new Error("expected_compatibility_request");
    expect(normalized.clientVersion).toBe(1);
    expect(normalized.operation).toBe("/verify");
    expect(normalized.request.headers.get("authorization")).toBe(
      `Bearer xg_live_${"a".repeat(48)}`,
    );
    expect(normalized.request.headers.get("x-xguard-compatibility-input")).toBe(
      "x402-v1",
    );
    const normalizedBody = (await normalized.request.json()) as Record<
      string,
      unknown
    >;
    expect(normalizedBody.x402Version).toBe(2);
  });

  it("fails closed for legacy networks outside Base mainnet", () => {
    const envelope = v1Envelope();
    (envelope.paymentRequirements as Record<string, unknown>).network =
      "base-sepolia";
    expect(() => translateV1FacilitatorEnvelope(envelope)).toThrow(
      "v1_base_mainnet_required",
    );
  });

  it("fails closed for a non-USDC legacy asset", () => {
    const envelope = v1Envelope();
    (envelope.paymentRequirements as Record<string, unknown>).asset =
      "0x0000000000000000000000000000000000000001";
    expect(() => translateV1FacilitatorEnvelope(envelope)).toThrow(
      "v1_base_usdc_required",
    );
  });

  it("advertises both native v2 and bridged v1 when Base exact is healthy", async () => {
    const response = await augmentSupportedCompatibility(
      new Response(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
          extensions: ["bazaar"],
          signers: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const body = (await response.json()) as {
      kinds: Array<Record<string, unknown>>;
      compatibility: Record<string, unknown>;
    };
    expect(body.kinds).toContainEqual({
      x402Version: 1,
      scheme: "exact",
      network: "base",
    });
    expect(body.compatibility.mode).toBe("normalize-v1-to-v2");
  });

  it("maps a canonical settle response back to the v1 network identifier", async () => {
    const request = new Request(`${ORIGIN}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v1Envelope()),
    });
    const compatibility = await normalizeX402CompatibilityRequest(request);
    const response = await adaptCompatibilityResponse(
      new Response(
        JSON.stringify({
          success: true,
          payer: PAYER,
          transaction: `0x${"33".repeat(32)}`,
          network: "eip155:8453",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      compatibility,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.network).toBe("base");
    expect(response.headers.get("x-xguard-compatibility")).toBe(
      "x402-v1-to-v2",
    );
    expect(response.headers.get("x-xguard-canonical-network")).toBe(
      "eip155:8453",
    );
  });
});
