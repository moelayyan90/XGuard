import gateway from "./gateway.js";

const VERSION = "3.0.0";
const BASE = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const API = "https://api.xguardgate.com";
const RECONCILE = "https://reconcile.xguardgate.com";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-control-plane": VERSION,
    ...headers
  }
});
const isAddress = x => /^0x[0-9a-fA-F]{40}$/.test(String(x || ""));
const isNonce = x => /^0x[0-9a-fA-F]{64}$/.test(String(x || ""));
const lower = x => String(x ?? "").toLowerCase();
const amount = x => {
  const s = String(x ?? "");
  if (/^[0-9]+$/.test(s)) { try { return BigInt(s).toString(); } catch {} }
  return s;
};
const sameAddress = (a, b) => isAddress(a) && isAddress(b) ? lower(a) === lower(b) : String(a ?? "") === String(b ?? "");

function extract(body) {
  const requirements = body?.paymentRequirements || body?.requirements || body?.payment?.paymentRequirements || null;
  const paymentPayload = body?.paymentPayload || body?.payment || body?.payload || null;
  const accepted = paymentPayload?.accepted || body?.accepted || null;
  const authorization = paymentPayload?.payload?.authorization || paymentPayload?.authorization || body?.authorization || null;
  return { requirements, paymentPayload, accepted, authorization };
}

function block(reason, detail = {}) {
  return { ok: false, reason, detail };
}

function inspectPayment(body) {
  const { requirements: r, paymentPayload: p, accepted: a, authorization: z } = extract(body);
  const versions = [body?.x402Version, p?.x402Version].filter(v => v !== undefined && v !== null && v !== "");
  if (versions.some(v => Number(v) !== 2)) return block("unsupported_x402_version", { observed: versions });
  if (!r || !p || !a) return block("missing_payment_context");

  const required = ["scheme", "network", "asset", "payTo", "amount"];
  for (const field of required) if (r[field] === undefined || r[field] === null || r[field] === "") return block(`missing_requirement_${field}`);
  for (const field of required) if (a[field] === undefined || a[field] === null || a[field] === "") return block(`missing_accepted_${field}`);

  if (String(r.scheme) !== String(a.scheme)) return block("scheme_binding_mismatch");
  if (String(r.network) !== String(a.network)) return block("network_binding_mismatch");
  if (!sameAddress(r.asset, a.asset)) return block("asset_binding_mismatch");
  if (!sameAddress(r.payTo, a.payTo)) return block("recipient_binding_mismatch");
  if (amount(r.amount) !== amount(a.amount)) return block("amount_binding_mismatch");

  const baseExact = String(r.network) === BASE && String(r.scheme) === "exact";
  const baseUsdc = baseExact && lower(r.asset) === lower(BASE_USDC);
  if (baseUsdc) {
    if (!z) return block("missing_eip3009_authorization");
    if (!isAddress(z.from)) return block("invalid_authorizer");
    if (!isAddress(z.to)) return block("invalid_authorization_recipient");
    if (!isNonce(z.nonce)) return block("invalid_authorization_nonce");
    if (!sameAddress(z.to, r.payTo)) return block("authorization_recipient_mismatch");
    if (amount(z.value) !== amount(r.amount)) return block("authorization_amount_mismatch");

    const now = Math.floor(Date.now() / 1000);
    const before = Number(z.validBefore);
    const after = Number(z.validAfter);
    if (!Number.isFinite(before) || before <= now - 10) return block("authorization_expired");
    if (!Number.isFinite(after) || after > now + 120) return block("authorization_not_yet_valid");
  }

  return {
    ok: true,
    mode: baseUsdc ? "base_usdc_strict" : "context_binding",
    network: String(r.network),
    scheme: String(r.scheme),
    payTo: String(r.payTo),
    amount: String(r.amount)
  };
}

async function inspectRequest(request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 131072) return block("body_too_large");
    const text = await request.clone().text();
    if (text.length > 131072) return block("body_too_large");
    return inspectPayment(JSON.parse(text));
  } catch {
    return block("invalid_json");
  }
}

function withPassHeaders(response, inspection) {
  const headers = new Headers(response.headers);
  headers.set("x-xguard-firewall", "pass");
  headers.set("x-xguard-firewall-mode", inspection.mode || "context_binding");
  headers.set("x-xguard-control-plane", VERSION);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function protectedFlow(request, env, ctx) {
  const inspection = await inspectRequest(request);
  if (!inspection.ok) {
    console.warn(JSON.stringify({ event: "firewall_block", path: new URL(request.url).pathname, reason: inspection.reason, detail: inspection.detail || null }));
    return json({ error: "xguard_firewall_block", reason: inspection.reason, detail: inspection.detail || undefined }, 400, { "x-xguard-firewall": "block", "x-xguard-firewall-reason": inspection.reason });
  }
  const response = await gateway.fetch(request, env, ctx);
  return withPassHeaders(response, inspection);
}

async function health(env, ctx) {
  const r = await gateway.fetch(new Request(`${API}/healthz`), env, ctx);
  const h = await r.json().catch(() => ({}));
  return {
    ...h,
    service: "XGuard Settlement Control Plane",
    version: VERSION,
    mandatory_when_configured_as_facilitator: true,
    payment_firewall: true,
    context_binding: true,
    recipient_amount_binding: true,
    authorization_window_checks: true,
    durable_replay_guard: true,
    multi_facilitator_failover: true,
    timeout_reconciliation: true,
    non_custodial: true,
    mcp: `${API}/mcp`,
    agent_card: `${API}/.well-known/agent-card.json`,
    openapi: `${API}/openapi.json`
  };
}

function docs(env) {
  return {
    name: "XGuard Settlement Control Plane",
    version: VERSION,
    facilitator_url: API,
    position: "in-path verify/settle control plane",
    mandatory_when_configured: true,
    endpoints: {
      supported: "GET /supported",
      verify: "POST /verify",
      settle: "POST /settle",
      receipt: "GET /v1/receipts/{receipt_id}",
      balance: "GET /v1/balance",
      health: "GET /healthz",
      mcp: "POST /mcp",
      openapi: "GET /openapi.json"
    },
    firewall: {
      x402_v2_validation: true,
      requirement_to_accepted_binding: ["scheme", "network", "asset", "payTo", "amount"],
      base_usdc_eip3009_binding: ["from", "to", "value", "nonce", "validAfter", "validBefore"],
      recipient_binding: true,
      amount_binding: true,
      replay_guard: "durable settlement receipts",
      fail_closed_on_binding_mismatch: true
    },
    routing: {
      health_aware: true,
      failover: true,
      base_timeout_reconciliation: true
    },
    custody: "none",
    pricing: {
      verify: "free",
      free_successful_settlements: Number(env.FREE_SETTLEMENTS || 25),
      successful_settlement_credits: Number(env.SETTLEMENT_CREDITS || 2),
      failed_settlements_charged: false,
      standalone_reconcile: "$0.002 USDC/call"
    },
    companion_paid_resource: `${RECONCILE}/v1/reconcile`
  };
}

function openapi(env) {
  return {
    openapi: "3.1.0",
    info: {
      title: "XGuard Settlement Control Plane",
      version: VERSION,
      description: "In-path x402 facilitator firewall, multi-facilitator router, durable replay guard and Base timeout reconciliation layer."
    },
    servers: [{ url: API }],
    paths: {
      "/supported": { get: { summary: "Return x402 payment kinds supported by healthy upstream facilitators", responses: { "200": { description: "Supported payment kinds" } } } },
      "/verify": { post: { summary: "Firewall-check and verify an x402 payment payload", responses: { "200": { description: "Verification result" }, "400": { description: "Blocked by XGuard payment firewall" } } } },
      "/settle": { post: { summary: "Firewall-check, route and settle an x402 payment with replay protection and reconciliation", responses: { "200": { description: "Settlement result" }, "400": { description: "Blocked by XGuard payment firewall" }, "402": { description: "XGuard usage credits required after free allowance" } } } },
      "/healthz": { get: { summary: "Control-plane and upstream health", responses: { "200": { description: "Health" } } } },
      "/v1/receipts/{receipt_id}": { get: { summary: "Read a durable XGuard settlement receipt", parameters: [{ name: "receipt_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Receipt" }, "404": { description: "Not found" } } } }
    }
  };
}

function agentCard() {
  return {
    name: "XGuard Settlement Control Plane",
    description: "Security and reliability control plane for x402 payments: context binding, facilitator failover, durable replay protection and timeout reconciliation.",
    url: `${API}/mcp`,
    version: VERSION,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      { id: "x402-health", name: "x402 payment path health", description: "Inspect XGuard and facilitator health." },
      { id: "x402-supported", name: "x402 supported payment kinds", description: "Discover payment kinds currently available through the control plane." },
      { id: "x402-receipt", name: "settlement receipt lookup", description: "Resolve a durable XGuard receipt ID." },
      { id: "x402-integration", name: "x402 control-plane integration", description: "Return drop-in facilitator integration information." }
    ]
  };
}

const mcpText = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
async function mcp(request, env, ctx) {
  let msg;
  try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const id = msg.id ?? null;
  if (msg.method === "initialize") return json({ jsonrpc: "2.0", id, result: { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "xguard-control-plane", version: VERSION } } });
  if (msg.method === "notifications/initialized") return new Response(null, { status: 204 });
  if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: [
    { name: "xguard_health", description: "Get XGuard settlement control-plane and facilitator health.", inputSchema: { type: "object", properties: {} } },
    { name: "xguard_supported", description: "Return currently supported x402 payment kinds.", inputSchema: { type: "object", properties: {} } },
    { name: "xguard_receipt", description: "Look up a durable XGuard settlement receipt.", inputSchema: { type: "object", properties: { receipt_id: { type: "string" } }, required: ["receipt_id"] } },
    { name: "xguard_integration", description: "Return integration, security controls and pricing for the XGuard in-path facilitator URL.", inputSchema: { type: "object", properties: {} } }
  ] } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    let value;
    if (name === "xguard_health") value = await health(env, ctx);
    else if (name === "xguard_supported") {
      const r = await gateway.fetch(new Request(`${API}/supported`), env, ctx);
      value = await r.json().catch(() => ({ error: "supported_unavailable" }));
    } else if (name === "xguard_receipt") {
      if (!/^xgr_[a-f0-9]{40}$/.test(String(args.receipt_id || ""))) value = { error: "invalid_receipt_id" };
      else {
        const r = await gateway.fetch(new Request(`${API}/v1/receipts/${args.receipt_id}`), env, ctx);
        value = await r.json().catch(() => ({ error: "receipt_unavailable" }));
      }
    } else if (name === "xguard_integration") value = docs(env);
    else return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
    return json({ jsonrpc: "2.0", id, result: mcpText(value) });
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

function skillMarkdown() {
  return `# XGuard Settlement Control Plane\n\nXGuard is a non-custodial in-path security and reliability layer for x402 v2 payments.\n\n## Use it when\n- an x402 resource server needs one facilitator URL with multiple settlement paths\n- payment requirements must stay bound to the accepted payload\n- Base USDC EIP-3009 recipient/value/nonce/time-window invariants must be checked before settlement\n- retries must not create duplicate settlement attempts\n- facilitator timeouts need on-chain reconciliation before a payment is declared failed\n\n## Integration\nSet the facilitator URL to: ${API}\n\n- GET /supported\n- POST /verify\n- POST /settle\n- GET /v1/receipts/{receipt_id}\n- POST /mcp\n\nVerification is free. Successful settlements have a free allowance, then use XGuard Usage Credits. Failed settlements are not charged. XGuard never takes custody of buyer or merchant funds.\n`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((url.pathname === "/verify" || url.pathname === "/settle") && request.method === "POST") return protectedFlow(request, env, ctx);
    if (url.pathname === "/healthz" && request.method === "GET") return json(await health(env, ctx));
    if (url.pathname === "/docs" && request.method === "GET") return json(docs(env));
    if (url.pathname === "/openapi.json" && request.method === "GET") return json(openapi(env), 200, { "cache-control": "public, max-age=120" });
    if ((url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json") && request.method === "GET") return json(agentCard(), 200, { "cache-control": "public, max-age=120" });
    if (url.pathname === "/skill.md" && request.method === "GET") return new Response(skillMarkdown(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=120" } });
    if (url.pathname === "/mcp" && request.method === "POST") return mcp(request, env, ctx);
    if (url.pathname === "/.well-known/x402.json" && request.method === "GET") return json({
      x402Version: 2,
      name: "XGuard Settlement Control Plane",
      facilitator: API,
      supported: `${API}/supported`,
      openapi: `${API}/openapi.json`,
      skill: `${API}/skill.md`,
      mcp: `${API}/mcp`,
      paidResources: [{ url: `${RECONCILE}/v1/reconcile`, discovery: `${RECONCILE}/.well-known/x402.json` }]
    }, 200, { "cache-control": "public, max-age=120" });
    if (url.pathname === "/llms.txt" && request.method === "GET") return new Response(`XGuard Settlement Control Plane\nFacilitator URL: ${API}\nPayment firewall: requirement/accepted binding + Base USDC EIP-3009 recipient/value/nonce/window checks\nPOST /verify\nPOST /settle\nGET /supported\nGET /v1/receipts/{receipt_id}\nPOST /mcp\nOpenAPI: ${API}/openapi.json\nAgent card: ${API}/.well-known/agent-card.json\nSkill: ${API}/skill.md\nPaid reconciliation: ${RECONCILE}/v1/reconcile\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } });
    return gateway.fetch(request, env, ctx);
  }
};
