import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402, type X402Config } from "agents/x402";
import { z } from "zod";

export interface Env {
  MCP_ADDRESS: string;
  XGUARD_LICENSE_KEY?: string;
}

export class XGuardPaidMCP extends McpAgent<Env> {
  server = new McpServer({ name: "xguard-paid-mcp", version: "5.0.1" });

  async init() {
    const licenseKey = this.env.XGUARD_LICENSE_KEY?.trim();
    const config: X402Config = {
      network: "base",
      recipient: this.env.MCP_ADDRESS as `0x${string}`,
      facilitator: {
        url: "https://xguardgate.com/api",
        createAuthHeaders: async () => ({
          supported: {},
          verify: {},
          settle: licenseKey ? { Authorization: `Bearer ${licenseKey}` } : {},
        }),
      },
    };

    const paid = withX402(this.server, config);

    paid.paidTool(
      "premium_lookup",
      "Example paid tool settled through the XGuard facilitator control plane.",
      0.01,
      { query: z.string() },
      {},
      async ({ query }) => ({
        content: [{ type: "text", text: JSON.stringify({ query, ok: true }) }],
      }),
    );
  }
}
