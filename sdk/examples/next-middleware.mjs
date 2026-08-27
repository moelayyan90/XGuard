import { paymentProxy } from "@x402/next";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createXGuardResourceServer } from "xguard-x402-control-plane";

const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("PAY_TO is required");

const resourceServer = createXGuardResourceServer({
  licenseKey: process.env.XGUARD_LICENSE_KEY || "",
});
registerExactEvmScheme(resourceServer);

const proxy = paymentProxy(
  {
    "GET /api/premium": {
      accepts: {
        scheme: "exact",
        network: "eip155:8453",
        payTo,
        price: "$0.01",
      },
      description: "Premium Next.js route routed through XGuard",
      mimeType: "application/json",
    },
  },
  resourceServer,
);

export function middleware(request) {
  return proxy(request);
}

export const config = {
  matcher: "/api/premium",
};
