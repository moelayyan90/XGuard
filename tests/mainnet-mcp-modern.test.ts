import { describe, expect, it } from "vitest";
import {
  MODERN_MCP_PROTOCOL,
  modernMcpRequest,
  shouldUseModernMcp,
  xguardMcpTools,
} from "../apps/worker/src/mainnet-mcp-modern.js";

const URL = "https://xguardgate.com/mcp";
const ENV = { DB: {} as D1Database };

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  protocolVersion = MODERN_MCP_PROTOCOL,
) {
  const bodyParams = {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientInfo": {
        name: "xguard-test-client",
        version: "1.0.0",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
      ...(typeof params._meta === "object" && params._meta !== null
        ? params._meta
        : {}),
    },
  };
  return new Request(URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
      "Mcp-Method": method,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: bodyParams }),
  });
}

describe("MCP 2026-07-28 mainnet surface", () => {
  it("advertises the modern protocol through server/discover", async () => {
    const response = await modernMcpRequest(
      modernRequest("server/discover"),
      ENV,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Protocol-Version")).toBe(
      MODERN_MCP_PROTOCOL,
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    const body = (await response.json()) as { result: Record<string, unknown> };
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [
        "2026-07-28",
        "2025-11-25",
        "2025-06-18",
        "2025-03-26",
      ],
      capabilities: { tools: { listChanged: false } },
      ttlMs: 300000,
      cacheScope: "public",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "xguard-mainnet",
          version: "0.6.1",
        },
      },
    });
  });

  it("returns a deterministic cacheable modern tool list", async () => {
    const response = await modernMcpRequest(modernRequest("tools/list"), ENV);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        resultType: string;
        tools: Array<{ name: string }>;
        ttlMs: number;
        cacheScope: string;
      };
    };
    expect(body.result.resultType).toBe("complete");
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "xguard_payment_offer",
      "xguard_payment_decision",
      "xguard_discover",
      "xguard_resource_details",
      "xguard_status",
    ]);
    expect(body.result.ttlMs).toBe(300000);
    expect(body.result.cacheScope).toBe("public");
  });

  it("declares free/read-only and paid/economic MCP tools truthfully", () => {
    const tools = xguardMcpTools();
    expect(tools).toHaveLength(5);
    const offer = tools.find((tool) => tool.name === "xguard_payment_offer");
    expect(offer?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const decision = tools.find(
      (tool) => tool.name === "xguard_payment_decision",
    );
    expect(decision?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(decision?.description).toContain("idempotent ALLOW/REVIEW/BLOCK");
    expect(decision?.description).toContain("never executes the payment");
    expect(decision?.description).toContain("Example:");
    const readOnlyTools = tools.filter((tool) =>
      ["xguard_discover", "xguard_resource_details", "xguard_status"].includes(
        tool.name,
      ),
    );
    expect(readOnlyTools).toHaveLength(3);
    for (const tool of readOnlyTools) {
      expect(tool.description).toMatch(/Example:/);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const properties = tool.inputSchema.properties as Record<
        string,
        { description?: string }
      >;
      for (const property of Object.values(properties))
        expect(property.description?.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses the truthful status provider for the modern status tool", async () => {
    const request = modernRequest(
      "tools/call",
      { name: "xguard_status", arguments: {} },
      { "Mcp-Name": "xguard_status" },
    );
    const response = await modernMcpRequest(request, ENV, async () => ({
      gateway: "degraded",
      facilitator: "OPEN",
      marker: "truthful",
    }));
    const body = (await response.json()) as {
      result: { structuredContent: Record<string, unknown> };
    };
    expect(body.result.structuredContent).toMatchObject({
      gateway: "degraded",
      facilitator: "OPEN",
      marker: "truthful",
    });
  });

  it("rejects a method header/body mismatch with HeaderMismatch", async () => {
    const response = await modernMcpRequest(
      modernRequest("tools/list", {}, { "Mcp-Method": "ping" }),
      ENV,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });
  });

  it("requires Mcp-Name for modern tools/call", async () => {
    const response = await modernMcpRequest(
      modernRequest("tools/call", { name: "xguard_status", arguments: {} }),
      ENV,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });
  });

  it("returns UnsupportedProtocolVersion for an unknown modern-era version", async () => {
    const request = modernRequest("server/discover", {}, {}, "2027-01-01");
    expect(shouldUseModernMcp(request)).toBe(true);
    const response = await modernMcpRequest(request, ENV);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: -32022,
        data: { supportedVersions: expect.arrayContaining(["2026-07-28"]) },
      },
    });
  });

  it("returns HTTP 404 and JSON-RPC Method not found for unknown modern methods", async () => {
    const response = await modernMcpRequest(
      modernRequest("xguard/unknown"),
      ENV,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: -32601 } });
  });

  it("keeps 2025 protocol requests on the existing legacy implementation", () => {
    const legacy = modernRequest("tools/list", {}, {}, "2025-11-25");
    expect(shouldUseModernMcp(legacy)).toBe(false);
  });
});
