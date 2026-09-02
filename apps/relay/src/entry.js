import worker from "./control-entry.js";
import authority, { enforceEdgeMandate } from "./authority.js";
import { ownersMetadataResponse } from "./owners-metadata.js";

export { MerchantQuota, SettlementReceipt } from "./control-entry.js";
export { AgentAuthority } from "./authority.js";

const OWNER_PATHS = new Set([
  "/.well-known/owners.json",
  "/mcp/.well-known/owners.json"
]);

const X402_MANIFEST_ALIASES = new Set([
  "/.well-known/x402",
  "/.well-known/x402-facilitator.json",
  "/.well-known/payment-manifest",
  "/.well-known/payment-manifest.json"
]);

const X402_MANIFEST_CANONICAL = "/.well-known/x402.json";
const GLAMA_PATH = "/.well-known/glama.json";
const ROBOTS_PATH = "/robots.txt";
const SITEMAP_PATH = "/sitemap.xml";
const GLAMA_MAINTAINER_EMAIL = "mo.elayyan2023@gmail.com";

const DISCOVERY_HEAD_PATHS = new Set([
  "/docs",
  "/openapi.json",
  "/v1/capabilities",
  "/v1/pricing",
  "/v1/preflight",
  "/v1/health",
  "/v1/ready",
  "/.well-known/xguard-tools.json",
  "/.well-known/payment-manifest",
  "/.well-known/payment-manifest.json",
  "/.well-known/x402-facilitator.json",
  "/.well-known/xguard-egress.json",
  "/.well-known/xguard-egress-key.json",
  "/.well-known/xguard-proof-key.json",
  "/v1/protocols",
  "/skill.md",
  "/llms.txt",
  "/a2a",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/xguard-authority.json",
  "/.well-known/xguard.json",
  X402_MANIFEST_CANONICAL
]);

function headResponse(response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function glamaResponse() {
  return new Response(JSON.stringify({
    $schema: "https://glama.ai/mcp/schemas/connector.json",
    maintainers: [{ email: GLAMA_MAINTAINER_EMAIL }]
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-xguard-discovery": "glama"
    }
  });
}

function robotsResponse(request) {
  const origin = new URL(request.url).origin;
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}${SITEMAP_PATH}\n`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
}

function sitemapResponse(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const apiPaths = [
    "/",
    "/docs",
    "/openapi.json",
    "/v1/capabilities",
    "/v1/pricing",
    "/v1/preflight",
    "/.well-known/xguard-tools.json",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/.well-known/xguard.json",
    "/.well-known/xguard-authority.json",
    "/.well-known/x402.json",
    GLAMA_PATH,
    "/skill.md",
    "/llms.txt"
  ];
  const sitePaths = ["/", "/test", "/agent-payment-safety-test"];
  const paths = url.hostname === "api.xguardgate.com" ? apiPaths : sitePaths;
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${origin}${path}</loc></url>`).join("")}</urlset>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
}

function architectureResponse() {
  return new Response(JSON.stringify({
    name: "XGuard Universal Agent Transaction Control Plane",
    version: "4.1.0",
    description: "Protocol-neutral in-path transaction firewall, delegated spend authority, metering edge and settlement reliability layer for agent commerce.",
    architecture: {
      edge: "Cloudflare Workers",
      model: "stateless request control plane with Durable Objects for delegated spend mandates, quota and settlement receipt state",
      protocols: ["x402", "mpp", "ap2", "ucp", "acp", "mcp", "tap", "http"],
      flow: [
        "human or organization issues scoped XGuard mandate",
        "agent or merchant request",
        "protocol detection and policy inspection",
        "mandatory mandate authorization for financial agent actions",
        "request binding and safety checks",
        "authorized upstream forwarding",
        "successful transaction metering",
        "durable mandate, receipt and quota state"
      ]
    },
    discovery: {
      docs: "https://api.xguardgate.com/docs",
      openapi: "https://api.xguardgate.com/openapi.json",
      protocols: "https://api.xguardgate.com/v1/protocols",
      authority: "https://api.xguardgate.com/.well-known/xguard-authority.json",
      safety_test: "https://xguardgate.com/test",
      manifest: "https://api.xguardgate.com/.well-known/xguard.json",
      x402: "https://api.xguardgate.com/.well-known/x402.json",
      x402_alias: "https://api.xguardgate.com/.well-known/x402",
      payment_manifest: "https://api.xguardgate.com/.well-known/payment-manifest",
      agent_card: "https://api.xguardgate.com/.well-known/agent-card.json",
      glama: "https://api.xguardgate.com/.well-known/glama.json",
      skill: "https://api.xguardgate.com/skill.md",
      llms: "https://api.xguardgate.com/llms.txt",
      sitemap: "https://api.xguardgate.com/sitemap.xml",
      mcp: "https://api.xguardgate.com/mcp",
      a2a: "https://api.xguardgate.com/a2a"
    }
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-xguard-control-plane": "4.1.0"
    }
  });
}

async function x402ManifestAlias(request, env, ctx) {
  const canonicalUrl = new URL(request.url);
  canonicalUrl.pathname = X402_MANIFEST_CANONICAL;
  const canonicalRequest = new Request(canonicalUrl.toString(), {
    method: "GET",
    headers: request.headers,
    redirect: request.redirect
  });
  const response = await worker.fetch(canonicalRequest, env, ctx);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=120");
  headers.set("x-xguard-discovery-alias", X402_MANIFEST_CANONICAL);
  if (request.method === "HEAD") return new Response(null, { status: response.status, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    try {
      if (pathname === "/architecture" && (request.method === "GET" || request.method === "HEAD")) {
        const response = architectureResponse();
        if (request.method === "HEAD") return headResponse(response);
        return response;
      }

      if (pathname === GLAMA_PATH && (request.method === "GET" || request.method === "HEAD")) {
        const response = glamaResponse();
        if (request.method === "HEAD") return headResponse(response);
        return response;
      }

      if (pathname === ROBOTS_PATH && (request.method === "GET" || request.method === "HEAD")) {
        const response = robotsResponse(request);
        if (request.method === "HEAD") return headResponse(response);
        return response;
      }

      if (pathname === SITEMAP_PATH && (request.method === "GET" || request.method === "HEAD")) {
        const response = sitemapResponse(request);
        if (request.method === "HEAD") return headResponse(response);
        return response;
      }

      if (X402_MANIFEST_ALIASES.has(pathname) && (request.method === "GET" || request.method === "HEAD")) {
        return x402ManifestAlias(request, env, ctx);
      }

      if (OWNER_PATHS.has(pathname) && (request.method === "GET" || request.method === "HEAD")) {
        const response = ownersMetadataResponse();
        if (request.method === "HEAD") return headResponse(response);
        return response;
      }

      if (request.method === "HEAD" && DISCOVERY_HEAD_PATHS.has(pathname)) {
        const getRequest = new Request(request.url, {
          method: "GET",
          headers: request.headers,
          redirect: request.redirect
        });
        const authorityResponse = await authority.fetch(getRequest, env, ctx);
        if (authorityResponse) return headResponse(authorityResponse);
        return headResponse(await worker.fetch(getRequest, env, ctx));
      }

      const authorityResponse = await authority.fetch(request, env, ctx);
      if (authorityResponse) return authorityResponse;

      if (pathname.startsWith("/edge/")) {
        const spend = await enforceEdgeMandate(request, env);
        if (spend instanceof Response) return spend;
        if (spend?.authorization_id) {
          const headers = new Headers(request.headers);
          headers.set("x-xguard-authorization-id", spend.authorization_id);
          headers.set("x-xguard-agent-id", spend.agent_id || "agent");
          request = new Request(request, { headers });
        }
      }

      return worker.fetch(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        event: "entry_error",
        method: request.method,
        path: pathname,
        error: String(error?.message || error)
      }));
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: Number(error?.status || 500),
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        }
      });
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      if (typeof worker.scheduled === "function") return await worker.scheduled(controller, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        event: "scheduled_error",
        cron: controller?.cron || "",
        scheduledTime: controller?.scheduledTime || null,
        error: String(error?.message || error)
      }));
      throw error;
    }
  }
};
