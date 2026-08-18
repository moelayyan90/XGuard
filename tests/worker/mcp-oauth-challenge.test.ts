import { describe, expect, it } from "vitest";
import { mcpOAuthChallengeResponse } from "../../apps/worker/src/mcp-oauth-challenge.js";

const ORIGIN = "https://xguard.test";

describe("MCP OAuth challenge", () => {
  it("returns a Bearer challenge for an unauthenticated protected tool", async () => {
    const response = await mcpOAuthChallengeResponse(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Mcp-Name": "xguard_payment_decision",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "xguard_payment_decision", arguments: {} },
        }),
      }),
    );

    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="xguard:mcp"`,
    );
    expect(response?.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    );
    expect(response?.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("keeps public tools open and lets authenticated calls reach MCP", async () => {
    const publicResponse = await mcpOAuthChallengeResponse(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { "Mcp-Name": "xguard_status" },
      }),
    );
    expect(publicResponse).toBeNull();

    const authenticatedResponse = await mcpOAuthChallengeResponse(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer xg_pass_example",
          "Mcp-Name": "xguard_payment_decision",
        },
      }),
    );
    expect(authenticatedResponse).toBeNull();
  });
});
