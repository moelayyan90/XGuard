import { describe, expect, it } from "vitest";
import {
  normalizePublicPaymentContract,
  publicPaymentContractResponse,
} from "../apps/worker/src/public-payment-contract.js";

describe("public payment contract", () => {
  it("gives robots one canonical 0.04 payment manifest", async () => {
    const request = new Request(
      "https://xguardgate.com/.well-known/payment-manifest",
      { headers: { accept: "application/json" } },
    );
    const response = publicPaymentContractResponse(request, {
      XGUARD_TREASURY_USDC_ADDRESS:
        "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    });

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as Record<string, any>;
    expect(body.pricing.amountUsd).toBe("0.04");
    expect(body.pricing.amountMicroUsd).toBe(40_000);
    expect(body.pricing.event).toBe(
      "accepted_authenticated_economic_attempt",
    );
    expect(body.onboarding.human).toBe("https://xguardgate.com/pay");
    expect(body.execution.verify).toBe("https://xguardgate.com/verify");
    expect(body.execution.settle).toBe("https://xguardgate.com/settle");
  });

  it("gives humans a simple payment page", async () => {
    const request = new Request("https://xguardgate.com/pay", {
      headers: { accept: "text/html" },
    });
    const response = publicPaymentContractResponse(request, {});
    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain("$0.04");
    expect(html).toContain("/.well-known/payment-manifest");
    expect(html).toContain("/v1/register");
  });

  it("rewrites stale public x402 pricing before it leaves XGuard", async () => {
    const request = new Request(
      "https://xguardgate.com/.well-known/x402/facilitator.json",
    );
    const stale = new Response(
      JSON.stringify({
        pricing: {
          feeUsd: "0.002",
          event: "successful_billable_settlement",
        },
      }),
      { headers: { "content-type": "application/json" } },
    );

    const response = await normalizePublicPaymentContract(request, stale);
    const body = (await response.json()) as Record<string, any>;
    expect(body.pricing.feeUsd).toBe("0.04");
    expect(body.pricing.event).toBe(
      "accepted_authenticated_economic_attempt",
    );
  });
});
