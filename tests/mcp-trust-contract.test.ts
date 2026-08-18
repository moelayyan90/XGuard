import { describe, expect, it } from "vitest";
import {
  mcpOAuthResponse,
  type McpOAuthEnv,
} from "../apps/worker/src/mcp-oauth.js";
import { normalizeMcpPublicResponse } from "../apps/worker/src/mcp-public-contract.js";

const ORIGIN = "https://xguardgate.com";

function rpcRequest(method: string, params: Record<string, unknown> = {}) {
  return new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("VerifyMCP trust contract", () => {
  it("publishes RFC 9728 protected-resource metadata for /mcp", async () => {
    const response = await mcpOAuthResponse(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
      {} as McpOAuthEnv,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: ["xguard:payment"],
      bearer_methods_supported: ["header"],
    });
    expect(response?.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("publishes OAuth authorization-code and PKCE discovery", async () => {
    const response = await mcpOAuthResponse(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      {} as McpOAuthEnv,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("advertises concise examples and descriptions for every tool parameter", async () => {
    const tools = [
      "xguard_payment_offer",
      "xguard_payment_decision",
      "xguard_discover",
      "xguard_resource_details",
      "xguard_status",
    ].map((name) => ({
      name,
      description: "placeholder",
      inputSchema: { type: "object", properties: {} },
    }));
    const response = await normalizeMcpPublicResponse(
      rpcRequest("tools/list"),
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const body = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          description: string;
          inputSchema: {
            properties: Record<string, { description?: string }>;
          };
        }>;
      };
    };

    expect(body.result.tools).toHaveLength(5);
    for (const tool of body.result.tools) {
      expect(tool.description).toMatch(/Example:/);
      for (const property of Object.values(tool.inputSchema.properties))
        expect(property.description?.trim().length).toBeGreaterThan(0);
    }

    const decision = body.result.tools.find(
      (tool) => tool.name === "xguard_payment_decision",
    );
    expect(Object.keys(decision?.inputSchema.properties ?? {})).toHaveLength(11);
  });

  it("adds a discoverable OAuth challenge to an unauthenticated paid MCP call", async () => {
    const response = await normalizeMcpPublicResponse(
      rpcRequest("tools/call", {
        name: "xguard_payment_decision",
        arguments: { requestId: "request-1" },
      }),
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { isError: true, content: [{ type: "text", text: "auth" }] },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="xguard:payment"`,
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "WWW-Authenticate",
    );
  });
});
