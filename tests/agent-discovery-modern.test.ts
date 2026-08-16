import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "../apps/worker/src/agent-discovery-modern.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("modern agent discovery overlay", () => {
  it("publishes a real dual-version A2A JSON-RPC interface alongside MCP discovery", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-card.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const card = (await response.json()) as {
      version: string;
      url: string;
      protocolVersion: string;
      preferredTransport: string;
      supportedInterfaces: Array<{
        url: string;
        protocolBinding: string;
        protocolVersion: string;
      }>;
      additionalInterfaces: Array<{ url: string; transport: string }>;
      defaultInputModes: string[];
      defaultOutputModes: string[];
      skills: Array<{ id: string }>;
      xguardDiscovery: Record<string, unknown>;
    };
    expect(card.version).toBe("0.4.0");
    expect(card.url).toBe(`${ORIGIN}/a2a`);
    expect(card.protocolVersion).toBe("0.3");
    expect(card.preferredTransport).toBe("JSONRPC");
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
    expect(card.additionalInterfaces).toEqual([
      { url: `${ORIGIN}/a2a`, transport: "JSONRPC" },
    ]);
    expect(card.defaultInputModes).toEqual(["text/plain"]);
    expect(card.defaultOutputModes).toEqual(["text/plain"]);
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        "mcp-x402-discovery",
        "a2a-xguard-discovery",
        "x402-payment-settlement",
      ]),
    );
    expect(card.xguardDiscovery).toMatchObject({
      a2a: `${ORIGIN}/a2a`,
      a2aProtocolVersions: ["1.0", "0.3"],
      a2aExecutionScope: "discovery-only",
      mcp: `${ORIGIN}/mcp`,
      mcpManifest: `${ORIGIN}/.well-known/mcp/server.json`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
      preferredMcpProtocolVersion: "2026-07-28",
    });
  });

  it("keeps the legacy agent.json alias A2A-compatible", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    expect(await response.json()).toMatchObject({
      url: `${ORIGIN}/a2a`,
      preferredTransport: "JSONRPC",
      protocolVersion: "0.3",
    });
  });

  it("advertises MCP, A2A, and Bazaar endpoints in agent-market metadata", async () => {
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
      a2aProtocolVersions: ["1.0", "0.3"],
      mcp: `${ORIGIN}/mcp`,
      resources: `${ORIGIN}/discovery/resources`,
      search: `${ORIGIN}/discovery/search`,
    });
  });

  it("adds A2A and MCP to the OpenAPI discovery surface", async () => {
    const request = new Request(`${ORIGIN}/openapi.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();
    const response = await enhanceAgentDiscoveryResponse(request, base!);
    const document = (await response.json()) as {
      paths: Record<string, unknown>;
    };
    expect(document.paths).toHaveProperty("/a2a");
    expect(document.paths).toHaveProperty("/mcp");
    expect(document.paths).toHaveProperty("/discovery/resources");
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
