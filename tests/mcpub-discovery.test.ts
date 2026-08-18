import { describe, expect, it } from "vitest";
import { mcpubDiscoveryResponse } from "../apps/worker/src/mcpub-discovery.js";
import { XGUARD_MCP_VERSION } from "../apps/worker/src/mainnet-mcp-modern.js";

const ORIGIN = "https://xguardgate.com";

describe("mcpub discovery alias", () => {
  it("serves /.well-known/mcp.json with the live payment-tool identity", async () => {
    const response = mcpubDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/mcp.json`),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    const body = (await response?.json()) as {
      name: string;
      description: string;
      version: string;
      mcp: string;
      registryName: string;
      capabilities: {
        paymentIntent: boolean;
        paymentOffer: string;
        paymentDecision: string;
        x402Discovery: string;
        resourceDetails: string;
        status: string;
        externalPaymentExecution: boolean;
      };
    };
    expect(body.name).toBe("XGuard");
    expect(body.version).toBe(XGUARD_MCP_VERSION);
    expect(body.description.toLowerCase()).toContain("payment");
    expect(body.mcp).toBe(`${ORIGIN}/mcp`);
    expect(body.registryName).toBe("io.github.moelayyan90/xguard");
    expect(body.capabilities).toEqual({
      paymentIntent: true,
      paymentOffer: "xguard_payment_offer",
      paymentDecision: "xguard_payment_decision",
      x402Discovery: "xguard_discover",
      resourceDetails: "xguard_resource_details",
      status: "xguard_status",
      externalPaymentExecution: false,
    });
  });

  it("supports HEAD and ignores unrelated requests", async () => {
    const head = mcpubDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/mcp.json`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
    expect(mcpubDiscoveryResponse(new Request(`${ORIGIN}/status`))).toBeNull();
    expect(
      mcpubDiscoveryResponse(
        new Request(`${ORIGIN}/.well-known/mcp.json`, { method: "POST" }),
      ),
    ).toBeNull();
  });
});
