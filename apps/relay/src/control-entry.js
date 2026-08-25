import site from "./site-entry.js";
import controlPlane from "./control-plane.js";

export { MerchantQuota, SettlementReceipt } from "./gateway.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return site.fetch(request, env, ctx);
    if (url.pathname === "/mcp" && request.method === "HEAD") return new Response(null, {
      status: 200,
      headers: {
        "allow": "POST, HEAD",
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-xguard-control-plane": "3.0.0"
      }
    });
    return controlPlane.fetch(request, env, ctx);
  }
};
