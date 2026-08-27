import express from "express";
import { paymentMiddleware } from "@x402/express";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createXGuardResourceServer } from "xguard-x402-control-plane";

const app = express();
const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("PAY_TO is required");

const resourceServer = createXGuardResourceServer({
  licenseKey: process.env.XGUARD_LICENSE_KEY || "",
});
registerExactEvmScheme(resourceServer);

app.use(
  paymentMiddleware(
    {
      "GET /api/premium": {
        accepts: {
          scheme: "exact",
          network: "eip155:8453",
          payTo,
          price: "$0.01",
        },
        description: "Premium API response routed through XGuard",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/api/premium", (_req, res) => {
  res.json({ ok: true, facilitator: "https://api.xguardgate.com" });
});

app.listen(process.env.PORT || 4021);
