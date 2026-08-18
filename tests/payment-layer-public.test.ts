import { describe, expect, it } from "vitest";
import { paymentLayerPublicResponse } from "../apps/worker/src/payment-layer-public.js";

const ORIGIN = "https://xguardgate.com";

describe("universal payment-layer public surface", () => {
  it("makes the universal payment layer the root machine identity", async () => {
    const response = paymentLayerPublicResponse(new Request(`${ORIGIN}/`));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");

    const body = (await response?.json()) as {
      name: string;
      product: string;
      merchantIntegrationRequiredForBrowserLayer: boolean;
      capabilities: string[];
      adapters: string[];
      x402Role: string;
    };

    expect(body.name).toBe("XGuard Payment Layer");
    expect(body.product).toBe("universal-payment-control-layer");
    expect(body.merchantIntegrationRequiredForBrowserLayer).toBe(false);
    expect(body.capabilities).toContain("pay-all-bills");
    expect(body.capabilities).toContain("saved-payee-memory");
    expect(body.adapters).toContain("x402");
    expect(body.adapters).toContain("browser-payment-surface");
    expect(body.x402Role).toContain("not-product-boundary");
  });

  it("makes browser payment control the primary human-facing product", async () => {
    const response = paymentLayerPublicResponse(
      new Request(`${ORIGIN}/`, { headers: { Accept: "text/html" } }),
    );
    const html = await response?.text();

    expect(response?.status).toBe(200);
    expect(html).toContain("One payment layer");
    expect(html).toContain("Wherever the payment happens");
    expect(html).toContain("ترحيل لغايات الدفع");
    expect(html).toContain("دفع كل الفواتير");
    expect(html).toContain("Saved payees");
    expect(html).toContain("x402 is one integration path, not the boundary");
  });

  it("publishes a dedicated payment-layer manifest and install surface", async () => {
    const manifest = paymentLayerPublicResponse(
      new Request(`${ORIGIN}/.well-known/xguard/payment-layer.json`),
    );
    const install = paymentLayerPublicResponse(
      new Request(`${ORIGIN}/install`, { headers: { Accept: "text/html" } }),
    );

    expect(manifest?.status).toBe(200);
    expect(manifest?.headers.get("access-control-allow-origin")).toBe("*");
    expect(await install?.text()).toContain("Download ZIP");
  });

  it("does not intercept mutating or unrelated routes", () => {
    expect(
      paymentLayerPublicResponse(new Request(`${ORIGIN}/`, { method: "POST" })),
    ).toBeNull();
    expect(
      paymentLayerPublicResponse(new Request(`${ORIGIN}/status`)),
    ).toBeNull();
  });
});
