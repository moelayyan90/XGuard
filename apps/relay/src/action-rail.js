import { consumeMandate } from "./authority.js";

const VERSION = "1.0.0";
const API = "https://api.xguardgate.com";
const DEFAULT_CREDITS = 1;
const MAX_BODY_BYTES = 1024 * 1024;
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-action-rail": VERSION,
    ...headers,
  },
});

const low = value => String(value ?? "").toLowerCase();
const intString = value => /^\d+$/.test(String(value ?? "")) ? String(value) : null;

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

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function privateHost(hostname) {
  const host = low(hostname).replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return true;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function keyOf(request) {
  return String(request.headers.get("x-xguard-key") || "").trim();
}

function mandateOf(request) {
  return String(request.headers.get("x-xguard-mandate") || "").trim();
}

function billingUrl(env) {
  return String(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com").replace(/\/$/, "");
}

function executionCredits(env) {
  return Math.max(1, Math.trunc(Number(env.ACTION_EXECUTION_CREDITS || DEFAULT_CREDITS)));
}

async function billingBalance(env, key) {
  if (!key) return { ok: false, status: 401, credits: 0 };
  try {
    const response = await fetch(`${billingUrl(env)}/v1/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      credits: Number(data?.credits ?? data?.balance ?? 0),
      data,
    };
  } catch {
    return { ok: false, status: 503, credits: 0 };
  }
}

async function consumeCredits(env, key, units, idempotencyKey) {
  try {
    const response = await fetch(`${billingUrl(env)}/v1/consume`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ units }),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 503 };
  }
}

function inferAction(target, method, explicit = "") {
  const value = low(explicit).trim();
  if (value) return value;
  const path = low(target.pathname);
  if (/deploy|release|publish/.test(path)) return "deploy";
  if (/message|email|mail|notify|notification|send/.test(path)) return "message";
  if (/book|booking|reserve|reservation/.test(path)) return "booking";
  if (/purchase|buy|checkout/.test(path)) return "purchase";
  if (/payment|pay|charge|transfer|settle/.test(path)) return "payment";
  if (method === "DELETE" || /delete|remove|revoke/.test(path)) return "delete";
  if (/tool|invoke|execute|run/.test(path)) return "tool_call";
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "update";
  return "external_action";
}

function validLabel(value) {
  return /^[a-z][a-z0-9_.:-]{1,63}$/.test(String(value || ""));
}

function canonicalPermit(permit) {
  return JSON.stringify([
    String(permit.id || ""),
    String(permit.version || ""),
    String(permit.action || ""),
    String(permit.protocol || ""),
    String(permit.target || ""),
    String(permit.method || "").toUpperCase(),
    String(permit.request_hash || ""),
    String(permit.amount_minor || ""),
    String(permit.currency || "").toUpperCase(),
    String(permit.agent_id || ""),
    String(permit.authorization_id || ""),
    String(permit.license_hash || ""),
    String(permit.credits || ""),
    String(permit.issued_at || ""),
    String(permit.expires_at || ""),
  ]);
}

function keyStub(env) {
  return env.ACTION_KEYS.get(env.ACTION_KEYS.idFromName("root-v1"));
}

function permitStub(env, id) {
  return env.ACTION_PERMITS.get(env.ACTION_PERMITS.idFromName(String(id)));
}

function meterStub(env) {
  return env.ACTION_METER.get(env.ACTION_METER.idFromName("meter-v1"));
}

async function issueSignature(env, permit) {
  const response = await keyStub(env).fetch("https://action-key/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit }),
  });
  if (!response.ok) throw new Error("action_signing_unavailable");
  return response.json();
}

async function verifySignature(env, permit, signature) {
  const response = await keyStub(env).fetch("https://action-key/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature }),
  });
  return response.ok;
}

function sanitizeHeaders(input = {}) {
  const headers = new Headers();
  const blocked = new Set([
    "host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization",
    "proxy-authenticate", "te", "trailer", "keep-alive", "x-forwarded-for", "x-forwarded-host",
    "x-forwarded-proto", "cf-connecting-ip", "cf-ray", "cf-visitor", "x-xguard-key",
    "x-xguard-mandate", "x-xguard-action-permit", "x-xguard-action-signature",
  ]);
  for (const [name, value] of Object.entries(input || {})) {
    const key = low(name);
    if (!blocked.has(key) && !key.startsWith("cf-")) headers.set(name, String(value));
  }
  return headers;
}

function serializedRequestBody(body) {
  return JSON.stringify(body ?? null);
}

function observedFrom(permit, requestHash) {
  return {
    action: String(permit.action || ""),
    protocol: String(permit.protocol || ""),
    target: String(permit.target || ""),
    method: String(permit.method || "").toUpperCase(),
    request_hash: String(requestHash || ""),
    amount_minor: String(permit.amount_minor || ""),
    currency: String(permit.currency || "").toUpperCase(),
    license_hash: String(permit.license_hash || ""),
  };
}

function discovery(env) {
  const units = executionCredits(env);
  return {
    name: "XGuard Action Rail",
    version: VERSION,
    role: "protocol-neutral execution control plane for AI side effects",
    guarantee: "Every action executed through XGuard Action Rail requires a scoped mandate and a cryptographically signed, request-bound, single-use permit.",
    permit: `POST ${API}/v1/actions/permits`,
    execute: `POST ${API}/v1/actions/execute`,
    status: `GET ${API}/v1/actions/permits/{permit_id}`,
    pricing: `GET ${API}/v1/actions/pricing`,
    stats: `GET ${API}/v1/actions/stats`,
    public_key: `${API}/.well-known/xguard-actions-key.json`,
    credits_per_successful_execution: units,
    billing: "Usage Credits are checked before execution and consumed only after a successful 2xx/3xx upstream result.",
    controls: [
      "delegated mandate",
      "merchant and action allowlists",
      "budget and daily limits",
      "cryptographic permit signature",
      "target/method/action/request binding",
      "single-use execution",
      "automatic Idempotency-Key injection",
      "replay rejection",
      "expiry and revocation",
      "fail-closed ambiguous state",
      "durable execution receipt",
    ],
    protocols: ["http", "mcp", "x402", "mpp", "ap2", "acp", "ucp", "tap", "custom"],
    typical_actions: ["payment", "purchase", "booking", "message", "deploy", "delete", "create", "update", "tool_call", "external_action"],
    custody: "none",
    boundary: "XGuard is mandatory only for traffic an operator routes through the Action Rail; it does not claim control over unrelated Internet traffic.",
  };
}

async function createPermit(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

  let target;
  try { target = new URL(String(body?.target || "")); } catch { return json({ error: "invalid_target" }, 400); }
  if (target.protocol !== "https:" || target.username || target.password || privateHost(target.hostname)) {
    return json({ error: "public_https_target_required" }, 400);
  }

  const method = String(body?.method || "POST").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return json({ error: "side_effect_method_required" }, 400);

  const action = inferAction(target, method, body?.action);
  if (!validLabel(action)) return json({ error: "invalid_action" }, 400);
  const protocol = low(body?.protocol || "http");
  if (!validLabel(protocol)) return json({ error: "invalid_protocol" }, 400);

  const amount = body?.amount_minor == null ? "0" : intString(body.amount_minor);
  if (amount === null) return json({ error: "amount_minor_must_be_integer" }, 400);
  const currency = String(body?.currency || "USD").toUpperCase();
  if (!/^[A-Z0-9:*_-]{2,64}$/.test(currency)) return json({ error: "invalid_currency" }, 400);

  const serialized = serializedRequestBody(body?.request_body);
  if (enc.encode(serialized).byteLength > MAX_BODY_BYTES) return json({ error: "request_body_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  const requestHash = await sha256(serialized);

  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required", checkout_url: env.XGUARD_CHECKOUT_URL || null }, 401);
  const units = executionCredits(env);
  const balance = await billingBalance(env, key);
  if (!balance.ok) return json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable" }, balance.status === 404 ? 401 : 503);
  if (balance.credits < units) return json({ error: "insufficient_xguard_credits", credits: balance.credits, required: units, checkout_url: env.XGUARD_CHECKOUT_URL || null }, 402);

  const mandate = mandateOf(request);
  if (!mandate) {
    return json({
      error: "xguard_mandate_required",
      create_mandate: `POST ${API}/v1/mandates`,
      required_header: "X-XGuard-Mandate",
    }, 428, { "x-xguard-policy": "action-mandate-required" });
  }

  const authorization = await consumeMandate(env, mandate, {
    merchant: target.hostname,
    action,
    currency,
    amount_minor: amount,
  });
  if (!authorization.ok) {
    return json({ error: authorization.error || "mandate_denied", ...authorization }, authorization.status || 403, { "x-xguard-policy": "action-mandate-denied" });
  }

  const now = Date.now();
  const ttlSeconds = Math.max(15, Math.min(600, Math.trunc(Number(body?.ttl_seconds || 120))));
  const permit = {
    id: `xap_${crypto.randomUUID().replaceAll("-", "")}`,
    version: VERSION,
    action,
    protocol,
    target: target.toString(),
    method,
    request_hash: requestHash,
    amount_minor: amount,
    currency,
    agent_id: String(authorization.agent_id || body?.agent_id || "agent"),
    authorization_id: String(authorization.authorization_id || ""),
    license_hash: await sha256(key),
    credits: String(units),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
  };

  let signed;
  try { signed = await issueSignature(env, permit); } catch { return json({ error: "action_signing_unavailable" }, 503); }
  const stored = await permitStub(env, permit.id).fetch("https://action-permit/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature: signed.signature }),
  });
  if (!stored.ok) return json({ error: "action_permit_state_unavailable" }, 503);

  return json({
    permit,
    signature: signed.signature,
    signature_algorithm: "ECDSA_P256_SHA256",
    public_key: `${API}/.well-known/xguard-actions-key.json`,
    execute: `${API}/v1/actions/execute`,
    status: `${API}/v1/actions/permits/${permit.id}`,
  }, 201, { "x-xguard-action-permit": permit.id });
}

async function execute(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const permit = body?.permit;
  const signature = String(body?.signature || "");
  if (!permit?.id || !signature) return json({ error: "permit_and_signature_required" }, 400);

  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required" }, 401);
  if (await sha256(key) !== String(permit.license_hash || "")) return json({ error: "license_binding_mismatch" }, 403);

  const units = Math.max(1, Number(permit.credits || executionCredits(env)));
  const balance = await billingBalance(env, key);
  if (!balance.ok) return json({ error: "billing_unavailable" }, 503);
  if (balance.credits < units) return json({ error: "insufficient_xguard_credits", credits: balance.credits, required: units, checkout_url: env.XGUARD_CHECKOUT_URL || null }, 402);

  const serialized = serializedRequestBody(body?.request_body);
  if (enc.encode(serialized).byteLength > MAX_BODY_BYTES) return json({ error: "request_body_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  const requestHash = await sha256(serialized);
  const observed = observedFrom(permit, requestHash);

  const begin = await permitStub(env, permit.id).fetch("https://action-permit/begin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature, observed }),
  });
  const began = await begin.json().catch(() => ({ error: "action_permit_unavailable" }));
  if (!begin.ok) return json(began, begin.status);

  const headers = sanitizeHeaders(body?.headers || {});
  headers.set("x-xguard-action-permit", permit.id);
  headers.set("x-xguard-authorization-id", String(permit.authorization_id || ""));
  headers.set("x-xguard-action", String(permit.action || "external_action"));
  headers.set("x-xguard-protocol", String(permit.protocol || "http"));
  if (!headers.has("idempotency-key")) headers.set("idempotency-key", permit.id);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

  let upstream;
  try {
    upstream = await fetch(String(permit.target), {
      method: String(permit.method || "POST").toUpperCase(),
      headers,
      body: serialized,
      redirect: "manual",
    });
  } catch (error) {
    await permitStub(env, permit.id).fetch("https://action-permit/ambiguous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ execution_id: began.execution_id, error: String(error?.message || error) }),
    });
    return json({
      error: "execution_ambiguous",
      permit_id: permit.id,
      message: "The upstream outcome is unknown. XGuard will not replay this single-use action automatically.",
    }, 503, { "x-xguard-action-state": "ambiguous" });
  }

  if (upstream.status >= 500) {
    await permitStub(env, permit.id).fetch("https://action-permit/ambiguous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ execution_id: began.execution_id, error: `upstream_http_${upstream.status}` }),
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("x-xguard-action-permit", permit.id);
    responseHeaders.set("x-xguard-action-state", "ambiguous");
    responseHeaders.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  }

  const successful = upstream.status >= 200 && upstream.status < 400;
  let billed = false;
  let billingStatus = "not_chargeable";
  if (successful) {
    const charge = await consumeCredits(env, key, units, `xguard-action:${began.execution_id}`);
    billed = charge.ok;
    billingStatus = charge.ok ? "consumed" : `consume_failed_${charge.status}`;
  }

  const finish = await permitStub(env, permit.id).fetch("https://action-permit/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      execution_id: began.execution_id,
      upstream_status: upstream.status,
      successful,
      billed,
      billing_status: billingStatus,
      credits: successful ? units : 0,
    }),
  });
  const finished = await finish.json().catch(() => ({}));

  const outputHeaders = new Headers(upstream.headers);
  outputHeaders.set("x-xguard-action-permit", permit.id);
  outputHeaders.set("x-xguard-action-receipt", String(finished.receipt_id || ""));
  outputHeaders.set("x-xguard-action-state", successful ? "executed" : "failed");
  outputHeaders.set("x-xguard-billing-state", billingStatus);
  outputHeaders.set("x-xguard-credits-consumed", billed ? String(units) : "0");
  outputHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outputHeaders });
}

async function permitStatus(request, env) {
  const id = new URL(request.url).pathname.split("/").pop() || "";
  if (!/^xap_[a-f0-9]{32}$/i.test(id)) return json({ error: "invalid_action_permit_id" }, 400);
  const response = await permitStub(env, id).fetch("https://action-permit/status");
  return json(await response.json().catch(() => ({ error: "action_permit_unavailable" })), response.status);
}

export class ActionKeyAuthority {
  constructor(state) { this.state = state; }

  async keys() {
    let record = await this.state.storage.get("keys");
    if (record) return record;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    record = {
      private_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      created_at: new Date().toISOString(),
      kid: `xguard-actions-p256-${Date.now()}`,
    };
    await this.state.storage.put("keys", record);
    return record;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const record = await this.keys();
    if (path === "/public") {
      return json({ kty: "EC", alg: "ES256", use: "sig", kid: record.kid, jwk: record.public_jwk, created_at: record.created_at }, 200, { "cache-control": "public, max-age=300" });
    }
    if (path === "/sign" && request.method === "POST") {
      const body = await request.json();
      const privateKey = await crypto.subtle.importKey("jwk", record.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(canonicalPermit(body?.permit || {})));
      return json({ signature: b64url(signature), kid: record.kid });
    }
    if (path === "/verify" && request.method === "POST") {
      const body = await request.json();
      let signature;
      try { signature = unb64url(body?.signature || ""); } catch { return json({ valid: false }, 400); }
      const publicKey = await crypto.subtle.importKey("jwk", record.public_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, enc.encode(canonicalPermit(body?.permit || {})));
      return json({ valid }, valid ? 200 : 403);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class ActionMeter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/record" && request.method === "POST") {
      const body = await request.json();
      let result;
      await this.state.storage.transaction(async txn => {
        const record = (await txn.get("meter")) || {
          successful_executions: 0,
          failed_executions: 0,
          ambiguous_executions: 0,
          billed_executions: 0,
          billing_failures: 0,
          credits_consumed: 0,
          updated_at: null,
        };
        if (body?.ambiguous) record.ambiguous_executions += 1;
        if (body?.successful) record.successful_executions += 1;
        if (body?.failed) record.failed_executions += 1;
        if (body?.billed) {
          record.billed_executions += 1;
          record.credits_consumed += Number(body?.credits || 0);
        }
        if (body?.billing_failure) record.billing_failures += 1;
        record.updated_at = new Date().toISOString();
        await txn.put("meter", record);
        result = record;
      });
      return json(result);
    }
    if (path === "/stats") {
      const record = (await this.state.storage.get("meter")) || {
        successful_executions: 0,
        failed_executions: 0,
        ambiguous_executions: 0,
        billed_executions: 0,
        billing_failures: 0,
        credits_consumed: 0,
        updated_at: null,
      };
      return json(record);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class ActionPermitState {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      const existing = await this.state.storage.get("record");
      if (existing) return json({ error: "action_permit_exists" }, 409);
      const body = await request.json();
      if (!body?.permit?.id || !body?.signature) return json({ error: "invalid_action_permit" }, 400);
      await this.state.storage.put("record", { permit: body.permit, signature: body.signature, status: "issued", created_at: new Date().toISOString() });
      return json({ ok: true });
    }

    let record = await this.state.storage.get("record");
    if (!record) return json({ error: "action_permit_not_found" }, 404);

    if (path === "/status") {
      if (record.status === "issued" && Date.now() >= Date.parse(record.permit.expires_at)) {
        record.status = "expired";
        await this.state.storage.put("record", record);
      }
      return json({
        permit_id: record.permit.id,
        action: record.permit.action,
        protocol: record.permit.protocol,
        target: record.permit.target,
        status: record.status,
        expires_at: record.permit.expires_at,
        executed_at: record.executed_at || null,
        upstream_status: record.upstream_status ?? null,
        receipt_id: record.receipt_id || null,
        billed: Boolean(record.billed),
        credits_consumed: record.billed ? Number(record.credits || 0) : 0,
      });
    }

    if (path === "/begin" && request.method === "POST") {
      const body = await request.json();
      if (body?.permit?.id !== record.permit.id || body?.signature !== record.signature) return json({ error: "action_permit_mismatch" }, 403);
      if (!(await verifySignature(this.env, body.permit, body.signature))) return json({ error: "invalid_action_permit_signature" }, 403);
      if (Date.now() >= Date.parse(record.permit.expires_at)) {
        record.status = "expired";
        await this.state.storage.put("record", record);
        return json({ error: "action_permit_expired" }, 410);
      }

      const expected = {
        action: String(record.permit.action || ""),
        protocol: String(record.permit.protocol || ""),
        target: String(record.permit.target || ""),
        method: String(record.permit.method || "").toUpperCase(),
        request_hash: String(record.permit.request_hash || ""),
        amount_minor: String(record.permit.amount_minor || ""),
        currency: String(record.permit.currency || "").toUpperCase(),
        license_hash: String(record.permit.license_hash || ""),
      };
      const observed = body?.observed || {};
      for (const field of Object.keys(expected)) {
        const actual = String(observed[field] ?? "");
        if (actual !== expected[field]) return json({ error: "action_permit_binding_mismatch", field, expected: expected[field], observed: actual }, 409);
      }

      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.status !== "issued") {
          result = { status: 409, body: { error: current.status === "executed" ? "action_replay_detected" : "action_permit_not_executable", state: current.status, receipt_id: current.receipt_id || null } };
          return;
        }
        const executionId = `xae_${crypto.randomUUID().replaceAll("-", "")}`;
        current.status = "executing";
        current.execution_id = executionId;
        current.execution_started_at = new Date().toISOString();
        await txn.put("record", current);
        result = { status: 200, body: { ok: true, execution_id: executionId, permit_id: current.permit.id } };
      });
      return json(result.body, result.status);
    }

    if (path === "/finish" && request.method === "POST") {
      const body = await request.json();
      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.status !== "executing" || body?.execution_id !== current.execution_id) {
          result = { status: 409, body: { error: "action_execution_state_mismatch", state: current.status } };
          return;
        }
        const receiptId = `xar_${(await sha256(`${current.permit.id}|${current.execution_id}|${Date.now()}`)).slice(0, 40)}`;
        current.status = body?.successful ? "executed" : "failed";
        current.executed_at = new Date().toISOString();
        current.upstream_status = Number(body?.upstream_status || 0);
        current.billed = Boolean(body?.billed);
        current.billing_status = String(body?.billing_status || "unknown");
        current.credits = Number(body?.credits || 0);
        current.receipt_id = receiptId;
        await txn.put("record", current);
        result = { status: 200, body: { ok: true, permit_id: current.permit.id, receipt_id: receiptId, state: current.status, upstream_status: current.upstream_status, billed: current.billed, credits_consumed: current.billed ? current.credits : 0 } };
      });
      if (result.status === 200) {
        await meterStub(this.env).fetch("https://action-meter/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            successful: result.body.state === "executed",
            failed: result.body.state === "failed",
            billed: result.body.billed,
            billing_failure: result.body.state === "executed" && !result.body.billed,
            credits: result.body.credits_consumed,
          }),
        }).catch(() => null);
      }
      return json(result.body, result.status);
    }

    if (path === "/ambiguous" && request.method === "POST") {
      const body = await request.json();
      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.status !== "executing" || body?.execution_id !== current.execution_id) {
          result = { status: 409, body: { error: "action_execution_state_mismatch", state: current.status } };
          return;
        }
        current.status = "ambiguous";
        current.ambiguous_at = new Date().toISOString();
        current.last_error = String(body?.error || "upstream_unknown").slice(0, 300);
        await txn.put("record", current);
        result = { status: 200, body: { ok: true, permit_id: current.permit.id, state: "ambiguous" } };
      });
      if (result.status === 200) {
        await meterStub(this.env).fetch("https://action-meter/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ambiguous: true }),
        }).catch(() => null);
      }
      return json(result.body, result.status);
    }

    return json({ error: "not_found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if ((path === "/v1/actions" || path === "/.well-known/xguard-actions.json") && (request.method === "GET" || request.method === "HEAD")) {
      const response = json(discovery(env), 200, { "cache-control": "public, max-age=120" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === "/.well-known/xguard-actions-key.json" && (request.method === "GET" || request.method === "HEAD")) {
      const response = await keyStub(env).fetch("https://action-key/public");
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === "/v1/actions/pricing" && request.method === "GET") {
      return json({ credits_per_successful_execution: executionCredits(env), failed_executions: "free", ambiguous_executions: "free", collection: "XGuard Usage Credits consumed after successful upstream execution" });
    }
    if (path === "/v1/actions/stats" && request.method === "GET") return meterStub(env).fetch("https://action-meter/stats");
    if (path === "/v1/actions/permits" && request.method === "POST") return createPermit(request, env);
    if (path === "/v1/actions/execute" && request.method === "POST") return execute(request, env);
    if (path.startsWith("/v1/actions/permits/") && request.method === "GET") return permitStatus(request, env);

    return null;
  },
};
