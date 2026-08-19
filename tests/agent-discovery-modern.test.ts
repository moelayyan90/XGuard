import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "../apps/worker/src/agent-discovery-modern.js";

const ORIGIN = "https://xguardgate.com";

function expectSettlementTruthDiscovery(value: Record<string, unknown>) {
  expect(value).toMatchObject({
    settlementTruth: `${ORIGIN}/v1/settlements/{logicalPaymentKey}/truth`,
    settlementResolve: `${ORIGIN}/v1/settlements/{logicalPaymentKey}/resolve`,
  });
}

function expectPaymentDecisionDiscovery(value: Record<string, unknown>) {
  expect(value).toMatchObject({
    paymentOffer: `${ORIGIN}/v1/payment/offer`,
    paymentDecision: `${ORIGIN}/v1/payment/decision`,
    paymentRecord: `${ORIGIN}/v1/payment/records/{decisionId}`,
    paymentSettlementUpdate: `${ORIGIN}/v1/payment/records/{decisionId}/settlement`,
    paymentSecurityEvidence: `${ORIGIN}/.well-known/xguard-security-evidence.json`,
  });
}

describe("modern agent discovery overlay", () => {
  it("advertises pre-payment decision, MCP, Bazaar, migration, and settlement truth in the agent card", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-card.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const card = (await response.json()) as {
      version: string;
      skills: Array<{ id: string }>;
      xguardDiscovery: Record<string, unknown>;
    };
    expect(card.version).toBe("0.6.2");
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        "xguard-payment-decision",
        "mcp-x402-discovery",
        "x402-safe-migration",
        "x402-settlement-truth",
      ]),
    );
    expect(card.xguardDiscovery).toMatchObject({
      mcp: `${ORIGIN}/mcp`,
      mcpManifest: `${ORIGIN}/.well-known/mcp/server.json`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      migration: `${ORIGIN}/.well-known/xguard/migrate`,
      preferredMcpProtocolVersion: "2026-07-28",
    });
    expectPaymentDecisionDiscovery(card.xguardDiscovery);
    expectSettlementTruthDiscovery(card.xguardDiscovery);
  });

  it("advertises payment decision and settlement truth in agent-market metadata", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-market.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const market = (await response.json()) as {
      version: string;
      discovery: Record<string, unknown>;
    };
    expect(market.version).toBe("0.6.2");
    expect(market.discovery).toMatchObject({
      mcp: `${ORIGIN}/mcp`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      migration: `${ORIGIN}/.well-known/xguard/migrate`,
    });
    expectPaymentDecisionDiscovery(market.discovery);
    expectSettlementTruthDiscovery(market.discovery);
  });

  it("publishes payment decision and settlement truth templates in the remote MCP manifest", () => {
    const manifest = modernMcpManifest(ORIGIN);
    expect(manifest).toMatchObject({
      name: "io.github.moelayyan90/xguard",
      version: "0.6.2",
      role: "buyer-agent-pre-payment-decision",
      protocol: "universal-payment-intent",
      settlementAdapters: ["x402-v2"],
      mcp: {
        preferredProtocolVersion: "2026-07-28",
        stateless: true,
      },
      remotes: [{ type: "streamable-http", url: `${ORIGIN}/mcp` }],
      discovery: {
        paymentOffer: `${ORIGIN}/v1/payment/offer`,
        paymentDecision: `${ORIGIN}/v1/payment/decision`,
        paymentSecurityEvidence: `${ORIGIN}/.well-known/xguard-security-evidence.json`,
        migration: `${ORIGIN}/.well-known/xguard/migrate`,
      },
    });
    expectPaymentDecisionDiscovery(manifest.discovery);
    expectSettlementTruthDiscovery(manifest.discovery);
  });

  it("publishes payment decision records and merchant settlement truth in live OpenAPI discovery", async () => {
    const request = new Request(`${ORIGIN}/openapi.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const document = (await response.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };

    expect(document.paths).toHaveProperty("/v1/payment/offer");
    expect(document.paths).toHaveProperty("/v1/payment/decision");
    expect(document.paths).toHaveProperty("/v1/payment/records/{decisionId}");
    expect(document.paths).toHaveProperty(
      "/v1/payment/records/{decisionId}/settlement",
    );
    expect(document.paths).toHaveProperty(
      "/v1/settlements/{logicalPaymentKey}/truth",
    );
    expect(document.paths).toHaveProperty(
      "/v1/settlements/{logicalPaymentKey}/resolve",
    );
    expect(
      document.paths["/v1/settlements/{logicalPaymentKey}/truth"],
    ).toHaveProperty("get");
    expect(
      document.paths["/v1/settlements/{logicalPaymentKey}/resolve"],
    ).toHaveProperty("post");
  });

  it("teaches LLM discovery clients to offer XGuard before external payment", async () => {
    const request = new Request(`${ORIGIN}/llms.txt`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const text = await response.text();

    expect(text).toContain(`${ORIGIN}/v1/payment/offer`);
    expect(text).toContain(`${ORIGIN}/v1/payment/decision`);
    expect(text).toContain("offer xguard_payment_offer first");
    expect(text).toContain(
      `${ORIGIN}/v1/settlements/<logicalPaymentKey>/truth`,
    );
    expect(text).toContain("FINALIZED, PENDING, PROVEN_FAILED, and CONFLICT");
    expect(text).toContain(
      "never blindly resubmits an ambiguous authorization",
    );
  });
});
