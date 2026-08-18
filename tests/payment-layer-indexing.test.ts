import { describe, expect, it } from "vitest";
import { paymentLayerIndexResponse } from "../apps/worker/src/payment-layer-indexing.js";

const ORIGIN = "https://xguardgate.com";

describe("Payment Layer-first indexing", () => {
  it("puts universal Payment Layer surfaces in the sitemap before protocol adapters", async () => {
    const response = paymentLayerIndexResponse(
      new Request(`${ORIGIN}/sitemap.xml`),
    );
    const xml = await response?.text();

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain(`${ORIGIN}/payment-layer`);
    expect(xml).toContain(`${ORIGIN}/install`);
    expect(xml).toContain(`${ORIGIN}/.well-known/xguard/payment-layer.json`);
    expect(xml).toContain(`${ORIGIN}/.well-known/xguard/protocols.json`);
    expect(xml).toContain(`${ORIGIN}/.well-known/x402/facilitator.json`);
    expect(xml.indexOf(`${ORIGIN}/payment-layer`)).toBeLessThan(
      xml.indexOf(`${ORIGIN}/.well-known/x402/facilitator.json`),
    );
  });

  it("advertises Payment Layer discovery first in robots.txt", async () => {
    const response = paymentLayerIndexResponse(
      new Request(`${ORIGIN}/robots.txt`),
    );
    const robots = await response?.text();

    expect(response?.status).toBe(200);
    expect(robots).toContain("# Primary XGuard Payment Layer");
    expect(robots).toContain(`${ORIGIN}/payment-layer`);
    expect(robots).toContain(`${ORIGIN}/.well-known/xguard/payment-layer.json`);
    expect(robots).toContain("# Protocol-specific adapter");
    expect(robots).toContain(`${ORIGIN}/.well-known/x402/facilitator.json`);
    expect(robots.indexOf("# Primary XGuard Payment Layer")).toBeLessThan(
      robots.indexOf("# Protocol-specific adapter"),
    );
  });

  it("does not intercept unrelated or mutating requests", async () => {
    expect(
      paymentLayerIndexResponse(
        new Request(`${ORIGIN}/sitemap.xml`, { method: "POST" }),
      ),
    ).toBeNull();
    expect(paymentLayerIndexResponse(new Request(`${ORIGIN}/docs`))).toBeNull();

    const head = paymentLayerIndexResponse(
      new Request(`${ORIGIN}/robots.txt`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
  });
});
