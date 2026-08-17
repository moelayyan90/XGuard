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

const MAINNET_NETWORK = "eip155:8453";
const XGUARD_MAINNET_URL = "https://xguard-mainnet.maqamapp.workers.dev";
const xguardUrl = process.env.XGUARD_URL ?? XGUARD_MAINNET_URL;
const apiKey = process.env.XGUARD_API_KEY;
if (apiKey === undefined || apiKey === "") {
  throw new Error(
    "Set XGUARD_API_KEY to the merchant API key returned by XGuard mainnet registration",
  );
}
const payTo = process.env.PAY_TO_MAINNET_ADDRESS;
if (
  payTo === undefined ||
  !/^0x[0-9a-fA-F]{40}$/.test(payTo) ||
  /^0x0{40}$/.test(payTo)
) {
  throw new Error(
    "Set PAY_TO_MAINNET_ADDRESS to a non-zero Base mainnet receiving address; never provide its private key",
  );
}
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const facilitator = createXGuardFacilitator({
  url: xguardUrl,
  apiKey,
});
const resourceServer = new x402ResourceServer(facilitator)
  .register(MAINNET_NETWORK, new ExactEvmScheme())
  .registerExtension(paymentIdentifierResourceServerExtension);
await resourceServer.initialize();
const bazaarSupported = resourceServer
  .getFacilitatorExtensions(2, MAINNET_NETWORK, "exact")
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
          network: MAINNET_NETWORK,
          payTo,
        },
        resource: `${publicBaseUrl}/paid`,
        description:
          "Return a small production JSON response through XGuard-routed Base mainnet x402 settlement.",
        mimeType: "application/json",
        serviceName: "XGuard Starter",
        tags: ["x402", "mainnet", "starter"],
        extensions: {
          [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
          ...(bazaarSupported
            ? declareDiscoveryExtension({
                output: {
                  example: { ok: true, network: MAINNET_NETWORK },
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
    network: MAINNET_NETWORK,
  }),
);
app.get("/paid", (_request, response) =>
  response.json({ ok: true, network: MAINNET_NETWORK }),
);
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      event: "starter_ready",
      port,
      xguardUrl,
      network: MAINNET_NETWORK,
    }),
  ),
);
