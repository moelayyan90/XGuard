import { describe, expect, it, vi } from "vitest";
import { paymentLayerIndexResponse } from "../apps/worker/src/payment-layer-indexing.js";
import { publicDiscoveryPreflight } from "../apps/worker/src/public-discovery-preflight.js";
import { universalProtocolResponse } from "../apps/worker/src/universal-protocol-router.js";

const ORIGIN = "https://xguardgate.com";

function delegates() {
  return {
    verifyX402: vi.fn(async () => new Response(null, { status: 200 })),
    settleX402: vi.fn(async () => new Response(null, { status: 200 })),
  };
}

describe("AI crawler discovery chain", () => {
  it("publishes the Action Rail and payment manifest in the sitemap immediately after protocol discovery", async () => {
    const response = paymentLayerIndexResponse(
      new Request(`${ORIGIN}/sitemap.xml`),
    );
    expect(response?.status).toBe(200);
    const xml = await response?.text();

    const protocols = `${ORIGIN}/.well-known/xguard/protocols.json`;
    const actions = `${ORIGIN}/.well-known/xguard/actions.json`;
    const paymentManifest = `${ORIGIN}/.well-known/payment-manifest`;

    expect(xml).toContain(protocols);
    expect(xml).toContain(actions);
    expect(xml).toContain(paymentManifest);
    expect(xml!.indexOf(protocols)).toBeLessThan(xml!.indexOf(actions));
    expect(xml!.indexOf(actions)).toBeLessThan(xml!.indexOf(paymentManifest));
  });

  it("turns protocols.json into an explicit machine-readable continuation graph", async () => {
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/.well-known/xguard/protocols.json`),
      delegates(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("link")).toContain(
      "/.well-known/xguard/actions.json",
    );

    const body = (await response?.json()) as {
      discovery: Record<string, string>;
      crawlNext: string[];
    };
    expect(body.discovery.actionRail).toBe(
      `${ORIGIN}/.well-known/xguard/actions.json`,
    );
    expect(body.discovery.openapi).toBe(`${ORIGIN}/openapi.json`);
    expect(body.discovery.agentCard).toBe(
      `${ORIGIN}/.well-known/agent-card.json`,
    );
    expect(body.discovery.mcpServer).toBe(
      `${ORIGIN}/.well-known/mcp/server.json`,
    );
    expect(body.crawlNext).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/.well-known/xguard/actions.json`,
        `${ORIGIN}/openapi.json`,
        `${ORIGIN}/.well-known/agent-card.json`,
        `${ORIGIN}/.well-known/mcp/server.json`,
      ]),
    );
  });

  it("answers OPTIONS consistently across the newly advertised discovery surfaces", () => {
    for (const path of [
      "/.well-known/xguard/payment-layer.json",
      "/.well-known/xguard/protocols.json",
      "/.well-known/xguard/actions.json",
      "/.well-known/payment-manifest",
      "/.well-known/mcp/server.json",
      "/v1/protocols",
      "/v1/actions",
      "/v1/actions/capabilities",
      "/sitemap.xml",
    ]) {
      const response = publicDiscoveryPreflight(
        new Request(`${ORIGIN}${path}`, { method: "OPTIONS" }),
      );
      expect(response?.status, path).toBe(204);
      expect(response?.headers.get("access-control-allow-origin"), path).toBe(
        "*",
      );
    }
  });
});
