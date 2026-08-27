import app from "./trust-entry.js";
import { hostedGateResponse } from "./hosted-gate.js";

export {
  MerchantQuota,
  SettlementReceipt,
  AgentAuthority,
  RailKeyAuthority,
  RailPermitState,
  RailMeter,
} from "./trust-entry.js";

const VERSION = "5.0.1";
const HSTS = "max-age=31536000; includeSubDomains";

function harden(response) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", HSTS);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-xguard-control-plane", VERSION);
  headers.delete("server");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/gate" || url.pathname === "/v1/gate/authorize") {
      const response = await hostedGateResponse(request, env, ctx, app);
      if (response) return harden(response);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
