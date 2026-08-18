import { describe, expect, it } from "vitest";
import { compatibilityDiscoveryResponse } from "../apps/worker/src/discovery-compat.js";
import { discoveryResponse } from "../apps/worker/src/discovery.js";
import {
  XGUARD_ATTEMPT_BILLING,
  XGUARD_ATTEMPT_EVENT,
  XGUARD_ATTEMPT_FEE_USD,
} from "../apps/worker/src/public-payment-contract.js";

const ORIGIN = "https://xguardgate.com";

describe("mainnet discovery compatibility", () => {
  it("serves the x402 provider alias", async () => {
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

  it("serves Glama remote connector ownership metadata", async () => {
    const response = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/glama.json`),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(await response?.json()).toEqual({
      $schema: "https://glama.ai/mcp/schemas/connector.json",
      maintainers: [{ email: "mo.elayyan2023@gmail.com" }],
    });

    const head = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/glama.json`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");

    const etag = head?.headers.get("etag");
    expect(etag).toBeTruthy();
    const cached = await compatibilityDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/glama.json`, {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(cached?.status).toBe(304);
  });

  it("serves monetization metadata", async () => {
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
      event: XGUARD_ATTEMPT_EVENT,
      feeUsd: XGUARD_ATTEMPT_FEE_USD,
      billing: XGUARD_ATTEMPT_BILLING,
    });
    expect(body.x402).toEqual({
      providerManifest: `${ORIGIN}/.well-known/x402/facilitator.json`,
      discovery: `${ORIGIN}/.well-known/x402`,
      supported: `${ORIGIN}/supported`,
      verify: `${ORIGIN}/verify`,
      settle: `${ORIGIN}/settle`,
    });
  });

  it("supports HEAD and conditional requests", async () => {
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

  it("does not intercept unrelated requests", async () => {
    expect(
      await compatibilityDiscoveryResponse(new Request(`${ORIGIN}/status`)),
    ).toBeNull();
    expect(
      await compatibilityDiscoveryResponse(
        new Request(`${ORIGIN}/.well-known/x402`, { method: "POST" }),
      ),
    ).toBeNull();
    expect(
      await compatibilityDiscoveryResponse(
        new Request(`${ORIGIN}/.well-known/glama.json`, { method: "POST" }),
      ),
    ).toBeNull();
  });
});
