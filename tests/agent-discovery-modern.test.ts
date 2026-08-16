import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "../apps/worker/src/agent-discovery-modern.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("modern agent discovery overlay", () => {
  it("advertises MCP, Bazaar, and safe migration endpoints in the agent card", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-card.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const card = (await response.json()) as {
      version: string;
      skills: Array<{ id: string }>;
      xguardDiscovery: Record<string, unknown>;
    };
    expect(card.version).toBe("0.4.0");
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["mcp-x402-discovery", "x402-safe-migration"]),
    );
    expect(card.xguardDiscovery).toMatchObject({
      mcp: `${ORIGIN}/mcp`,
      mcpManifest: `${ORIGIN}/.well-known/mcp/server.json`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      migration: `${ORIGIN}/.well-known/xguard/migrate`,
      preferredMcpProtocolVersion: "2026-07-28",
    });
  });

  it("advertises MCP, Bazaar, and migration endpoints in agent-market metadata", async () => {
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
      mcp: `${ORIGIN}/mcp`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      migration: `${ORIGIN}/.well-known/xguard/migrate`,
    });
  });

  it("publishes a current remote MCP manifest with migration discovery", () => {
    expect(modernMcpManifest(ORIGIN)).toMatchObject({
      name: "io.github.moelayyan90/xguard",
      version: "0.4.0",
      mcp: {
        preferredProtocolVersion: "2026-07-28",
        stateless: true,
      },
      remotes: [{ type: "streamable-http", url: `${ORIGIN}/mcp` }],
      discovery: {
        migration: `${ORIGIN}/.well-known/xguard/migrate`,
      },
    });
  });
});
