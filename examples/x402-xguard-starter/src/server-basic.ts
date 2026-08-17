import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createXGuardFacilitator } from "@xguard/sdk";

const MAINNET_NETWORK = "eip155:8453";
const XGUARD_MAINNET_URL = "https://xguard-mainnet.maqamapp.workers.dev";
const xguardUrl = process.env.XGUARD_URL ?? XGUARD_MAINNET_URL;
const apiKey = process.env.XGUARD_API_KEY;
const payTo = process.env.PAY_TO_MAINNET_ADDRESS;

if (apiKey === undefined || apiKey === "") {
  throw new Error("Set XGUARD_API_KEY before using the mainnet starter");
}
if (
  payTo === undefined ||
  !/^0x[0-9a-fA-F]{40}$/.test(payTo) ||
  /^0x0{40}$/.test(payTo)
) {
  throw new Error(
    "Set PAY_TO_MAINNET_ADDRESS to a non-zero Base mainnet receiving address",
  );
}

const facilitator = createXGuardFacilitator({ url: xguardUrl, apiKey });

const resourceServer = new x402ResourceServer(facilitator).register(
  MAINNET_NETWORK,
  new ExactEvmScheme(),
);

await resourceServer.initialize();

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
        resource: "http://127.0.0.1:3000/paid",
        description: "XGuard basic Base mainnet payment example",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/paid", (_req, res) =>
  res.json({ ok: true, network: MAINNET_NETWORK, example: "XGuard Basic" }),
);

app.listen(3000, "127.0.0.1", () => console.log("XGUARD_BASIC_READY"));
