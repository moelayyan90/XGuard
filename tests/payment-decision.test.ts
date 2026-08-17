import { describe, expect, it } from "vitest";
import {
  evaluatePaymentIntent,
  normalizePaymentDecisionInput,
  paymentDecisionOffer,
} from "../apps/worker/src/payment-decision.js";

describe("buyer/agent payment decision", () => {
  it("keeps offer and skip non-billable", () => {
    const offer = paymentDecisionOffer({
      DB: null as unknown as D1Database,
      XGUARD_PAYMENT_DECISION_FEE_MICRO_USD: "1000",
    });
    expect(offer.billable).toBe(false);
    expect(offer.guarantees.showingOfferChargesFee).toBe(false);
    expect(offer.guarantees.skippingChargesFee).toBe(false);
    expect(offer.guarantees.completedAllowReviewOrBlockChargesFee).toBe(true);
  });

  it("allows a consistent declared payment with measurable evidence", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "agent:payment-001",
      channel: "agent",
      rail: "stripe",
      provider: "stripe",
      amount: "129.00",
      currency: "usd",
      payee: "acme.example",
      merchantOrigin: "https://acme.example",
      expectedAmount: "129",
      expectedPayee: "ACME.EXAMPLE",
    });
    const result = evaluatePaymentIntent(intent, false, Date.parse("2026-08-17T16:00:00Z"));
    expect(result.decision).toBe("ALLOW");
    expect(result.riskScore).toBe(0);
    expect(result.checks.every((check) => check.status === "PASS")).toBe(true);
  });

  it("blocks amount and destination tampering", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "browser:payment-002",
      channel: "browser",
      rail: "card",
      provider: "stripe",
      amount: "149.00",
      currency: "USD",
      payee: "attacker.example",
      merchantOrigin: "https://checkout.example",
      expectedAmount: "129.00",
      expectedPayee: "merchant.example",
    });
    const result = evaluatePaymentIntent(intent);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("expected_amount_mismatch");
    expect(result.reasonCodes).toContain("expected_payee_mismatch");
  });

  it("blocks expired or insecure payment intents", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "agent:payment-003",
      rail: "paypal",
      provider: "paypal",
      amount: "10",
      currency: "USD",
      payee: "merchant.example",
      merchantOrigin: "http://merchant.example",
      expiresAt: "2026-08-17T10:00:00Z",
    });
    const result = evaluatePaymentIntent(intent, false, Date.parse("2026-08-17T16:00:00Z"));
    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("insecure_payment_origin");
    expect(result.reasonCodes).toContain("payment_intent_expired");
  });

  it("reviews unknown rails instead of pretending full coverage", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "agent:payment-004",
      rail: "futurepay",
      provider: "futurepay",
      amount: "2.50",
      currency: "USD",
      payee: "merchant.example",
      merchantOrigin: "https://merchant.example",
    });
    const result = evaluatePaymentIntent(intent);
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("unrecognized_payment_rail");
  });

  it("blocks reuse of a reference already marked settled", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "agent:payment-005",
      rail: "bank_transfer",
      provider: "bank",
      amount: "50",
      currency: "JOD",
      payee: "merchant-account",
      paymentReference: "order-8810",
    });
    const result = evaluatePaymentIntent(intent, true);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("previously_settled_reference_reused");
  });

  it("refuses raw payment credentials at the API boundary", () => {
    expect(() =>
      normalizePaymentDecisionInput({
        requestId: "browser:payment-006",
        rail: "card",
        provider: "stripe",
        amount: "10",
        currency: "USD",
        payee: "merchant.example",
        cardNumber: "4111111111111111",
      }),
    ).toThrow("raw_payment_credentials_forbidden");
  });

  it("requires crypto network context for a complete x402 decision", () => {
    const intent = normalizePaymentDecisionInput({
      requestId: "agent:payment-007",
      rail: "x402",
      provider: "x402",
      amount: "0.01",
      currency: "USDC",
      payee: "0x1111111111111111111111111111111111111111",
    });
    const result = evaluatePaymentIntent(intent);
    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("network_not_declared");
  });
});
