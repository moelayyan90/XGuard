import worker from "./control-entry.js";
import { ownersMetadataResponse } from "./owners-metadata.js";

export { MerchantQuota, SettlementReceipt } from "./control-entry.js";

const OWNER_PATHS = new Set([
  "/.well-known/owners.json",
  "/mcp/.well-known/owners.json"
]);

function architectureResponse() {
  return new Response(JSON.stringify({
    name: "XGuard Universal Agent Transaction Control Plane",
    version: "4.0.0",
    description: "Protocol-neutral in-path transaction firewall, metering edge and settlement reliability layer for agent commerce.",
    architecture: {
      edge: "Cloudflare Workers",
      model: "stateless request control plane with Durable Objects for quota and settlement receipt state",
      protocols: ["x402", "mpp", "ap2", "ucp", "acp", "mcp", "tap", "http"],
      flow: [
        "agent or merchant request",
        "protocol detection and policy inspection",
        "request binding and safety checks",
        "authorized upstream forwarding",
        "successful transaction metering",
        "durable receipt and quota state"
      ]
    },
    discovery: {
      docs: "https://api.xguardgate.com/docs",
      openapi: "https://api.xguardgate.com/openapi.json",
      protocols: "https://api.xguardgate.com/v1/protocols",
      manifest: "https://api.xguardgate.com/.well-known/xguard.json",
      agent_card: "https://api.xguardgate.com/.well-known/agent-card.json",
      skill: "https://api.xguardgate.com/skill.md",
      llms: "https://api.xguardgate.com/llms.txt",
      mcp: "https://api.xguardgate.com/mcp",
      a2a: "https://api.xguardgate.com/a2a"
    }
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-xguard-control-plane": "4.0.0"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/architecture" && (request.method === "GET" || request.method === "HEAD")) {
      const response = architectureResponse();
      if (request.method === "HEAD") {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }

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
