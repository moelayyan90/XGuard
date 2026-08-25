import worker from "./control-entry.js";
import { ownersMetadataResponse } from "./owners-metadata.js";

export { MerchantQuota, SettlementReceipt } from "./control-entry.js";

const OWNER_PATHS = new Set([
  "/.well-known/owners.json",
  "/mcp/.well-known/owners.json"
]);

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (OWNER_PATHS.has(pathname) && (request.method === "GET" || request.method === "HEAD")) {
      const response = ownersMetadataResponse();
      if (request.method === "HEAD") {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof worker.scheduled === "function") {
      return worker.scheduled(controller, env, ctx);
    }
  }
};
