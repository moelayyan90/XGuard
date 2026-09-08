import app from "./trust-entry.js";
import egress, { EgressKeyAuthority, EgressCredentialState, EgressTenantIndex, EgressCapabilityState, EgressMeter } from "./egress-vault.js";
import egressSite from "./site-egress.js";

export {
  MerchantQuota,
  SettlementReceipt,
  AgentAuthority,
  RailKeyAuthority,
  RailPermitState,
  RailMeter,
  ActionKeyAuthority,
  ActionPermitState,
  ActionMeter,
} from "./trust-entry.js";
export { EgressKeyAuthority, EgressCredentialState, EgressTenantIndex, EgressCapabilityState, EgressMeter };

const VERSION = "5.1.0";
const API = "https://api.xguardgate.com";
const SITE = "https://xguardgate.com";
const HSTS = "max-age=31536000; includeSubDomains";

const PROVIDERS = {
  openai: { hosts: ["api.openai.com"], injection_header: "authorization" },
  anthropic: { hosts: ["api.anthropic.com"], injection_header: "x-api-key" },
  github: { hosts: ["api.github.com"], injection_header: "authorization" },
  stripe: { hosts: ["api.stripe.com"], injection_header: "authorization" },
  slack: { hosts: ["slack.com"], injection_header: "authorization" },
  notion: { hosts: ["api.notion.com"], injection_header: "authorization" },
  cloudflare: { hosts: ["api.cloudflare.com"], injection_header: "authorization" },
  gemini: { hosts: ["generativelanguage.googleapis.com"], injection_header: "x-goog-api-key" },
};

const EGRESS_DISCOVERY_TOOL = {
  name: "xguard_secretless_egress",
  description: "Discover XGuard Secretless Egress. Operators keep reusable upstream API credentials inside XGuard and give AI agents only short-lived scoped XGuard capabilities. Agents never receive the upstream secret.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard Secretless Egress", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const EGRESS_FETCH_TOOL = {
  name: "xguard_egress_fetch",
  description: "Execute a delegated API action with scoped credentials and a gateway-credit budget. Supply idempotency_key for writes and reuse it with the identical request to retrieve the stored signed result without another charge or upstream call. Unknown outcomes never trigger automatic reexecution. The operator provisions the upstream account; the agent receives only the capability.",
  inputSchema: {
    type: "object",
    required: ["capability", "target"],
    properties: {
      capability: { type: "string", description: "Short-lived XGuard capability issued by the operator." },
      target: { type: "string", description: "Public HTTPS URL within the capability scope." },
      method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
      idempotency_key: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_:.\\-]+$", description: "Required for POST/PUT/PATCH/DELETE. Stable business-operation key; retry the exact same request with this key." },
      headers: { type: "object", additionalProperties: { type: "string" } },
      body_json: {}, body_text: { type: "string" }, body_base64: { type: "string" }, content_type: { type: "string" },
    },
  },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard Egress Fetch", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

export function secretlessCapability(env = {}) {
  const units = Number(env.EGRESS_EXECUTION_CREDITS || 1);
  const priceValid = Number.isSafeInteger(units) && units > 0 && units <= 1000000;
  return {
    id: EGRESS_FETCH_TOOL.name,
    available: Boolean(priceValid && env.EGRESS_KEYS && env.EGRESS_CREDENTIALS && env.EGRESS_CAPABILITIES && env.EGRESS_METER && env.PROOF_AUTHORITY),
    paid: true,
    provider: "operator_connected_api",
    outcome: "A scoped API action with an immutable retry key, gateway-credit budget and signed execution evidence",
    endpoint: `${API}/v1/egress/fetch`,
    input_schema: EGRESS_FETCH_TOOL.inputSchema,
    pricing: { endpoint: `${API}/v1/egress/pricing`, unit: "XGuard Usage Credit", credits_per_authorized_attempt: priceValid ? units : null, provider_charges: "paid separately by the operator" },
    authentication: { operator_provisions_credential: true, agent_uses: "short_lived_scoped_capability", provider_account_required_for_operator: true },
    retry_policy: "same key and exact request returns stored outcome; never reexecute an unknown write",
    refund_policy: "known pre-billing failures release reserved credits; billed attempts have no automatic refund",
    proof_semantics: "XGuard signs request and response digests, execution identity and gateway billing; it does not attest the truth of provider content",
    sla: null,
    estimated_latency_ms: null,
    measured_reliability: null,
  };
}

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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function mcpRequest(snapshot) {
  if (!snapshot) return null;
  try { return await snapshot.clone().json(); } catch { return null; }
}

function mcpResult(id, data) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result: { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }], structuredContent: typeof data === "object" && data !== null ? data : { value: data } } }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleEgressMcp(snapshot, env) {
  const message = await mcpRequest(snapshot);
  if (!message || message.method !== "tools/call") return null;
  const name = message?.params?.name;
  if (name === EGRESS_DISCOVERY_TOOL.name) {
    const response = await egress.fetch(new Request(`${API}/v1/egress`), env);
    return mcpResult(message.id, await response.json());
  }
  if (name === EGRESS_FETCH_TOOL.name) {
    const args = message?.params?.arguments || {};
    const response = await egress.fetch(new Request(`${API}/v1/egress/fetch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }), env);
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let value = text;
    if (contentType.includes("application/json") && text) { try { value = JSON.parse(text); } catch { /* An upstream may mislabel its response. */ } }
    const result = mcpResult(message.id, { status: response.status, body: value, headers: Object.fromEntries(response.headers), replay: response.headers.get("x-xguard-replay") === "true", execution_id: response.headers.get("x-xguard-execution-id"), proof: response.headers.get("x-xguard-proof") });
    const envelope = await result.json();
    envelope.result.isError = !response.ok;
    return new Response(JSON.stringify(envelope), { status: 200, headers: result.headers });
  }
  return null;
}

async function improveToolsList(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;
  const message = await mcpRequest(snapshot);
  if (message?.method !== "tools/list") return response;
  const body = await response.clone().json().catch(() => null);
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return response;
  if (!tools.some(tool => tool?.name === EGRESS_DISCOVERY_TOOL.name)) tools.unshift(EGRESS_DISCOVERY_TOOL);
  if (!tools.some(tool => tool?.name === EGRESS_FETCH_TOOL.name)) tools.unshift(EGRESS_FETCH_TOOL);
  const headers = new Headers(response.headers); headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

function llmsText() {
  return `XGuard Universal Paid AI Agent + Secretless Gateway\nVersion: ${VERSION}\nWebsite: ${SITE}\nAPI: ${API}\nPrimary role: keep reusable upstream credentials out of AI agents and inject them only at controlled egress.\n\nSecretless Egress:\nGET ${API}/v1/egress\nPOST ${API}/v1/egress/credentials   (operator only; requires X-XGuard-Key)\nGET ${API}/v1/egress/credentials    (operator only)\nPOST ${API}/v1/egress/capabilities  (operator only)\nPOST ${API}/v1/egress/fetch         (agent uses a scoped capability; no upstream secret)\nGET ${API}/v1/egress/pricing\nGET ${API}/.well-known/xguard-egress.json\n\nMCP agent tools:\nxguard_secretless_egress\nxguard_egress_fetch\n\nCredential provisioning is intentionally not exposed as an MCP tool. Operators provision reusable secrets outside model context.\n\nUnderlying controls remain available through XGuard Action Rail, mandates, Universal Gate, native x402 facilitator endpoints and protocol discovery.\n`;
}

function skillText() {
  return `# XGuard Universal Paid AI Agent + Secretless Gateway\n\nUse XGuard when an AI agent needs to call a service that normally requires a reusable API credential. Keep the reusable secret in XGuard and give the agent only a short-lived scoped capability.\n\n## Operator\n1. POST ${API}/v1/egress/credentials with X-XGuard-Key.\n2. POST ${API}/v1/egress/capabilities with X-XGuard-Key.\n3. Give only the returned xgc_... capability to the agent.\n\n## Agent\nCall POST ${API}/v1/egress/fetch or MCP tool xguard_egress_fetch with capability + target. XGuard checks scope and Usage Credits, injects the upstream credential server-side, forwards exactly one HTTPS request and never auto-follows redirects.\n\n## Billing boundary\nThe current configuration consumes one Usage Credit before credential decryption and before outbound network egress. If billing cannot commit, no upstream request is sent.\n\n## Security boundary\nCapabilities bind an exact HTTPS origin, path prefix, allowed methods, expiration and call budget. Reusable credentials are encrypted at rest and are not returned to the agent.\n`;
}

function sitemapResponse(request) {
  const origin = new URL(request.url).origin;
  const paths = origin === SITE ? ["/", "/logo.svg", "/.well-known/security.txt"] : ["/", "/v1/egress", "/v1/egress/providers", "/v1/egress/pricing", "/.well-known/xguard-egress.json", "/v1/actions", "/.well-known/xguard-actions.json", "/.well-known/xguard.json", "/architecture", "/docs", "/openapi.json", "/mcp", "/llms.txt", "/skill.md", "/facilitator", "/supported"];
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${origin}${path}</loc></url>`).join("")}</urlset>`;
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

async function improvePublicJson(url, response) {
  if (!(response instanceof Response) || !response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return response;
  const paths = ["/openapi.json", "/docs", "/architecture", "/v1/protocols", "/.well-known/xguard.json", "/.well-known/ai-plugin.json", "/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a"];
  if (!paths.includes(url.pathname)) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;

  body.primary_product = "XGuard Universal Paid AI Agent + Secretless Gateway";
  body.primary_role = "credential broker and egress choke point for AI agents";
  body.secretless_egress = {
    manifest: `${API}/v1/egress`, providers: `${API}/v1/egress/providers`, credential_management: `${API}/v1/egress/credentials`, capability_issuance: `${API}/v1/egress/capabilities`, agent_fetch: `${API}/v1/egress/fetch`, pricing: `${API}/v1/egress/pricing`,
    security_model: "operator holds reusable secret; agent receives scoped short-lived XGuard capability",
  };

  if (url.pathname === "/openapi.json") {
    body.info = { ...(body.info || {}), title: "XGuard Universal Paid AI Agent + Secretless Gateway", version: VERSION, description: "Credential broker and controlled egress gateway for AI agents, with encrypted reusable credentials, scoped short-lived capabilities, pre-egress billing, Action Rail controls and native x402 compatibility." };
    body.paths = { ...(body.paths || {}),
      "/v1/egress": { get: { summary: "Discover XGuard Secretless Egress", responses: { "200": { description: "Egress manifest" } } } },
      "/v1/egress/credentials": { post: { summary: "Store an encrypted upstream credential (operator only)", responses: { "201": { description: "Credential metadata; secret is never returned" }, "401": { description: "XGuard key required" } } }, get: { summary: "List operator credential metadata", responses: { "200": { description: "Credential metadata" } } } },
      "/v1/egress/capabilities": { post: { summary: "Issue a short-lived scoped capability for an agent", responses: { "201": { description: "Scoped capability" } } } },
      "/v1/egress/capabilities/{id}": { delete: { summary: "Revoke a capability; already dispatched work may finish", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-f0-9]{32}$" } }, { name: "X-XGuard-Key", in: "header", required: true, schema: { type: "string" } }], responses: { "200": { description: "Revoked" }, "403": { description: "Not the capability owner" } } } },
      "/v1/egress/fetch": { post: { summary: "Execute one credential-backed outbound request using an XGuard capability", responses: { "200": { description: "Upstream response" }, "401": { description: "Capability required" }, "402": { description: "Usage Credits required" }, "403": { description: "Capability or credential scope denied" }, "503": { description: "Billing/decryption/network ambiguity; no automatic replay" } } } },
      "/v1/egress/pricing": { get: { summary: "Secretless Egress Usage Credit boundary", responses: { "200": { description: "Billing contract" } } } },
    };
    body.paths["/v1/egress/fetch"].post.requestBody = { required: true, content: { "application/json": { schema: EGRESS_FETCH_TOOL.inputSchema } } };
    body.paths["/v1/egress/fetch"].post.parameters = [{ name: "Idempotency-Key", in: "header", schema: { type: "string", minLength: 8, maxLength: 128 }, description: "Same value as idempotency_key when both are provided" }];
    body.paths["/v1/egress/fetch"].post.responses["409"] = { description: "Request digest conflicts with the key, execution is in progress, or its outcome is unknown; do not use a new key to retry an uncertain write" };
    body.paths["/v1/egress/capabilities"].post.requestBody = { required: true, content: { "application/json": { schema: { type: "object", required: ["credential_id"], properties: { credential_id: { type: "string" }, target_origin: { type: "string", format: "uri" }, path_prefix: { type: "string" }, allowed_methods: { type: "array", items: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] } }, ttl_seconds: { type: "integer", minimum: 30, maximum: 3600 }, max_calls: { type: "integer", minimum: 1, maximum: 1000 }, max_total_credits: { type: "integer", minimum: 1, maximum: 1000000000, description: "XGuard gateway-credit budget; excludes provider charges" }, max_credits_per_call: { type: "integer", minimum: 1, maximum: 1000000 } } } } } };
  }
  if (["/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a"].includes(url.pathname)) {
    body.name = "XGuard Universal Paid AI Agent + Secretless Gateway";
    body.description = "Credential broker and controlled egress for AI agents. Reusable upstream secrets stay inside XGuard; agents receive scoped capabilities.";
    body.version = VERSION;
    const skills = Array.isArray(body.skills) ? body.skills : [];
    if (!skills.some(skill => skill?.id === "xguard-secretless-egress")) skills.unshift({ id: "xguard-secretless-egress", name: "Secretless Agent Egress", description: "Call credential-protected APIs without placing reusable upstream secrets inside the AI agent." });
    body.skills = skills;
  }
  if (url.pathname === "/.well-known/ai-plugin.json") {
    body.name_for_human = "XGuard Universal Paid AI Agent + Secretless Gateway";
    body.description_for_human = "Keep reusable API credentials out of AI agents and inject them only at controlled egress.";
    body.description_for_model = "Use XGuard Secretless Egress when an agent needs a credential-protected HTTPS API. Operators provision credentials and capabilities; agents only use scoped capabilities with xguard_egress_fetch.";
    body.xguard = { ...(body.xguard || {}), version: VERSION, egress_url: `${API}/v1/egress`, egress_fetch: `${API}/v1/egress/fetch`, mcp_url: `${API}/mcp` };
  }
  const headers = new Headers(response.headers); headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "xguardgate.com" && url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) {
      const site = await egressSite.fetch(request, env, ctx);
      if (site instanceof Response) return harden(site);
    }
    if (url.pathname === "/llms.txt" && request.method === "GET") return harden(new Response(llmsText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } }));
    if (url.pathname === "/skill.md" && request.method === "GET") return harden(new Response(skillText(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=120" } }));
    if (url.pathname === "/sitemap.xml" && ["GET", "HEAD"].includes(request.method)) return harden(sitemapResponse(request));
    if (url.pathname === "/v1/egress/providers" && request.method === "GET") return harden(new Response(JSON.stringify({ providers: PROVIDERS, custom: { requires: ["header_name", "allowed_hosts"] } }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } }));

    const snapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;
    const mcpResponse = await handleEgressMcp(snapshot, env);
    if (mcpResponse) return harden(mcpResponse);

    const egressResponse = await egress.fetch(request, env, ctx);
    if (egressResponse instanceof Response) return harden(egressResponse);

    const response = await app.fetch(request, env, ctx);
    const tools = await improveToolsList(snapshot, response);
    return harden(await improvePublicJson(url, tools));
  },
  async scheduled(controller, env, ctx) { if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx); },
};
