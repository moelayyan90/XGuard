import site from "./site-entry.js";
import controlPlane from "./control-plane.js";

export { MerchantQuota, SettlementReceipt } from "./gateway.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return site.fetch(request, env, ctx);
    return controlPlane.fetch(request, env, ctx);
  }
};
