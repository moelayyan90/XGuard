import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createXGuardFacilitator } from "@xguard/sdk";
import { z } from "zod";

const MAINNET_NETWORK = "eip155:8453";
const XGUARD_MAINNET_URL = "https://xguardgate.com";
const xguardUrl = process.env.XGUARD_URL ?? XGUARD_MAINNET_URL;
const apiKey = process.env.XGUARD_API_KEY;
if (apiKey === undefined || apiKey === "") {
  throw new Error(
    "XGUARD_API_KEY is required before the Base mainnet MCP example can start",
  );
}
const payTo = process.env.XGUARD_EXAMPLE_PAY_TO;
if (
  payTo === undefined ||
  !/^0x[0-9a-fA-F]{40}$/.test(payTo) ||
  /^0x0{40}$/.test(payTo)
) {
  throw new Error(
    "XGUARD_EXAMPLE_PAY_TO must be a non-zero Base mainnet receiving address; never put a private key in this server",
  );
}

const facilitator = createXGuardFacilitator({
  url: xguardUrl,
  apiKey,
  timeoutMs: 20_000,
});
const resourceServer = new x402ResourceServer(facilitator).register(
  MAINNET_NETWORK,
  new ExactEvmScheme(),
);
await resourceServer.initialize();
const bazaarSupported = resourceServer
  .getFacilitatorExtensions(2, MAINNET_NETWORK, "exact")
  .includes("bazaar");

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: MAINNET_NETWORK,
  payTo,
  price: "$0.001",
});
const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: {
    url: "mcp://tool/safe_echo",
    description:
      "Short text echo settled through the XGuard production Base mainnet facilitator route.",
    mimeType: "application/json",
    serviceName: "XGuard MCP Example",
    tags: ["x402", "mainnet", "safety"],
  },
  ...(bazaarSupported
    ? {
        extensions: declareDiscoveryExtension({
          toolName: "safe_echo",
          description:
            "Echo one short message after a Base mainnet x402 payment routed through XGuard.",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                minLength: 1,
                maxLength: 200,
                description:
                  "Text to echo after successful mainnet settlement.",
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
          example: { message: "hello" },
          output: {
            example: { content: [{ type: "text", text: "hello" }] },
            schema: {
              type: "object",
              properties: {
                content: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", const: "text" },
                      text: { type: "string" },
                    },
                    required: ["type", "text"],
                  },
                },
              },
              required: ["content"],
            },
          },
        }),
      }
    : {}),
});
const server = new McpServer({
  name: "xguard-paid-mcp-example",
  version: "0.1.0-alpha.0",
});

server.tool(
  "xguard_diagnostics",
  "Free: reports this example's XGuard transport configuration without exposing secrets.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          x402Version: 2,
          network: MAINNET_NETWORK,
          facilitator: xguardUrl,
          mode: "mainnet",
          transport: "stdio",
          mcpSdkGeneration:
            "1.x compatibility line required by @x402/mcp 2.22.0",
          bazaar: bazaarSupported
            ? "schema metadata declared; public catalog eligibility still requires a deployed SSE or Streamable HTTP transport"
            : "metadata withheld because the selected facilitator route does not advertise Bazaar",
        }),
      },
    ],
  }),
);

server.tool(
  "safe_echo",
  "Base mainnet paid tool: echoes a short message after x402 verification and settlement through XGuard. Resource price is $0.001; XGuard's separate $0.002 successful-settlement service fee is charged to the merchant's prepaid XGuard balance.",
  { message: z.string().min(1).max(200) },
  paid(async ({ message }) => ({ content: [{ type: "text", text: message }] })),
);

await server.connect(new StdioServerTransport());
