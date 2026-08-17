import { describe, expect, it } from "vitest";
import {
  forwardHeaders,
  normalizeProvider,
} from "../apps/worker/src/universal-webhook-ingress.js";

describe("universal webhook ingress", () => {
  it("accepts arbitrary bounded provider identifiers instead of an x402-only allowlist", () => {
    for (const provider of [
      "stripe",
      "paypal",
      "square",
      "adyen",
      "shopify",
      "woocommerce",
      "coinbase-commerce",
      "paddle",
      "lemonsqueezy",
      "custom-bank-gateway",
      "my.private.saas",
    ]) {
      expect(normalizeProvider(provider)).toBe(provider);
    }
  });

  it("rejects malformed provider identifiers", () => {
    expect(normalizeProvider("")).toBeNull();
    expect(normalizeProvider("../stripe")).toBeNull();
    expect(normalizeProvider("stripe/payments")).toBeNull();
    expect(normalizeProvider("a".repeat(65))).toBeNull();
    expect(normalizeProvider(402)).toBeNull();
  });

  it("preserves provider signature evidence while removing hop-by-hop and XGuard control headers", () => {
    const input = new Headers({
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=signature",
      authorization: "Bearer provider-webhook-token",
      "x-shopify-hmac-sha256": "shopify-signature",
      "x-xguard-provider": "forged-provider",
      "cf-ray": "forged-ray",
      connection: "keep-alive",
      "x-forwarded-for": "127.0.0.1",
    });

    const forwarded = forwardHeaders(input);
    expect(forwarded.get("content-type")).toBe("application/json");
    expect(forwarded.get("stripe-signature")).toBe("t=1,v1=signature");
    expect(forwarded.get("authorization")).toBe(
      "Bearer provider-webhook-token",
    );
    expect(forwarded.get("x-shopify-hmac-sha256")).toBe("shopify-signature");
    expect(forwarded.get("x-xguard-provider")).toBeNull();
    expect(forwarded.get("cf-ray")).toBeNull();
    expect(forwarded.get("connection")).toBeNull();
    expect(forwarded.get("x-forwarded-for")).toBeNull();
  });
});
