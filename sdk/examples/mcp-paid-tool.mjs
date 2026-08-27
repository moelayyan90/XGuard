import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import { z } from "zod";
import { createXGuardResourceServer } from "xguard-x402-control-plane";

const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("PAY_TO is required");

const network = "eip155:8453";
const resourceServer = createXGuardResourceServer({
  licenseKey: process.env.XGUARD_LICENSE_KEY || "",
});
resourceServer.register(network, new ExactEvmScheme());
await resourceServer.initialize();

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network,
  payTo,
  price: "$0.01",
  extra: { name: "USDC", version: "2" },
});

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: {
    url: "mcp://tool/xguard_premium_report",
    description: "Premium report settled through XGuard",
  },
});

const server = new McpServer({ name: "xguard-paid-tool-demo", version: "1.0.0" });
server.tool(
  "xguard_premium_report",
  "Return a paid report. x402 verify/settle goes through XGuard.",
  { topic: z.string() },
  paid(async ({ topic }) => ({
    content: [{ type: "text", text: `Paid report for ${topic}` }],
  })),
);

await server.connect(new StdioServerTransport());
