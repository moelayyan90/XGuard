import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createXGuardFacilitator } from "@xguard/sdk";

const xguardUrl = process.env.XGUARD_URL!;
const payTo = process.env.PAY_TO_TESTNET_ADDRESS!;

const facilitator = createXGuardFacilitator({ url: xguardUrl });

const resourceServer = new x402ResourceServer(facilitator).register(
  "eip155:84532",
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
          network: "eip155:84532",
          payTo,
        },
        resource: "http://127.0.0.1:3000/paid",
        description: "XGuard basic Base Sepolia payment test",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/paid", (_req, res) =>
  res.json({ ok: true, network: "eip155:84532", test: "XGuard Basic" }),
);

app.listen(3000, "127.0.0.1", () => console.log("XGUARD_BASIC_READY"));
