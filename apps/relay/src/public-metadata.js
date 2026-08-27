const VERSION = "5.0.1";
const API = "https://api.xguardgate.com";
const HSTS = "max-age=31536000; includeSubDomains";

const headers = (contentType = "application/json; charset=utf-8") => ({
  "content-type": contentType,
  "cache-control": "public, max-age=120",
  "strict-transport-security": HSTS,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-xguard-control-plane": VERSION,
});

function response(request, body) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: headers(),
  });
}

function commonDiscovery() {
  return {
    facilitator: `${API}/facilitator`,
    supported: `${API}/supported`,
    verify: `${API}/verify`,
    settle: `${API}/settle`,
    route: `${API}/v1/facilitator/route`,
    resources: `${API}/discovery/resources`,
    search: `${API}/discovery/search`,
    mcp: `${API}/mcp`,
    openapi: `${API}/openapi.json`,
    agent_card: `${API}/.well-known/agent-card.json`,
    security: "https://xguardgate.com/.well-known/security.txt",
  };
}

function architecture() {
  return {
    name: "XGuard High-Velocity x402 Facilitator",
    version: VERSION,
    product_version: VERSION,
    primary_role: "public non-custodial in-path x402 v2 facilitator with automatic capability/health routing",
    facilitator_url: API,
    custody: "none",
    architecture: {
      edge: "Cloudflare Workers",
      state: "Cloudflare Durable Objects for replay, receipts, quotas, spend authority and settlement-rail state",
      routing: "scheme/network capability -> health -> observed latency",
      settlement_safety: "ambiguous settlement retries fail closed unless reconciliation proves retry safety",
      base_usdc_reconciliation: true,
      signed_payment_recipient_mutation: false,
      signed_payment_amount_mutation: false,
    },
    x402: {
      version: 2,
      endpoints: {
        supported: `${API}/supported`,
        verify: `${API}/verify`,
        settle: `${API}/settle`,
      },
      discovery: commonDiscovery(),
    },
    secondary_capabilities: [
      "protocol-neutral transaction inspection",
      "agent spend mandates",
      "merchant edge",
      "ATS-100 safety testing",
    ],
  };
}

function protocolManifest() {
  return {
    name: "XGuard High-Velocity x402 Facilitator",
    version: VERSION,
    product_version: VERSION,
    primary_role: "x402 v2 facilitator money path",
    facilitator_url: API,
    protocol_neutral: true,
    protocols: {
      x402: "native facilitator, discovery and settlement routing",
      mpp: "recognized by transaction inspection/edge",
      ap2: "recognized by transaction inspection/edge",
      ucp: "recognized by transaction inspection/edge",
      acp: "recognized by transaction inspection/edge",
      mcp: "remote MCP discovery and tooling",
      tap: "recognized by transaction inspection/edge",
      http: "generic machine-transaction inspection/edge",
    },
    x402: {
      version: 2,
      automatic_routing: true,
      discovery_aggregation: true,
      durable_replay_guard: true,
      settlement_ambiguous_fail_closed: true,
      settlement_transport_failover: "reconciliation-gated",
      endpoints: {
        supported: `${API}/supported`,
        verify: `${API}/verify`,
        settle: `${API}/settle`,
      },
    },
    edge: {
      endpoint_format: `${API}/edge/<merchant-host>/<path>`,
      merchant_authorization: "_xguard.<merchant-host> TXT \"xguard-edge=enabled\"",
      private_network_targets_blocked: true,
      bill_only_successful_transaction_calls: true,
    },
    discovery: commonDiscovery(),
  };
}

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return null;

    if (pathname === "/architecture") return response(request, architecture());
    if (pathname === "/v1/protocols" || pathname === "/.well-known/xguard.json") {
      return response(request, protocolManifest());
    }

    return null;
  },
};
