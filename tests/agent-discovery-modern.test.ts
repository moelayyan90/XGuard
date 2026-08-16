import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "../apps/worker/src/agent-discovery-modern.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("modern agent discovery overlay", () => {
  it("advertises A2A JSON-RPC, MCP 2026, and Bazaar endpoints in the agent card", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-card.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const card = (await response.json()) as {
      version: string;
      supportedInterfaces: Array<{
        url: string;
        protocolBinding: string;
        protocolVersion: string;
      }>;
      provider: { organization: string; url: string };
      skills: Array<{ id: string }>;
      xguardDiscovery: Record<string, unknown>;
      preferredTransport: string;
      url: string;
    };
    expect(card.version).toBe("0.4.0");
    expect(card.supportedInterfaces).toEqual([
      {
        url: `${ORIGIN}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
      {
        url: `${ORIGIN}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3",
      },
    ]);
    expect(card.provider).toEqual({
      organization: "XGuard",
      url: "https://github.com/moelayyan90/XGuard",
    });
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.url).toBe(`${ORIGIN}/a2a`);
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["mcp-x402-discovery", "a2a-x402-gateway"]),
    );
    expect(card.xguardDiscovery).toMatchObject({
      a2a: `${ORIGIN}/a2a`,
      mcp: `${ORIGIN}/mcp`,
      mcpManifest: `${ORIGIN}/.well-known/mcp/server.json`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      preferredA2AProtocolVersion: "1.0",
      preferredMcpProtocolVersion: "2026-07-28",
    });
  });

  it("keeps the legacy agent.json alias A2A-compatible", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const card = (await response.json()) as any;
    expect(card.supportedInterfaces[0]).toEqual({
      url: `${ORIGIN}/a2a`,
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card.additionalInterfaces).toContainEqual({
      url: `${ORIGIN}/a2a`,
      transport: "JSONRPC",
    });
  });

  it("advertises A2A, MCP and Bazaar endpoints in agent-market metadata", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-market.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const market = (await response.json()) as {
      version: string;
      discovery: Record<string, unknown>;
    };
    expect(market.version).toBe("0.4.0");
    expect(market.discovery).toMatchObject({
      a2a: `${ORIGIN}/a2a`,
      mcp: `${ORIGIN}/mcp`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      preferredA2AProtocolVersion: "1.0",
    });
  });

  it("publishes a current remote MCP manifest", () => {
    expect(modernMcpManifest(ORIGIN)).toMatchObject({
      name: "io.github.moelayyan90/xguard",
      version: "0.4.0",
      mcp: {
        preferredProtocolVersion: "2026-07-28",
        stateless: true,
      },
      remotes: [{ type: "streamable-http", url: `${ORIGIN}/mcp` }],
    });
  });
});
