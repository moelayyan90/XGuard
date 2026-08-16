import { describe, expect, it } from "vitest";
import { shouldUseModernMcp } from "../apps/worker/src/mainnet-mcp-modern.js";

const URL = "https://xguard-mainnet.maqamapp.workers.dev/mcp";

function request(headers: Record<string, string> = {}) {
  return new Request(URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  });
}

describe("MCP mainnet routing", () => {
  it("keeps headerless MCP clients on the legacy implementation", () => {
    expect(shouldUseModernMcp(request())).toBe(false);
  });

  it("keeps declared 2025 MCP clients on the legacy implementation", () => {
    expect(
      shouldUseModernMcp(
        request({ "MCP-Protocol-Version": "2025-06-18" }),
      ),
    ).toBe(false);
  });
});
