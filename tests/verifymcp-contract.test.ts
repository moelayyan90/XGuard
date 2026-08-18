import { describe, expect, it } from "vitest";
import { mcpOAuthChallengeResponse } from "../apps/worker/src/mcp-oauth-challenge.js";
import { xguardMcpTools } from "../apps/worker/src/mainnet-mcp-modern.js";

describe("VerifyMCP-facing MCP contract", () => {
  it("publishes RFC 9728 protected-resource discovery in the paid-tool challenge", async () => {
    const request = new Request("https://xguardgate.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "xguard_payment_decision", arguments: {} },
      }),
    });

    const response = await mcpOAuthChallengeResponse(request);
    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://xguardgate.com/.well-known/oauth-protected-resource"',
    );
    expect(response?.headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );
  });

  it("keeps every advertised tool concise, example-backed, and every named parameter described", () => {
    const tools = xguardMcpTools();
    expect(tools).toHaveLength(5);

    for (const tool of tools) {
      expect(tool.description.trim().length).toBeGreaterThan(20);
      expect(tool.description).toMatch(/Example:/i);

      const properties = tool.inputSchema.properties as Record<
        string,
        { description?: string }
      >;
      for (const [name, schema] of Object.entries(properties)) {
        expect(schema.description, `${tool.name}.${name}`).toBeTruthy();
      }
    }
  });
});
