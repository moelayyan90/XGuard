import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  translateV2PaymentRequiredToV1,
  x402HttpCompatibilityResponse,
} from "../apps/worker/src/x402-http-compatibility-bridge.js";

const ORIGIN = "https://xguardgate.com";
const TARGET = "https://merchant.example/paid";
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NONCE = `0x${"11".repeat(32)}`;
const SIGNATURE = `0x${"22".repeat(65)}`;

const allowEnv = {
  REQUEST_RATE_LIMITER: {
    limit: async () => ({ success: true }),
  },
};

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeBase64Json(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function v2Challenge(amount = "10000") {
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url: TARGET,
      description: "Modern paid resource",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount,
        asset: USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    extensions: { bazaar: { info: { discoverable: true } } },
  };
}

function v1Payment(amount = "10000") {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: SIGNATURE,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: amount,
        validAfter: "0",
        validBefore: "1999999999",
        nonce: NONCE,
      },
    },
  };
}

function bridgeRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    `${ORIGIN}/v1/x402/bridge?url=${encodeURIComponent(TARGET)}`,
    {
      method: "GET",
      headers: {
        "CF-Connecting-IP": "203.0.113.10",
        Accept: "application/json",
        ...headers,
      },
    },
  );
}

function challengeResponse(challenge = v2Challenge()): Response {
  return new Response("{}", {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": base64Json(challenge),
    },
  });
}

describe("x402 HTTP compatibility bridge", () => {
  it("translates a canonical Base v2 challenge into the legacy v1 402 body", () => {
    const translated = translateV2PaymentRequiredToV1(v2Challenge());
    expect(translated.x402Version).toBe(1);
    const accepts = translated.accepts as Array<Record<string, unknown>>;
    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toEqual({
      scheme: "exact",
      network: "base",
      maxAmountRequired: "10000",
      resource: TARGET,
      description: "Modern paid resource",
      mimeType: "application/json",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      asset: USDC,
      extra: { name: "USD Coin", version: "2" },
    });
  });

  it("returns a legacy 402 without proxying unpaid resource content", async () => {
    const upstream = async (request: Request) => {
      expect(request.url).toBe(TARGET);
      expect(request.headers.get("payment-signature")).toBeNull();
      return challengeResponse();
    };

    const response = await x402HttpCompatibilityResponse(
      bridgeRequest(),
      allowEnv,
      upstream,
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).not.toBeNull();
    expect(response.headers.get("x-xguard-compatibility")).toBe(
      "x402-v2-resource-to-v1-client",
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.x402Version).toBe(1);
  });

  it("preserves the EIP-3009 signature while translating X-PAYMENT to PAYMENT-SIGNATURE", async () => {
    let calls = 0;
    const upstream = async (request: Request) => {
      calls += 1;
      if (calls === 1) {
        expect(request.headers.get("payment-signature")).toBeNull();
        return challengeResponse();
      }

      const paymentHeader = request.headers.get("payment-signature");
      expect(paymentHeader).not.toBeNull();
      if (paymentHeader === null) throw new Error("missing_payment_signature");
      const canonical = decodeBase64Json(paymentHeader);
      expect(canonical.x402Version).toBe(2);
      const accepted = canonical.accepted as Record<string, unknown>;
      expect(accepted.network).toBe("eip155:8453");
      expect(accepted.amount).toBe("10000");
      const payload = canonical.payload as Record<string, unknown>;
      expect(payload.signature).toBe(SIGNATURE);
      expect(canonical.extensions).toEqual({
        bazaar: { info: { discoverable: true } },
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-RESPONSE": base64Json({
            success: true,
            transaction: `0x${"33".repeat(32)}`,
            network: "eip155:8453",
            payer: PAYER,
          }),
        },
      });
    };

    const response = await x402HttpCompatibilityResponse(
      bridgeRequest({ "X-PAYMENT": base64Json(v1Payment()) }),
      allowEnv,
      upstream,
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-xguard-compatibility")).toBe(
      "x402-v1-client-to-v2-resource",
    );
    const legacySettlement = response.headers.get("x-payment-response");
    expect(legacySettlement).not.toBeNull();
    if (legacySettlement === null) throw new Error("missing_legacy_settlement");
    expect(decodeBase64Json(legacySettlement).network).toBe("base");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("fails closed when the current v2 terms no longer match the legacy authorization", async () => {
    let calls = 0;
    const response = await x402HttpCompatibilityResponse(
      bridgeRequest({ "X-PAYMENT": base64Json(v1Payment("9000")) }),
      allowEnv,
      async () => {
        calls += 1;
        return challengeResponse(v2Challenge("10000"));
      },
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(response.status).toBe(409);
    expect(calls).toBe(1);
    expect(await response.json()).toEqual({
      error: "x_payment_does_not_match_current_v2_terms",
    });
  });

  it("refuses to become a generic content proxy for non-x402 targets", async () => {
    const response = await x402HttpCompatibilityResponse(
      bridgeRequest(),
      allowEnv,
      async () => new Response("private upstream content", { status: 200 }),
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("target_is_not_x402_v2");
    expect(JSON.stringify(body)).not.toContain("private upstream content");
  });

  it("rejects local and private targets before any outbound request", async () => {
    let called = false;
    const request = new Request(
      `${ORIGIN}/v1/x402/bridge?url=${encodeURIComponent("https://127.0.0.1/paid")}`,
      {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      },
    );
    const response = await x402HttpCompatibilityResponse(
      request,
      allowEnv,
      async () => {
        called = true;
        return challengeResponse();
      },
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(response.status).toBe(400);
    expect(called).toBe(false);
    expect(await response.json()).toEqual({ error: "private_target_rejected" });
  });

  it("rate limits the public bridge before probing the target", async () => {
    let called = false;
    const response = await x402HttpCompatibilityResponse(
      bridgeRequest(),
      {
        REQUEST_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
      },
      async () => {
        called = true;
        return challengeResponse();
      },
    );
    expect(response).not.toBeNull();
    if (response === null) throw new Error("expected_bridge_response");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(called).toBe(false);
  });
});
