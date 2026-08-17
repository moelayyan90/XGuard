import { describe, expect, it } from "vitest";
import { classifyMcpToolCall } from "../apps/worker/src/monetized-mainnet.js";

describe("mainnet monetization gate", () => {
  it("keeps MCP status free", () => {
    expect(
      classifyMcpToolCall({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "xguard_status", arguments: {} },
      }),
    ).toBeNull();
  });

  it("bills discovery as a source operation", () => {
    expect(
      classifyMcpToolCall({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "xguard_discover", arguments: { query: "weather" } },
      }),
    ).toEqual({
      name: "xguard_discover",
      kind: "SOURCE",
      provider: "xguard-mcp",
      operation: "mcp.xguard_discover",
    });
  });

  it("bills resource details as a source operation", () => {
    expect(
      classifyMcpToolCall({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "xguard_resource_details",
          arguments: { resource: "example" },
        },
      }),
    ).toEqual({
      name: "xguard_resource_details",
      kind: "SOURCE",
      provider: "xguard-mcp",
      operation: "mcp.xguard_resource_details",
    });
  });

  it("future-proofs unknown execution tools as billable tool traffic", () => {
    expect(
      classifyMcpToolCall({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "xguard_execute", arguments: {} },
      }),
    ).toEqual({
      name: "xguard_execute",
      kind: "TOOL",
      provider: "xguard-mcp",
      operation: "mcp.xguard_execute",
    });
  });

  it("does not bill discovery metadata or non-tool MCP methods", () => {
    expect(
      classifyMcpToolCall({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
    ).toBeNull();
    expect(
      classifyMcpToolCall({ jsonrpc: "2.0", id: 6, method: "server/discover" }),
    ).toBeNull();
  });
});
