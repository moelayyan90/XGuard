import { describe, expect, it, vi } from "vitest";
import {
  createXGuardHostedPaymentAuthorizer,
  type XGuardHostedPaymentReceipt,
} from "../packages/sdk/src/hosted-auto-pay.js";
import type { XGuardAutomatedPaymentIntent } from "../packages/sdk/src/auto-pay.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function intent(
  overrides: Partial<XGuardAutomatedPaymentIntent> = {},
): XGuardAutomatedPaymentIntent {
  return {
    x402Version: 2,
    resourceUrl: "https://merchant.example/paid-api",
    serviceName: "Merchant API",
    scheme: "exact",
    network: "eip155:8453",
    asset: BASE_USDC,
    amountAtomic: "1250000",
    payTo: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}

const asset = {
  network: "eip155:8453",
  asset: BASE_USDC,
  currency: "USDC",
  decimals: 6,
};

const token = "xg_pass_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";

describe("XGuard hosted automated payment authorizer", () => {
  it("sends an agent payment decision before signing and converts atomic units exactly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.channel).toBe("agent");
      expect(body.rail).toBe("x402");
      expect(body.provider).toBe("x402");
      expect(body.amount).toBe("1.25");
      expect(body.currency).toBe("USDC");
      expect(body.network).toBe("eip155:8453");
      expect(body.asset).toBe(BASE_USDC);
      expect(body.payee).toBe("0x1111111111111111111111111111111111111111");
      expect(body.merchantOrigin).toBe("https://merchant.example");
      expect(String(body.requestId)).toMatch(/^agent:/);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      return new Response(
        JSON.stringify({
          decisionId: "pd_11111111111111111111111111111111",
          decision: "ALLOW",
          reasonCodes: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const authorize = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: fetchMock,
    });

    await expect(authorize(intent())).resolves.toEqual({ allow: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://xguardgate.com/v1/payment/decision",
    );
  });

  it("blocks REVIEW by default and can deliberately allow it", async () => {
    const response = () =>
      new Response(
        JSON.stringify({
          decision: "REVIEW",
          reasonCodes: ["network_not_declared"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const blocked = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: vi.fn<typeof fetch>(async () => response()),
    });
    await expect(blocked(intent())).resolves.toEqual({
      allow: false,
      reason: "XGuard requires review: network_not_declared",
    });

    const allowed = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      allowReview: true,
      fetch: vi.fn<typeof fetch>(async () => response()),
    });
    await expect(allowed(intent())).resolves.toEqual({
      allow: true,
      reason: "XGuard returned REVIEW: network_not_declared",
    });
  });

  it("blocks BLOCK receipts and preserves reason codes", async () => {
    const authorize = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              decision: "BLOCK",
              reasonCodes: [
                "expected_payee_mismatch",
                "payment_intent_expired",
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    });
    await expect(authorize(intent())).resolves.toEqual({
      allow: false,
      reason:
        "XGuard blocked automated payment: expected_payee_mismatch, payment_intent_expired",
    });
  });

  it("fails closed on XGuard balance or credential errors", async () => {
    const insufficient = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ error: "insufficient_xguard_balance" }),
            {
              status: 402,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    });
    await expect(insufficient(intent())).rejects.toThrow(
      /balance is insufficient/i,
    );

    const unauthorized = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ error: "xguard_access_key_required" }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    });
    await expect(unauthorized(intent())).rejects.toThrow(
      /token is invalid or expired/i,
    );
  });

  it("does not call the hosted service for unknown asset metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const authorize = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: fetchMock,
    });
    await expect(
      authorize(
        intent({ asset: "0x2222222222222222222222222222222222222222" }),
      ),
    ).resolves.toEqual({
      allow: false,
      reason:
        "XGuard hosted authorization has no asset metadata for this payment",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches EVM asset addresses case-insensitively and supports logical payment references", async () => {
    let receiptSeen: XGuardHostedPaymentReceipt | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.paymentReference).toBe("order:12345678");
      return new Response(
        JSON.stringify({
          decision: "ALLOW",
          decisionId: "pd_22222222222222222222222222222222",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const authorize = createXGuardHostedPaymentAuthorizer({
      accessToken: token,
      assets: [asset],
      fetch: fetchMock,
      paymentReference: () => "order:12345678",
      onReceipt: (receipt) => {
        receiptSeen = receipt;
      },
    });
    await expect(
      authorize(intent({ asset: BASE_USDC.toLowerCase() })),
    ).resolves.toEqual({ allow: true });
    expect(receiptSeen?.decisionId).toBe("pd_22222222222222222222222222222222");
  });

  it("validates gateway, credentials, and asset definitions before use", () => {
    expect(() =>
      createXGuardHostedPaymentAuthorizer({
        gateway: "http://example.com",
        accessToken: token,
        assets: [asset],
      }),
    ).toThrow(/must use HTTPS/i);
    expect(() =>
      createXGuardHostedPaymentAuthorizer({
        accessToken: "short",
        assets: [asset],
      }),
    ).toThrow(/accessToken is invalid/i);
    expect(() =>
      createXGuardHostedPaymentAuthorizer({
        accessToken: token,
        assets: [{ ...asset, decimals: 31 }],
      }),
    ).toThrow(/decimals/i);
  });
});
