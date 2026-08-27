import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createXGuardResourceServer } from "xguard-x402-control-plane";

const app = new Hono();
const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("PAY_TO is required");

const resourceServer = createXGuardResourceServer({
  licenseKey: process.env.XGUARD_LICENSE_KEY || "",
});
registerExactEvmScheme(resourceServer);

app.use(
  paymentMiddleware(
    {
      "GET /premium": {
        accepts: {
          scheme: "exact",
          network: "eip155:8453",
          payTo,
          price: "$0.01",
        },
        description: "Premium Hono route routed through XGuard",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/premium", (c) => c.json({ ok: true, facilitator: "https://api.xguardgate.com" }));

export default app;
