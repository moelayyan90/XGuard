import { describe, expect, it } from "vitest";
import { compatibilityDiscoveryResponse } from "../apps/worker/src/discovery-compat.js";
import { discoveryResponse } from "../apps/worker/src/discovery.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("mainnet discovery compatibility", () => {
  it("serves /.well-known/x402 as the canonical provider manifest", async () => {
    const alias = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/x402`),
    );
    const canonical = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/x402/facilitator.json`),
    );

    expect(alias?.status).toBe(200);
    expect(alias?.headers.get("content-type")).toContain("application/json");
    expect(await alias?.json()).toEqual(await canonical?.json());
  });

  it("serves machine-readable monetization metadata from canonical XGuard pricing", async () => {
    const response = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/monetization`),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");

    const body = (await response?.json()) as {
      manifest: string;
      pricing: {
        subscription: string;
        event: string;
        feeUsd: string;
        billing: string;
      };
      x402: {
        providerManifest: string;
        discovery: string;
        supported: string;
        verify: string;
        settle: string;
      };
    };

    expect(body.manifest).toBe("xguard-monetization-v1");
    expect(body.pricing).toMatchObject({
      subscription: "none",
      event: "successful_billable_settlement",
      feeUsd: "0.002",
      billing: "merchant_prepaid_service_balance",
    });
    expect(body.x402).toEqual({
      providerManifest: `${ORIGIN}/.well-known/x402/facilitator.json`,
      discovery: `${ORIGIN}/.well-known/x402`,
      supported: `${ORIGIN}/supported`,
      verify: `${ORIGIN}/verify`,
      settle: `${ORIGIN}/settle`,
    });
  });

  it("supports HEAD and conditional monetization discovery", async () => {
    const head = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/monetization`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");

    const etag = head?.headers.get("etag");
    expect(etag).toBeTruthy();
    const cached = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/monetization`, {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(cached?.status).toBe(304);
  });

  it("does not intercept unrelated or mutating requests", async () => {
    expect(
      await compatibilityDiscoveryResponse(new Request(`${ORIGIN}/status`)),
    ).toBeNull();
    expect(
      await compatibilityDiscoveryResponse(
        new Request(`${ORIGIN}/.well-known/x402`, { method: "POST" }),
      ),
    ).toBeNull();
  });
});
