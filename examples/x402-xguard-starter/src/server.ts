import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import { createXGuardFacilitator } from "@xguard/sdk";

const xguardUrl = process.env.XGUARD_URL ?? "http://127.0.0.1:8787";
const payTo = process.env.PAY_TO_TESTNET_ADDRESS;
if (
  payTo === undefined ||
  !/^0x[0-9a-fA-F]{40}$/.test(payTo) ||
  /^0x0{40}$/.test(payTo)
) {
  throw new Error(
    "Set PAY_TO_TESTNET_ADDRESS to a non-zero Base Sepolia receiving address; never provide its private key",
  );
}
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const facilitator = createXGuardFacilitator({
  url: xguardUrl,
  ...(process.env.XGUARD_API_KEY === undefined ||
  process.env.XGUARD_API_KEY === ""
    ? {}
    : { apiKey: process.env.XGUARD_API_KEY }),
});
const resourceServer = new x402ResourceServer(facilitator)
  .register("eip155:84532", new ExactEvmScheme())
  .registerExtension(paymentIdentifierResourceServerExtension);
await resourceServer.initialize();
const bazaarSupported = resourceServer
  .getFacilitatorExtensions(2, "eip155:84532", "exact")
  .includes("bazaar");
if (bazaarSupported)
  resourceServer.registerExtension(bazaarResourceServerExtension);

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /paid": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: "eip155:84532",
          payTo,
        },
        resource: `${publicBaseUrl}/paid`,
        description:
          "Return a small testnet-only JSON response through XGuard-routed x402 settlement.",
        mimeType: "application/json",
        serviceName: "XGuard Starter",
        tags: ["x402", "testnet", "starter"],
        extensions: {
          [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
          ...(bazaarSupported
            ? declareDiscoveryExtension({
                output: {
                  example: { ok: true, network: "eip155:84532" },
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      network: { type: "string" },
                    },
                    required: ["ok", "network"],
                  },
                },
              })
            : {}),
        },
      },
    },
    resourceServer,
  ),
);

app.get("/", (_request, response) =>
  response.json({
    name: "x402 + XGuard starter",
    paid: "/paid",
    network: "eip155:84532",
  }),
);
app.get("/paid", (_request, response) =>
  response.json({ ok: true, network: "eip155:84532" }),
);
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      event: "starter_ready",
      port,
      xguardUrl,
      network: "eip155:84532",
    }),
  ),
);
