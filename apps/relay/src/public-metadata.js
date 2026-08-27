const VERSION = "5.0.1";
const API = "https://api.xguardgate.com";
const SITE = "https://xguardgate.com";
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
    actions: `${API}/v1/actions`,
    action_manifest: `${API}/.well-known/xguard-actions.json`,
    action_key: `${API}/.well-known/xguard-actions-key.json`,
    mandates: `${API}/.well-known/xguard-authority.json`,
    protocols: `${API}/v1/protocols`,
    inspect: `${API}/v1/inspect`,
    facilitator: `${API}/facilitator`,
    supported: `${API}/supported`,
    verify: `${API}/verify`,
    settle: `${API}/settle`,
    route: `${API}/v1/facilitator/route`,
    resources: `${API}/discovery/resources`,
    search: `${API}/discovery/search`,
    mcp: `${API}/mcp`,
    openapi: `${API}/openapi.json`,
    ai_plugin: `${API}/.well-known/ai-plugin.json`,
    agent_card: `${API}/.well-known/agent-card.json`,
    security: `${SITE}/.well-known/security.txt`,
  };
}

function architecture() {
  return {
    name: "XGuard Action Rail",
    version: VERSION,
    product_version: VERSION,
    primary_role: "protocol-neutral execution control plane for irreversible AI side effects",
    public_api: API,
    custody: "none",
    execution_model: [
      "scoped delegated mandate",
      "cryptographically signed request-bound action permit",
      "atomic single-use transition to executing",
      "one upstream execution with Idempotency-Key binding",
      "durable executed, failed or ambiguous state",
      "successful-execution Usage Credit consumption",
      "durable action receipt",
    ],
    architecture: {
      edge: "Cloudflare Workers on xguardgate.com and api.xguardgate.com custom domains",
      state: "Cloudflare Durable Objects for mandates, permits, signatures, replay state, receipts, quotas and meters",
      private_network_targets_blocked: true,
      automatic_action_replay: false,
      ambiguous_transport_or_5xx: "fail closed",
    },
    action_rail: {
      permit: `${API}/v1/actions/permits`,
      execute: `${API}/v1/actions/execute`,
      pricing: `${API}/v1/actions/pricing`,
      stats: `${API}/v1/actions/stats`,
      supported_action_classes: ["payment", "purchase", "booking", "message", "deploy", "delete", "create", "update", "tool_call", "external_action"],
      protocols: ["http", "mcp", "x402", "mpp", "ap2", "acp", "ucp", "tap", "custom"],
    },
    compatibility_products: {
      x402: {
        version: 2,
        facilitator_url: API,
        supported: `${API}/supported`,
        verify: `${API}/verify`,
        settle: `${API}/settle`,
      },
      universal_edge: `${API}/edge/<merchant-host>/<path>`,
      legacy_settlement_rail: `${API}/v1/rail`,
    },
    discovery: commonDiscovery(),
  };
}

function protocolManifest() {
  return {
    name: "XGuard Action Rail",
    version: VERSION,
    product_version: VERSION,
    primary_role: "AI action execution boundary",
    protocol_neutral: true,
    protocols: {
      http: "native Action Rail target transport and generic machine-action edge",
      mcp: "remote MCP discovery plus tool-action recognition",
      x402: "native facilitator plus Action Rail compatibility",
      mpp: "recognized payment HTTP authorization surface plus Action Rail compatibility",
      ap2: "mandate-aware transaction inspection plus Action Rail compatibility",
      acp: "agent checkout recognition plus Action Rail compatibility",
      ucp: "commerce action recognition plus Action Rail compatibility",
      tap: "trusted-agent identity recognition plus Action Rail compatibility",
    },
    action_rail: {
      permit: `POST ${API}/v1/actions/permits`,
      execute: `POST ${API}/v1/actions/execute`,
      status: `GET ${API}/v1/actions/permits/{permit_id}`,
      key: `${API}/.well-known/xguard-actions-key.json`,
      controls: ["mandate", "action allowlist", "merchant allowlist", "budget", "request binding", "single use", "replay rejection", "expiry", "fail-closed ambiguity", "receipt"],
      billing: "Usage Credits consumed only after known successful Action Rail execution",
    },
    x402: {
      version: 2,
      facilitator_url: API,
      automatic_routing: true,
      durable_replay_guard: true,
      settlement_ambiguous_fail_closed: true,
      endpoints: { supported: `${API}/supported`, verify: `${API}/verify`, settle: `${API}/settle` },
    },
    edge: {
      endpoint_format: `${API}/edge/<merchant-host>/<path>`,
      merchant_authorization: "_xguard.<merchant-host> TXT \"xguard-edge=enabled\"",
      private_network_targets_blocked: true,
    },
    discovery: commonDiscovery(),
  };
}

function aiPluginManifest() {
  return {
    schema_version: "v1",
    name_for_human: "XGuard Action Rail",
    name_for_model: "xguard_action_rail",
    description_for_human: "Protocol-neutral execution control for AI side effects with scoped mandates, signed single-use permits and durable receipts.",
    description_for_model: "Use XGuard when an AI agent is about to cause an irreversible external side effect. Prepare a scoped mandate and a signed request-bound permit, then execute through the Action Rail. XGuard rejects replay, binds the exact target/method/action/request body, and fails closed on ambiguous transport or 5xx outcomes. Native x402 facilitator endpoints remain available as a compatibility capability.",
    auth: { type: "service_http", authorization_type: "X-XGuard-Key plus X-XGuard-Mandate for protected action preparation" },
    api: { type: "openapi", url: `${API}/openapi.json`, is_user_authenticated: true },
    logo_url: `${SITE}/logo.svg`,
    contact_email: "mo.elayyan2023@gmail.com",
    legal_info_url: "https://github.com/moelayyan90/XGuard",
    xguard: {
      version: VERSION,
      action_manifest: `${API}/.well-known/xguard-actions.json`,
      mcp_url: `${API}/mcp`,
      facilitator_url: API,
      custody: "none",
    },
  };
}

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return null;
    if (pathname === "/architecture") return response(request, architecture());
    if (pathname === "/v1/protocols" || pathname === "/.well-known/xguard.json") return response(request, protocolManifest());
    if (pathname === "/.well-known/ai-plugin.json") return response(request, aiPluginManifest());
    return null;
  },
};
