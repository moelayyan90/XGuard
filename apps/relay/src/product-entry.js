import app from "./egress-entry.js";

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
  EgressKeyAuthority,
  EgressCredentialState,
  EgressTenantIndex,
  EgressCapabilityState,
  EgressMeter,
} from "./egress-entry.js";

const VERSION = "5.0.1";
const NAME = "xguard-secretless-agent-gateway";
const MCP = "https://api.xguardgate.com/mcp";
const API = "https://api.xguardgate.com";
const PROOFRAIL_VERSION = "1.0.0";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(value) {
  const text = String(value || "");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function proofHeaders(extra = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "x-xguard-control-plane": VERSION,
    "x-xguard-proofrail": PROOFRAIL_VERSION,
    ...extra,
  };
}

const proofJson = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: proofHeaders(headers) });

function proofAuthority(env) {
  return env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName("proofrail-root-v1"));
}

export class ProofAuthority {
  constructor(state) {
    this.state = state;
  }

  async keyRecord() {
    let record = await this.state.storage.get("key");
    if (record?.public_jwk && record?.private_jwk && record?.kid) return record;
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    record = {
      kid: `xguard-proofrail-es256-${Date.now()}`,
      public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      private_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      created_at: new Date().toISOString(),
    };
    await this.state.storage.put("key", record);
    return record;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const record = await this.keyRecord();

    if (url.pathname === "/public" && request.method === "GET") {
      return proofJson({
        name: "XGuard ProofRail",
        version: PROOFRAIL_VERSION,
        alg: "ES256",
        kid: record.kid,
        jwk: record.public_jwk,
        created_at: record.created_at,
        verify_endpoint: `${API}/v1/proofs/verify`,
      }, 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
    }

    if (url.pathname === "/sign" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return proofJson({ error: "invalid_json" }, 400); }
      const payload = body?.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return proofJson({ error: "invalid_payload" }, 400);
      const encoded = encoder.encode(JSON.stringify(payload));
      if (encoded.byteLength > 4096) return proofJson({ error: "proof_payload_too_large" }, 413);
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        record.private_jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoded);
      return proofJson({
        proof: `${b64url(encoded)}.${b64url(signature)}`,
        kid: record.kid,
        alg: "ES256",
      });
    }

    if (url.pathname === "/verify" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return proofJson({ valid: false, error: "invalid_json" }, 400); }
      const compact = String(body?.proof || "");
      const parts = compact.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return proofJson({ valid: false, error: "invalid_proof_format" }, 400);
      try {
        const payloadBytes = unb64url(parts[0]);
        if (payloadBytes.byteLength > 4096) return proofJson({ valid: false, error: "proof_payload_too_large" }, 413);
        const signature = unb64url(parts[1]);
        const publicKey = await crypto.subtle.importKey(
          "jwk",
          record.public_jwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, payloadBytes);
        let payload = null;
        try { payload = JSON.parse(decoder.decode(payloadBytes)); } catch { return proofJson({ valid: false, error: "invalid_proof_payload" }, 400); }
        return proofJson({ valid, kid: record.kid, alg: "ES256", payload: valid ? payload : null });
      } catch {
        return proofJson({ valid: false, error: "proof_verification_failed" }, 400);
      }
    }

    return proofJson({ error: "not_found" }, 404);
  }
}

const PROOFRAIL_DISCOVERY_TOOL = {
  name: "xguard_proofrail",
  description: "Discover XGuard ProofRail. Every authorized credential-backed egress response can carry an independently verifiable ES256 proof binding the XGuard capability, target origin/path, HTTP method, billing result and upstream outcome.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard ProofRail", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const PROOFRAIL_VERIFY_TOOL = {
  name: "xguard_verify_proof",
  description: "Verify an XGuard ProofRail compact ES256 proof and return its signed execution payload.",
  inputSchema: {
    type: "object",
    required: ["proof"],
    properties: { proof: { type: "string", description: "Compact proof returned in the x-xguard-proof header." } },
  },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "Verify XGuard Proof", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function proofrailManifest() {
  return {
    name: "XGuard ProofRail",
    version: PROOFRAIL_VERSION,
    role: "signed execution proof layer for XGuard Secretless Egress",
    proof_header: "x-xguard-proof",
    key_id_header: "x-xguard-proof-kid",
    algorithm: "ES256",
    public_key: `${API}/.well-known/xguard-proof-key.json`,
    verify: `${API}/v1/proofs/verify`,
    generated_when: "an authorized Secretless Egress attempt has committed billing and reaches an upstream response, or returns a post-billing ambiguous network outcome",
    signed_fields: ["proof_id", "capability_id", "target_origin", "target_path", "method", "outcome", "upstream_status", "billed_credits", "issued_at"],
    security_boundary: "The proof does not contain the reusable upstream credential, the XGuard Usage Credit key, request headers, query parameters or request body.",
  };
}

async function signProof(env, payload) {
  try {
    const response = await proofAuthority(env).fetch("https://proofrail/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function verifyProof(env, proof) {
  try {
    const response = await proofAuthority(env).fetch("https://proofrail/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    return { status: response.status, data: await response.json().catch(() => ({ valid: false, error: "verification_unavailable" })) };
  } catch {
    return { status: 503, data: { valid: false, error: "verification_unavailable" } };
  }
}

async function attachProof(requestSnapshot, response, env) {
  if (!(response instanceof Response) || !requestSnapshot || !env.PROOF_AUTHORITY) return response;
  const billedCredits = response.headers.get("x-xguard-billed-credits");
  const ambiguous = response.headers.get("x-xguard-egress-state") === "ambiguous";
  if (billedCredits == null && !ambiguous) return response;

  let body;
  try { body = await requestSnapshot.json(); } catch { return response; }
  let target;
  try { target = new URL(String(body?.target || "")); } catch { return response; }
  if (target.protocol !== "https:") return response;

  const capabilityId = response.headers.get("x-xguard-egress-capability") || null;
  const upstreamStatusRaw = response.headers.get("x-xguard-upstream-status");
  const billedRaw = billedCredits == null ? null : Number(billedCredits);
  const payload = {
    v: 1,
    typ: "xguard-proofrail-egress",
    iss: API,
    proof_id: `xgp_${crypto.randomUUID().replaceAll("-", "")}`,
    capability_id: capabilityId,
    target_origin: target.origin,
    target_path: target.pathname,
    method: String(body?.method || "GET").toUpperCase(),
    outcome: ambiguous ? "network_outcome_ambiguous" : "upstream_response",
    upstream_status: upstreamStatusRaw == null ? null : Number(upstreamStatusRaw),
    billed_credits: Number.isFinite(billedRaw) ? billedRaw : null,
    issued_at: new Date().toISOString(),
  };
  const signed = await signProof(env, payload);
  if (!signed?.proof) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-proof", signed.proof);
  headers.set("x-xguard-proof-kid", signed.kid);
  headers.set("x-xguard-proof-alg", signed.alg || "ES256");
  headers.set("x-xguard-proofrail", PROOFRAIL_VERSION);
  headers.set("access-control-expose-headers", [
    headers.get("access-control-expose-headers") || "",
    "x-xguard-proof",
    "x-xguard-proof-kid",
    "x-xguard-proof-alg",
    "x-xguard-proofrail",
    "x-xguard-billed-credits",
    "x-xguard-upstream-status",
  ].filter(Boolean).join(", "));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function mcpMessage(snapshot) {
  if (!snapshot) return null;
  try { return await snapshot.clone().json(); } catch { return null; }
}

function mcpResult(id, data) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    },
  }), { status: 200, headers: proofHeaders() });
}

async function handleProofMcp(snapshot, env) {
  const message = await mcpMessage(snapshot);
  if (!message || message.method !== "tools/call") return null;
  const name = message?.params?.name;
  if (name === PROOFRAIL_DISCOVERY_TOOL.name) return mcpResult(message.id, proofrailManifest());
  if (name === PROOFRAIL_VERIFY_TOOL.name) {
    const result = await verifyProof(env, message?.params?.arguments?.proof);
    return mcpResult(message.id, result.data);
  }
  return null;
}

async function improveMcp(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;
  const message = await mcpMessage(snapshot);
  if (!message) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.result) return response;

  if (message.method === "initialize") {
    body.result.serverInfo = { ...(body.result.serverInfo || {}), name: NAME, version: VERSION };
    body.result.instructions = `XGuard Secretless Agent Gateway keeps reusable upstream API credentials outside AI agent context. Operators provision encrypted credentials and scoped capabilities; agents use xguard_egress_fetch. When an operator keeps the reusable credential exclusively in XGuard instead of distributing it to agents, XGuard becomes the required credential-backed egress path for that agent environment. ProofRail adds an ES256-signed proof to authorized credential-backed egress outcomes so callers can verify the enforced path without seeing the secret. Canonical remote MCP endpoint: ${MCP}. XGuard Action Rail, x402 facilitator routing, receipts and inspection remain available as compatibility capabilities.`;
  }

  if (message.method === "tools/list" && Array.isArray(body.result.tools)) {
    if (!body.result.tools.some(tool => tool?.name === PROOFRAIL_VERIFY_TOOL.name)) body.result.tools.unshift(PROOFRAIL_VERIFY_TOOL);
    if (!body.result.tools.some(tool => tool?.name === PROOFRAIL_DISCOVERY_TOOL.name)) body.result.tools.unshift(PROOFRAIL_DISCOVERY_TOOL);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-canonical-mcp", MCP);
  headers.set("x-xguard-control-plane", VERSION);
  headers.set("x-xguard-primary-product", "secretless-egress");
  headers.set("x-xguard-proofrail", PROOFRAIL_VERSION);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

async function injectProofRailSite(response) {
  if (!(response instanceof Response) || !response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return response;
  const html = await response.clone().text();
  if (html.includes('id="proofrail"') || !html.includes('<section class="final">')) return response;
  const section = `<section class="section" id="proofrail"><span class="kicker">ProofRail · signed execution evidence</span><h2>A credential-backed action can now prove it passed through XGuard.</h2><p class="intro">Every authorized Secretless Egress outcome can carry an ES256-signed compact proof. The signed payload binds the scoped capability, public target origin and path, HTTP method, billed Usage Credits and upstream outcome—without exposing the reusable credential, request headers, query parameters or body.</p><div class="proof"><div class="metric"><strong>ES256</strong><span>Publicly verifiable signature.</span></div><div class="metric"><strong>0 secrets</strong><span>No reusable credential inside the proof.</span></div><div class="metric"><strong>1 path</strong><span>Capability + billing + execution evidence.</span></div><div class="metric"><strong>Machine-verifiable</strong><span>Public JWK and verification endpoint.</span></div></div><div class="buttons"><a class="btn primary" href="${API}/v1/proof">Inspect ProofRail →</a><a class="btn secondary" href="${API}/.well-known/xguard-proof-key.json">Public proof key</a></div></section>`;
  const next = html.replace('<section class="final">', `${section}<section class="final">`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(next, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/v1/proof" && request.method === "GET") return proofJson(proofrailManifest(), 200, { "access-control-allow-origin": "*" });
    if (url.pathname === "/.well-known/xguard-proof-key.json" && request.method === "GET") {
      if (!env.PROOF_AUTHORITY) return proofJson({ error: "proof_authority_unavailable" }, 503);
      return proofAuthority(env).fetch("https://proofrail/public");
    }
    if (url.pathname === "/v1/proofs/verify" && request.method === "POST") {
      if (!env.PROOF_AUTHORITY) return proofJson({ valid: false, error: "proof_authority_unavailable" }, 503);
      let body;
      try { body = await request.json(); } catch { return proofJson({ valid: false, error: "invalid_json" }, 400); }
      const result = await verifyProof(env, body?.proof);
      return proofJson(result.data, result.status, { "access-control-allow-origin": "*" });
    }

    const snapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;
    const proofMcp = await handleProofMcp(snapshot, env);
    if (proofMcp) return proofMcp;

    const egressSnapshot = url.pathname === "/v1/egress/fetch" && request.method === "POST" ? request.clone() : null;
    let response = await app.fetch(request, env, ctx);
    if (egressSnapshot) response = await attachProof(egressSnapshot, response, env);
    if (snapshot) response = await improveMcp(snapshot, response);
    if (url.hostname === "xguardgate.com" && url.pathname === "/" && request.method === "GET") response = await injectProofRailSite(response);
    return response;
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
