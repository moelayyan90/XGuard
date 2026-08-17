import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";

const ORIGIN = "https://xguardgate.com";

describe("mainnet discovery", () => {
  it.each([
    ["/.well-known/agent-card.json", "application/json"],
    ["/.well-known/agent.json", "application/json"],
    ["/.well-known/agent-market.json", "application/json"],
    ["/.well-known/x402/facilitator.json", "application/json"],
    ["/.well-known/x402.json", "application/json"],
    ["/provider.json", "application/json"],
    ["/openapi.json", "application/json"],
    ["/llms.txt", "text/plain"],
    ["/llms-full.txt", "text/plain"],
    ["/robots.txt", "text/plain"],
  ])("serves %s", async (path, contentType) => {
    const response = discoveryResponse(new Request(`${ORIGIN}${path}`));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain(contentType);
    expect((await response?.text())?.length ?? 0).toBeGreaterThan(0);
  });

  it("publishes an agent card with x402 capabilities", async () => {
    const response = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`),
    );
    const card = (await response?.json()) as {
      name: string;
      providerManifest: string;
      supportedInterfaces: Array<{
        protocolBinding: string;
        protocolVersion: string;
      }>;
      skills: Array<{ id: string }>;
    };

    expect(card.name).toBe("XGuard");
    expect(card.providerManifest).toBe(
      `${ORIGIN}/.well-known/x402/facilitator.json`,
    );
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe("2");
    expect(card.supportedInterfaces[0]?.protocolBinding).toContain("x402");
    expect(card.skills.map((skill) => skill.id)).toContain(
      "x402-payment-settlement",
    );
  });

  it("publishes facilitator selection metadata without misrepresenting the downstream signer", async () => {
    const response = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/x402/facilitator.json`),
    );
    const provider = (await response?.json()) as {
      kind: string;
      status: string;
      facilitator: {
        baseUrl: string;
        supported: string;
        verify: string;
        settle: string;
        network: string;
        scheme: string;
        clientConfig: { type: string; url: string; authentication: string };
      };
      onboarding: {
        packageInstallationRequired: boolean;
        apiKeyRequiredForVerifyAndSettle: boolean;
      };
      pricing: { feeUsd: string; subscription: string };
      settlementExecution: {
        mode: string;
        currentDownstream: string;
        signerAttribution: string;
      };
    };

    expect(provider.kind).toBe("x402-facilitator");
    expect(provider.status).toBe("production");
    expect(provider.facilitator.baseUrl).toBe(ORIGIN);
    expect(provider.facilitator.supported).toBe(`${ORIGIN}/supported`);
    expect(provider.facilitator.verify).toBe(`${ORIGIN}/verify`);
    expect(provider.facilitator.settle).toBe(`${ORIGIN}/settle`);
    expect(provider.facilitator.network).toBe("eip155:8453");
    expect(provider.facilitator.scheme).toBe("exact");
    expect(provider.facilitator.clientConfig).toEqual({
      type: "HTTPFacilitatorClient",
      url: ORIGIN,
      authentication: "bearer",
    });
    expect(provider.onboarding.packageInstallationRequired).toBe(false);
    expect(provider.onboarding.apiKeyRequiredForVerifyAndSettle).toBe(true);
    expect(provider.pricing.feeUsd).toBe("0.002");
    expect(provider.pricing.subscription).toBe("none");
    expect(provider.settlementExecution.mode).toBe("routed");
    expect(provider.settlementExecution.currentDownstream).toBe("xpay");
    expect(provider.settlementExecution.signerAttribution).toContain(
      "/supported",
    );
  });

  it("supports conditional agent-card requests", () => {
    const first = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`),
    );
    const etag = first?.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`, {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(cached?.status).toBe(304);
  });

  it("supports conditional provider-manifest requests", () => {
    const first = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/x402/facilitator.json`),
    );
    const etag = first?.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/x402/facilitator.json`, {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(cached?.status).toBe(304);
  });

  it("serves HEAD without a body", async () => {
    const response = discoveryResponse(
      new Request(`${ORIGIN}/openapi.json`, { method: "HEAD" }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("");
  });

  it("does not intercept unrelated or mutating requests", () => {
    expect(discoveryResponse(new Request(`${ORIGIN}/status`))).toBeNull();
    expect(
      discoveryResponse(
        new Request(`${ORIGIN}/.well-known/agent-card.json`, {
          method: "POST",
        }),
      ),
    ).toBeNull();
  });
});
