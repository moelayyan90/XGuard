const VERSION = "5.1.0";
const X402_COMPONENT_VERSION = "5.1.0";
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
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status: 200, headers: headers() });
}

function commonDiscovery() {
  return {
    egress: `${API}/v1/egress`,
    egress_manifest: `${API}/.well-known/xguard-egress.json`,
    egress_key: `${API}/.well-known/xguard-egress-key.json`,
    egress_providers: `${API}/v1/egress/providers`,
    egress_pricing: `${API}/v1/egress/pricing`,
    capabilities: `${API}/v1/capabilities`,
    pricing: `${API}/v1/pricing`,
    signed_quote: `${API}/v1/pricing/quote`,
    paid_web_fetch: `${API}/v1/tools/web.fetch`,
    payment_manifest: `${API}/.well-known/payment-manifest`,
    quote_request: { canonical: { url: "https://example.com/", method: "GET", testnet: true }, accepted_envelopes: ["flat", "tool+input", "name+arguments", "tool_name+parameters"] },
    paid_flow: { price: "0.001 USDC", first_execution_status: 402, challenge_header: "Payment-Required", retry_header: "Payment-Signature", settlement_before_execution: true, success_artifacts: ["Payment-Response", "signed receipt", "ProofRail evidence"] },
    actions: `${API}/v1/actions`,
    action_manifest: `${API}/.well-known/xguard-actions.json`,
    action_key: `${API}/.well-known/xguard-actions-key.json`,
    mandates: `${API}/.well-known/xguard-authority.json`,
    protocols: `${API}/v1/protocols`, inspect: `${API}/v1/inspect`, facilitator: `${API}/facilitator`, supported: `${API}/supported`, verify: `${API}/verify`, settle: `${API}/settle`, route: `${API}/v1/facilitator/route`, resources: `${API}/discovery/resources`, search: `${API}/discovery/search`, mcp: `${API}/mcp`, openapi: `${API}/openapi.json`, ai_plugin: `${API}/.well-known/ai-plugin.json`, agent_card: `${API}/.well-known/agent-card.json`, security: `${SITE}/.well-known/security.txt`,
  };
}

function egressContract() {
  return {
    manifest: `${API}/v1/egress`,
    credential_management: `${API}/v1/egress/credentials`,
    capability_issuance: `${API}/v1/egress/capabilities`,
    fetch: `${API}/v1/egress/fetch`,
    pricing: `${API}/v1/egress/pricing`,
    stats: `${API}/v1/egress/stats`,
    providers: ["openai", "anthropic", "github", "stripe", "slack", "notion", "cloudflare", "gemini", "custom"],
    controls: ["encrypted reusable credential", "scoped capability", "host binding", "path-prefix allowlist", "method allowlist", "call budget", "billing before secret release", "manual redirects", "private-target block", "no blind replay"],
  };
}

function architecture() {
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    product_version: VERSION,
    primary_role: "paid tool and credential broker with controlled egress for AI agents",
    public_api: API,
    custody: "no custody of buyer or merchant private keys; encrypted upstream API credentials may be stored by operators",
    execution_model: ["agent discovers actual capabilities", "XGuard signs an input-bound quote", "resource returns x402 v2 HTTP 402 and signed offer", "facilitator verifies and settles", "XGuard executes only after settlement", "result returns with signed receipt and ProofRail", "exact retry returns durable stored outcome", "secretless connectors inject reusable credentials only server-side"],
    architecture: {
      edge: "Cloudflare Workers on xguardgate.com and api.xguardgate.com custom domains",
      state: "Cloudflare Durable Objects for credentials, encryption authority, capabilities, mandates, permits, replay state, receipts, quotas and meters",
      private_network_targets_blocked: true,
      automatic_credential_redirect_forwarding: false,
      automatic_egress_replay: false,
      billing_before_credential_release: true,
    },
    secretless_egress: egressContract(),
    action_rail: {
      permit: `${API}/v1/actions/permits`, execute: `${API}/v1/actions/execute`, pricing: `${API}/v1/actions/pricing`, stats: `${API}/v1/actions/stats`, supported_action_classes: ["payment", "purchase", "booking", "message", "deploy", "delete", "create", "update", "tool_call", "external_action"], protocols: ["http", "mcp", "x402", "mpp", "ap2", "acp", "ucp", "tap", "custom"],
    },
    compatibility_products: { x402: { version: 2, facilitator_url: API, supported: `${API}/supported`, verify: `${API}/verify`, settle: `${API}/settle` }, universal_edge: `${API}/edge/<merchant-host>/<path>`, legacy_settlement_rail: `${API}/v1/rail` },
    discovery: commonDiscovery(),
  };
}

function protocolManifest() {
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    product_version: VERSION,
    primary_role: "paid tool and credential broker with controlled egress for AI agents",
    protocol_neutral: true,
    secretless_egress: egressContract(),
    protocols: {
      http: "native secretless egress target transport and generic machine-action edge",
      mcp: "remote discovery plus xguard_egress_fetch capability execution",
      x402: "native facilitator plus Secretless Egress and Action Rail compatibility",
      mpp: "recognized payment HTTP authorization surface plus Action Rail compatibility",
      ap2: "mandate-aware transaction inspection plus Action Rail compatibility",
      acp: "agent checkout recognition plus Action Rail compatibility",
      ucp: "commerce action recognition plus Action Rail compatibility",
      tap: "trusted-agent identity recognition plus Action Rail compatibility",
    },
    action_rail: { permit: `POST ${API}/v1/actions/permits`, execute: `POST ${API}/v1/actions/execute`, status: `GET ${API}/v1/actions/permits/{permit_id}`, key: `${API}/.well-known/xguard-actions-key.json`, controls: ["mandate", "action allowlist", "merchant allowlist", "budget", "request binding", "single use", "replay rejection", "expiry", "fail-closed ambiguity", "receipt"] },
    x402: { version: 2, facilitator_url: API, automatic_routing: true, durable_replay_guard: true, settlement_ambiguous_fail_closed: true, endpoints: { supported: `${API}/supported`, verify: `${API}/verify`, settle: `${API}/settle` } },
    edge: { endpoint_format: `${API}/edge/<merchant-host>/<path>`, merchant_authorization: "_xguard.<merchant-host> TXT \"xguard-edge=enabled\"", private_network_targets_blocked: true },
    discovery: commonDiscovery(),
  };
}

function aiPluginManifest() {
  return {
    schema_version: "v1",
    name_for_human: "XGuard Universal Paid AI Agent + Secretless Gateway",
    name_for_model: "xguard_paid_secretless_gateway",
    description_for_human: "Discover tools, see signed prices, pay per request through x402 USDC, and keep reusable upstream credentials outside agent context.",
    description_for_model: "Call xguard.web.fetch directly with a public HTTPS URL. XGuard returns an input-bound signed quote and x402 Payment-Required automatically, then settles before execution and returns a signed receipt plus ProofRail. Free capabilities, preflight and standalone quote remain optional. Search, inference, routing and data connectors are disabled unless live capabilities say otherwise. Secretless Egress separately injects operator-managed credentials server-side.",
    auth: { type: "service_http", authorization_type: "Operator management uses X-XGuard-Key; agent egress uses a scoped xgc_ capability" },
    api: { type: "openapi", url: `${API}/openapi.json`, is_user_authenticated: true },
    logo_url: `${SITE}/logo.svg`, contact_email: "mo.elayyan2023@gmail.com", legal_info_url: "https://github.com/moelayyan90/XGuard",
    xguard: { version: VERSION, product_version: VERSION, primary_product: "Universal Paid AI Agent + Secretless Gateway", component_versions: { x402: X402_COMPONENT_VERSION }, capabilities: `${API}/v1/capabilities`, pricing: `${API}/v1/pricing`, payment_manifest: `${API}/.well-known/payment-manifest`, egress_manifest: `${API}/.well-known/xguard-egress.json`, action_manifest: `${API}/.well-known/xguard-actions.json`, mcp_url: `${API}/mcp`, facilitator_url: API, custody: "none" },
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
