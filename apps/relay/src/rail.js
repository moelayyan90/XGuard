import { consumeMandate } from "./authority.js";

const VERSION = "0.1.0";
const API = "https://api.xguardgate.com";
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-rail": VERSION,
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
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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

function canonicalPermit(permit) {
  return JSON.stringify([
    String(permit.id || ""),
    String(permit.version || ""),
    String(permit.target || ""),
    String(permit.method || "").toUpperCase(),
    String(permit.amount_minor || ""),
    String(permit.currency || "").toUpperCase(),
    String(permit.asset || ""),
    low(permit.pay_to),
    String(permit.request_hash || ""),
    String(permit.agent_id || ""),
    String(permit.authorization_id || ""),
    String(permit.issued_at || ""),
    String(permit.expires_at || ""),
    String(permit.fee_usd_micros || ""),
  ]);
}

function keyStub(env) {
  return env.RAIL_KEYS.get(env.RAIL_KEYS.idFromName("root-v1"));
}

function permitStub(env, id) {
  return env.RAIL_PERMITS.get(env.RAIL_PERMITS.idFromName(String(id)));
}

function meterStub(env) {
  return env.RAIL_METER.get(env.RAIL_METER.idFromName("meter-v1"));
}

async function issueSignature(env, permit) {
  const response = await keyStub(env).fetch("https://rail-key/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit }),
  });
  if (!response.ok) throw new Error("rail_signing_unavailable");
  return response.json();
}

async function verifySignature(env, permit, signature) {
  const response = await keyStub(env).fetch("https://rail-key/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature }),
  });
  return response.ok;
}

function mandateToken(request) {
  return String(request.headers.get("x-xguard-mandate") || "").trim();
}

function sanitizeHeaders(input = {}) {
  const headers = new Headers();
  const blocked = new Set([
    "host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization",
    "proxy-authenticate", "te", "trailer", "keep-alive", "x-forwarded-for", "x-forwarded-host",
    "x-forwarded-proto", "cf-connecting-ip", "cf-ray", "cf-visitor", "x-xguard-mandate",
    "x-xguard-amount-minor", "x-xguard-currency",
  ]);
  for (const [name, value] of Object.entries(input || {})) {
    const key = low(name);
    if (!blocked.has(key) && !key.startsWith("cf-")) headers.set(name, String(value));
  }
  return headers;
}

function discovery(env) {
  const fee = Math.max(0, Math.trunc(Number(env.RAIL_FEE_USD_MICROS || 1000)));
  return {
    name: "XGuard Mandatory Settlement Rail",
    version: VERSION,
    role: "in-path execution rail for agent financial transactions",
    guarantee: "A transaction executed through the rail requires a valid, unexpired, single-use XGuard permit and cannot be replayed through the rail.",
    permit: `POST ${API}/v1/rail/permits`,
    execute: `POST ${API}/v1/rail/execute`,
    consume: `POST ${API}/v1/rail/consume`,
    pricing: `GET ${API}/v1/rail/pricing`,
    stats: `GET ${API}/v1/rail/stats`,
    public_key: `${API}/.well-known/xguard-rail-key.json`,
    fee_usd_micros_per_chargeable_execution: fee,
    fee_usd: fee / 1_000_000,
    state_machine: ["issued", "executing", "executed", "ambiguous", "expired"],
    controls: ["delegated spend mandate", "cryptographic permit signature", "request binding", "single-use execution", "replay rejection", "expiry", "fail-closed ambiguous state", "durable fee metering"],
    custody: "none",
    note: "Mandatory means mandatory inside XGuard Rail transactions; XGuard does not claim control over unrelated x402 traffic.",
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
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return json({ error: "financial_method_required" }, 400);

  const amount = intString(body?.amount_minor);
  if (amount === null) return json({ error: "amount_minor_required_integer" }, 400);

  const currency = String(body?.currency || "USD").toUpperCase();
  if (!/^[A-Z0-9:_-]{2,64}$/.test(currency)) return json({ error: "invalid_currency" }, 400);

  const payTo = String(body?.pay_to || body?.payTo || "").trim();
  if (!payTo || payTo.length > 256) return json({ error: "pay_to_required" }, 400);

  const asset = String(body?.asset || "").trim();
  const ttlSeconds = Math.max(15, Math.min(600, Math.trunc(Number(body?.ttl_seconds || 120))));
  const requestHash = /^[a-f0-9]{64}$/i.test(String(body?.request_hash || ""))
    ? low(body.request_hash)
    : await sha256(JSON.stringify(body?.request_body ?? null));

  const mandate = mandateToken(request);
  if (!mandate) {
    return json({
      error: "xguard_mandate_required",
      message: "XGuard Rail permits are issued only under a scoped XGuard delegated-spend mandate.",
      create_mandate: `POST ${API}/v1/mandates`,
      required_header: "X-XGuard-Mandate",
    }, 428, { "x-xguard-policy": "rail-mandate-required" });
  }

  const authorization = await consumeMandate(env, mandate, {
    merchant: target.hostname,
    action: "settle",
    currency,
    amount_minor: amount,
  });
  if (!authorization.ok) {
    return json({ error: authorization.error || "mandate_denied", ...authorization }, authorization.status || 403, { "x-xguard-policy": "rail-mandate-denied" });
  }

  const now = Date.now();
  const fee = Math.max(0, Math.trunc(Number(env.RAIL_FEE_USD_MICROS || 1000)));
  const permit = {
    id: `xrp_${crypto.randomUUID().replaceAll("-", "")}`,
    version: VERSION,
    target: target.toString(),
    method,
    amount_minor: amount,
    currency,
    asset,
    pay_to: payTo,
    request_hash: requestHash,
    agent_id: String(authorization.agent_id || body?.agent_id || "agent"),
    authorization_id: String(authorization.authorization_id || ""),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
    fee_usd_micros: String(fee),
  };

  const signed = await issueSignature(env, permit);
  const state = await permitStub(env, permit.id).fetch("https://permit/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature: signed.signature }),
  });
  if (!state.ok) return json({ error: "permit_state_unavailable" }, 503);

  return json({
    permit,
    signature: signed.signature,
    signature_algorithm: "ECDSA_P256_SHA256",
    public_key: `${API}/.well-known/xguard-rail-key.json`,
    execute: `${API}/v1/rail/execute`,
    consume: `${API}/v1/rail/consume`,
  }, 201, { "x-xguard-permit-id": permit.id });
}

function observedFrom(permit, requestBody) {
  return {
    target: String(permit.target || ""),
    method: String(permit.method || "").toUpperCase(),
    amount_minor: String(permit.amount_minor || ""),
    currency: String(permit.currency || "").toUpperCase(),
    pay_to: String(permit.pay_to || ""),
    request_hash: requestBody,
  };
}

async function beginPermit(env, permit, signature, observed) {
  return permitStub(env, permit?.id || "invalid").fetch("https://permit/begin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permit, signature, observed }),
  });
}

async function consumeOnly(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const permit = body?.permit;
  const signature = String(body?.signature || "");
  if (!permit?.id || !signature) return json({ error: "permit_and_signature_required" }, 400);
  const observed = body?.observed || {};
  const response = await beginPermit(env, permit, signature, observed);
  const data = await response.json().catch(() => ({ error: "permit_unavailable" }));
  if (!response.ok) return json(data, response.status);

  const finish = await permitStub(env, permit.id).fetch("https://permit/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ execution_id: data.execution_id, upstream_status: 204, chargeable: true, external_consume: true }),
  });
  return json(await finish.json().catch(() => ({ error: "permit_finish_failed" })), finish.status);
}

async function execute(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const permit = body?.permit;
  const signature = String(body?.signature || "");
  if (!permit?.id || !signature) return json({ error: "permit_and_signature_required" }, 400);

  const serializedBody = JSON.stringify(body?.request_body ?? null);
  const requestHash = await sha256(serializedBody);
  const observed = observedFrom(permit, requestHash);
  const begin = await beginPermit(env, permit, signature, observed);
  const began = await begin.json().catch(() => ({ error: "permit_unavailable" }));
  if (!begin.ok) return json(began, begin.status);

  const headers = sanitizeHeaders(body?.headers || {});
  headers.set("x-xguard-permit-id", permit.id);
  headers.set("x-xguard-authorization-id", String(permit.authorization_id || ""));
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

  try {
    const upstream = await fetch(String(permit.target), {
      method: String(permit.method || "POST").toUpperCase(),
      headers,
      body: serializedBody,
      redirect: "manual",
    });

    const chargeable = upstream.status >= 200 && upstream.status < 400;
    const finish = await permitStub(env, permit.id).fetch("https://permit/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ execution_id: began.execution_id, upstream_status: upstream.status, chargeable }),
    });
    const finished = await finish.json().catch(() => ({}));

    const outputHeaders = new Headers(upstream.headers);
    outputHeaders.set("x-xguard-permit-id", permit.id);
    outputHeaders.set("x-xguard-rail-receipt", String(finished.receipt_id || ""));
    outputHeaders.set("x-xguard-fee-usd-micros", chargeable ? String(permit.fee_usd_micros || "0") : "0");
    outputHeaders.set("x-xguard-rail-state", "executed");
    outputHeaders.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outputHeaders });
  } catch (error) {
    await permitStub(env, permit.id).fetch("https://permit/ambiguous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ execution_id: began.execution_id, error: String(error?.message || error) }),
    });
    return json({
      error: "execution_ambiguous",
      permit_id: permit.id,
      message: "The upstream execution outcome is unknown. XGuard fails closed and will not replay this permit automatically.",
    }, 503, { "x-xguard-rail-state": "ambiguous" });
  }
}

async function permitStatus(request, env) {
  const id = new URL(request.url).pathname.split("/").pop() || "";
  if (!/^xrp_[a-f0-9]{32}$/i.test(id)) return json({ error: "invalid_permit_id" }, 400);
  const response = await permitStub(env, id).fetch("https://permit/status");
  return json(await response.json().catch(() => ({ error: "permit_unavailable" })), response.status);
}

export class RailKeyAuthority {
  constructor(state) { this.state = state; }

  async keys() {
    let record = await this.state.storage.get("keys");
    if (record) return record;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    record = {
      private_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      created_at: new Date().toISOString(),
      kid: `xguard-rail-p256-${Date.now()}`,
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

export class RailMeter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/record" && request.method === "POST") {
      const body = await request.json();
      let result;
      await this.state.storage.transaction(async txn => {
        const record = (await txn.get("meter")) || { chargeable_executions: 0, accrued_fee_usd_micros: "0", ambiguous_executions: 0, updated_at: null };
        if (body?.ambiguous) record.ambiguous_executions += 1;
        if (body?.chargeable) {
          record.chargeable_executions += 1;
          record.accrued_fee_usd_micros = (BigInt(record.accrued_fee_usd_micros || "0") + BigInt(String(body?.fee_usd_micros || "0"))).toString();
        }
        record.updated_at = new Date().toISOString();
        await txn.put("meter", record);
        result = record;
      });
      return json(result);
    }
    if (path === "/stats") {
      const record = (await this.state.storage.get("meter")) || { chargeable_executions: 0, accrued_fee_usd_micros: "0", ambiguous_executions: 0, updated_at: null };
      return json({ ...record, accrued_fee_usd: Number(record.accrued_fee_usd_micros || "0") / 1_000_000 });
    }
    return json({ error: "not_found" }, 404);
  }
}

export class RailPermitState {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/create" && request.method === "POST") {
      const existing = await this.state.storage.get("record");
      if (existing) return json({ error: "permit_exists" }, 409);
      const body = await request.json();
      if (!body?.permit?.id || !body?.signature) return json({ error: "invalid_permit" }, 400);
      await this.state.storage.put("record", { permit: body.permit, signature: body.signature, status: "issued", created_at: new Date().toISOString() });
      return json({ ok: true });
    }

    let record = await this.state.storage.get("record");
    if (!record) return json({ error: "permit_not_found" }, 404);

    if (path === "/status") {
      const expired = record.status === "issued" && Date.now() >= Date.parse(record.permit.expires_at);
      if (expired) {
        record.status = "expired";
        await this.state.storage.put("record", record);
      }
      return json({
        permit_id: record.permit.id,
        status: record.status,
        expires_at: record.permit.expires_at,
        executed_at: record.executed_at || null,
        upstream_status: record.upstream_status ?? null,
        receipt_id: record.receipt_id || null,
        chargeable: Boolean(record.chargeable),
        fee_usd_micros: record.chargeable ? String(record.permit.fee_usd_micros || "0") : "0",
      });
    }

    if (path === "/begin" && request.method === "POST") {
      const body = await request.json();
      if (body?.permit?.id !== record.permit.id || body?.signature !== record.signature) return json({ error: "permit_mismatch" }, 403);
      if (!(await verifySignature(this.env, body.permit, body.signature))) return json({ error: "invalid_permit_signature" }, 403);
      if (Date.now() >= Date.parse(record.permit.expires_at)) {
        record.status = "expired";
        await this.state.storage.put("record", record);
        return json({ error: "permit_expired" }, 410);
      }

      const expected = {
        target: String(record.permit.target || ""),
        method: String(record.permit.method || "").toUpperCase(),
        amount_minor: String(record.permit.amount_minor || ""),
        currency: String(record.permit.currency || "").toUpperCase(),
        pay_to: String(record.permit.pay_to || ""),
        request_hash: String(record.permit.request_hash || ""),
      };
      const observed = body?.observed || {};
      for (const key of Object.keys(expected)) {
        const a = key === "pay_to" ? low(observed[key]) : String(observed[key] ?? "");
        const b = key === "pay_to" ? low(expected[key]) : String(expected[key]);
        if (a !== b) return json({ error: "permit_binding_mismatch", field: key, expected: b, observed: a }, 409);
      }

      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.status !== "issued") {
          result = { status: 409, body: { error: current.status === "executed" ? "permit_replay_detected" : "permit_not_executable", state: current.status, receipt_id: current.receipt_id || null } };
          return;
        }
        const executionId = `xre_${crypto.randomUUID().replaceAll("-", "")}`;
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
          result = { status: 409, body: { error: "execution_state_mismatch", state: current.status } };
          return;
        }
        const receiptId = `xrr_${(await sha256(`${current.permit.id}|${current.execution_id}|${Date.now()}`)).slice(0, 40)}`;
        current.status = "executed";
        current.executed_at = new Date().toISOString();
        current.upstream_status = Number(body?.upstream_status || 0);
        current.chargeable = Boolean(body?.chargeable);
        current.external_consume = Boolean(body?.external_consume);
        current.receipt_id = receiptId;
        await txn.put("record", current);
        result = { status: 200, body: { ok: true, permit_id: current.permit.id, receipt_id: receiptId, state: "executed", upstream_status: current.upstream_status, chargeable: current.chargeable, fee_usd_micros: current.chargeable ? String(current.permit.fee_usd_micros || "0") : "0" } };
      });
      if (result.status === 200 && result.body.chargeable) {
        await meterStub(this.env).fetch("https://meter/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chargeable: true, fee_usd_micros: result.body.fee_usd_micros }),
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
          result = { status: 409, body: { error: "execution_state_mismatch", state: current.status } };
          return;
        }
        current.status = "ambiguous";
        current.ambiguous_at = new Date().toISOString();
        current.last_error = String(body?.error || "upstream_unknown").slice(0, 300);
        await txn.put("record", current);
        result = { status: 200, body: { ok: true, permit_id: current.permit.id, state: "ambiguous" } };
      });
      if (result.status === 200) {
        await meterStub(this.env).fetch("https://meter/record", {
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

    if ((path === "/.well-known/xguard-rail.json" || path === "/v1/rail") && (request.method === "GET" || request.method === "HEAD")) {
      const response = json(discovery(env), 200, { "cache-control": "public, max-age=120" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (path === "/.well-known/xguard-rail-key.json" && (request.method === "GET" || request.method === "HEAD")) {
      const response = await keyStub(env).fetch("https://rail-key/public");
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (path === "/v1/rail/pricing" && request.method === "GET") {
      const fee = Math.max(0, Math.trunc(Number(env.RAIL_FEE_USD_MICROS || 1000)));
      return json({ fee_usd_micros_per_chargeable_execution: fee, fee_usd: fee / 1_000_000, charge_condition: "upstream HTTP status 200-399", collection_state: "metered_accrual_not_cash_collection" });
    }

    if (path === "/v1/rail/stats" && request.method === "GET") {
      return meterStub(env).fetch("https://meter/stats");
    }

    if (path === "/v1/rail/permits" && request.method === "POST") return createPermit(request, env);
    if (path === "/v1/rail/execute" && request.method === "POST") return execute(request, env);
    if (path === "/v1/rail/consume" && request.method === "POST") return consumeOnly(request, env);
    if (path.startsWith("/v1/rail/permits/") && request.method === "GET") return permitStatus(request, env);

    return null;
  },
};
