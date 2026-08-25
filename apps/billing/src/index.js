const EXPECTED_PATH_SECRET_HASH = "69c82b71630e802bbfa2b18beafe756e4ff1e51624954c171b1c5a8be4218bfd";
const CREDITS_PER_PURCHASE = 5000;
const VERSION = "0.3.0";
const enc = new TextEncoder();
const json = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmac(secret, body) { const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body))); }
function equal(a, b) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function clientKey(request) { const auth = (request.headers.get("authorization") || "").trim(); if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim(); return (request.headers.get("x-xguard-key") || "").trim(); }
function int(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function bool(v) { return Boolean(v); }

function normalizeRecord(record) {
  if (!record) return null;
  const balance = Math.max(0, int(record.balance));
  const granted = Math.max(0, int(record.granted, balance + int(record.consumed) + int(record.refunded_credits)));
  const refundedCredits = Math.max(0, int(record.refunded_credits));
  const consumed = Math.max(0, int(record.consumed, Math.max(0, granted - balance - refundedCredits)));
  return { ...record, granted, balance, consumed, refunded_credits: refundedCredits, refunded_amount: Math.max(0, int(record.refunded_amount)), revoked: bool(record.revoked) };
}

export class CreditLedger {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/provision" && request.method === "POST") {
      const body = await request.json();
      const credits = int(body?.credits);
      if (credits <= 0) return json({ error: "invalid_credits" }, 400);
      const existing = normalizeRecord(await this.ctx.storage.get("record"));
      if (existing?.provisioned) return json({ ok: true, idempotent: true, balance: existing.balance, granted: existing.granted });
      const record = {
        provisioned: true,
        granted: credits,
        balance: credits,
        consumed: 0,
        refunded_credits: 0,
        refunded_amount: 0,
        revoked: false,
        order_id: String(body?.order_id || ""),
        license_id: String(body?.license_id || ""),
        product_id: String(body?.product_id || ""),
        user_email: String(body?.user_email || ""),
        test_mode: bool(body?.test_mode),
        created_at: new Date().toISOString()
      };
      await this.ctx.storage.put("record", record);
      return json({ ok: true, idempotent: false, balance: credits, granted: credits });
    }

    if (path === "/balance" && request.method === "GET") {
      const record = normalizeRecord(await this.ctx.storage.get("record"));
      if (!record?.provisioned) return json({ error: "unknown_key" }, 404);
      return json({
        credits: record.balance,
        granted: record.granted,
        consumed: record.consumed,
        refunded_credits: record.refunded_credits,
        revoked: record.revoked,
        provisioned: true,
        test_mode: bool(record.test_mode)
      });
    }

    if (path === "/consume" && request.method === "POST") {
      const body = await request.json();
      const units = int(body?.units, 1);
      if (units <= 0 || units > 1000) return json({ error: "invalid_units" }, 400);
      let result;
      await this.ctx.storage.transaction(async txn => {
        const record = normalizeRecord(await txn.get("record"));
        if (!record?.provisioned) { result = { status: 404, body: { error: "unknown_key" } }; return; }
        if (record.revoked) { result = { status: 403, body: { error: "credits_revoked", credits: 0 } }; return; }
        if (record.balance < units) { result = { status: 402, body: { error: "insufficient_credits", credits: record.balance } }; return; }
        record.balance -= units;
        record.consumed += units;
        record.updated_at = new Date().toISOString();
        await txn.put("record", record);
        result = { status: 200, body: { ok: true, consumed: units, credits: record.balance } };
      });
      return json(result.body, result.status);
    }

    if (path === "/assure" && request.method === "POST") {
      const body = await request.json();
      const idempotencyHash = String(body?.idempotency_hash || "");
      const fingerprint = String(body?.fingerprint || "");
      if (!/^[a-f0-9]{64}$/.test(idempotencyHash) || !/^[a-f0-9]{64}$/.test(fingerprint)) return json({ error: "invalid_assurance_input" }, 400);
      let result;
      await this.ctx.storage.transaction(async txn => {
        const record = normalizeRecord(await txn.get("record"));
        if (!record?.provisioned) { result = { status: 404, body: { error: "unknown_key" } }; return; }
        if (record.revoked) { result = { status: 403, body: { error: "credits_revoked", credits: 0 } }; return; }
        const replayKey = `idem:${idempotencyHash}`;
        const prior = await txn.get(replayKey);
        if (prior) { result = { status: 409, body: { error: "replay_detected", assurance_id: prior.assurance_id, first_seen_at: prior.created_at, credits: record.balance } }; return; }
        if (record.balance < 1) { result = { status: 402, body: { error: "insufficient_credits", credits: record.balance } }; return; }
        const assuranceId = `xga_${fingerprint.slice(0, 24)}`;
        const now = new Date().toISOString();
        record.balance -= 1;
        record.consumed += 1;
        record.updated_at = now;
        await txn.put("record", record);
        await txn.put(replayKey, { assurance_id: assuranceId, fingerprint, created_at: now });
        result = { status: 200, body: { ok: true, assurance_id: assuranceId, consumed: 1, credits: record.balance } };
      });
      return json(result.body, result.status);
    }

    if (path === "/refund" && request.method === "POST") {
      const body = await request.json();
      const total = Math.max(0, int(body?.total));
      const refundedAmount = Math.max(0, int(body?.refunded_amount));
      let result;
      await this.ctx.storage.transaction(async txn => {
        const record = normalizeRecord(await txn.get("record"));
        if (!record?.provisioned) { result = { status: 404, body: { error: "unknown_key" } }; return; }
        if (refundedAmount <= record.refunded_amount) {
          result = { status: 200, body: { ok: true, idempotent: true, credits: record.balance, revoked: record.revoked, refunded_credits: record.refunded_credits } };
          return;
        }
        const ratio = total > 0 ? Math.min(1, refundedAmount / total) : 1;
        const allowedCredits = Math.max(0, Math.floor(record.granted * (1 - ratio) + 1e-9));
        const refundedCredits = Math.max(0, record.granted - allowedCredits);
        record.refunded_amount = refundedAmount;
        record.refunded_credits = refundedCredits;
        record.balance = Math.max(0, allowedCredits - record.consumed);
        record.revoked = total <= 0 || refundedAmount >= total;
        if (record.revoked) record.balance = 0;
        record.updated_at = new Date().toISOString();
        await txn.put("record", record);
        result = { status: 200, body: { ok: true, idempotent: false, credits: record.balance, revoked: record.revoked, refunded_credits: record.refunded_credits } };
      });
      return json(result.body, result.status);
    }

    return json({ error: "not_found" }, 404);
  }
}

export class OrderIndex {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/bind" && request.method === "POST") {
      const body = await request.json();
      const keyHash = String(body?.key_hash || "");
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return json({ error: "invalid_key_hash" }, 400);
      const record = (await this.ctx.storage.get("record")) || { key_hashes: [], created_at: new Date().toISOString() };
      if (!record.key_hashes.includes(keyHash)) record.key_hashes.push(keyHash);
      record.license_id = String(body?.license_id || record.license_id || "");
      record.product_id = String(body?.product_id || record.product_id || "");
      record.user_email = String(body?.user_email || record.user_email || "");
      record.updated_at = new Date().toISOString();
      await this.ctx.storage.put("record", record);
      return json({ ok: true, key_count: record.key_hashes.length });
    }
    if (path === "/lookup" && request.method === "GET") {
      const record = await this.ctx.storage.get("record");
      if (!record) return json({ error: "order_not_mapped" }, 404);
      return json(record);
    }
    return json({ error: "not_found" }, 404);
  }
}

async function ledgerForKey(env, key) { return env.CREDITS.getByName(await sha256(key)); }
function ledgerForHash(env, keyHash) { return env.CREDITS.getByName(keyHash); }
function orderIndex(env, orderId) { return env.ORDERS.getByName(String(orderId)); }

function privateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return true;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assureRequest(request, env) {
  const key = clientKey(request);
  if (!key) return json({ error: "missing_key" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const action = String(body?.action || "").trim();
  const target = String(body?.target || "").trim();
  const idempotencyKey = String(body?.idempotency_key || "").trim();
  const method = String(body?.method || "POST").toUpperCase();
  const errors = [];
  if (!action || action.length > 120) errors.push("invalid_action");
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) errors.push("invalid_idempotency_key");
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) errors.push("invalid_method");

  let parsed;
  try { parsed = new URL(target); } catch { errors.push("invalid_target_url"); }
  if (parsed) {
    if (parsed.protocol !== "https:") errors.push("target_must_use_https");
    if (parsed.username || parsed.password) errors.push("target_credentials_not_allowed");
    if (privateHost(parsed.hostname)) errors.push("private_network_target_not_allowed");
  }

  let amount = null;
  let currency = null;
  if (body?.amount !== undefined && body?.amount !== null) {
    amount = Number(typeof body.amount === "object" ? body.amount.value : body.amount);
    currency = String(typeof body.amount === "object" ? body.amount.currency || body.currency || "" : body.currency || "").toUpperCase();
    if (!Number.isFinite(amount) || amount < 0) errors.push("invalid_amount");
    if (!/^[A-Z]{3}$/.test(currency)) errors.push("invalid_currency");
  }

  if (body?.expires_at) {
    const expires = Date.parse(String(body.expires_at));
    if (!Number.isFinite(expires)) errors.push("invalid_expires_at");
    else if (expires <= Date.now()) return json({ decision: "deny", error: "stale_request", reasons: ["expires_at_not_in_future"] }, 409);
  }

  if (errors.length) return json({ decision: "deny", error: "invalid_request", reasons: errors }, 400);

  const canonical = JSON.stringify({
    action,
    target: parsed.toString(),
    method,
    amount,
    currency,
    idempotency_key: idempotencyKey,
    expires_at: body?.expires_at ? new Date(String(body.expires_at)).toISOString() : null
  });
  const fingerprint = await sha256(canonical);
  const idempotencyHash = await sha256(idempotencyKey);
  const debit = await (await ledgerForKey(env, key)).fetch("https://ledger/assure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotency_hash: idempotencyHash, fingerprint })
  });
  const debited = await debit.json();
  if (!debit.ok) return json(debited, debit.status);

  return json({
    decision: "allow",
    assurance_id: debited.assurance_id,
    checks: {
      https_target: true,
      public_network_target: true,
      explicit_idempotency_key: true,
      not_expired: true,
      amount_shape_valid: amount === null ? null : true
    },
    fingerprint,
    credits_remaining: debited.credits,
    consumed: 1
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") return json({ status: "ok", service: "XGuard transaction assurance + Lemon Squeezy webhook", version: VERSION, credits_per_purchase: CREDITS_PER_PURCHASE, billable_endpoint: "/v1/assure" });

      if (url.pathname === "/v1/balance") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        const key = clientKey(request); if (!key) return json({ error: "missing_key" }, 401);
        return (await ledgerForKey(env, key)).fetch("https://ledger/balance", { method: "GET" });
      }

      if (url.pathname === "/v1/assure") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return assureRequest(request, env);
      }

      if (url.pathname === "/v1/consume") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const key = clientKey(request); if (!key) return json({ error: "missing_key" }, 401);
        const raw = await request.text();
        return (await ledgerForKey(env, key)).fetch("https://ledger/consume", { method: "POST", headers: { "content-type": "application/json" }, body: raw || "{}" });
      }

      const m = url.pathname.match(/^\/webhooks\/lemonsqueezy\/([A-Za-z0-9_-]{32,128})$/);
      if (!m) return json({ error: "not_found" }, 404);
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const secret = m[1];
      if (await sha256(secret) !== EXPECTED_PATH_SECRET_HASH) return json({ error: "not_found" }, 404);
      const raw = await request.text();
      const supplied = (request.headers.get("x-signature") || "").trim().toLowerCase();
      const expected = await hmac(secret, raw);
      if (!equal(expected, supplied)) return json({ error: "invalid_signature" }, 401);
      let payload; try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
      const event = request.headers.get("x-event-name") || payload?.meta?.event_name || "";
      const data = payload?.data || {};
      const a = data.attributes || {};

      if (event === "order_created") {
        console.log(JSON.stringify({ event: "lemon_order_created", order_id: String(data.id || ""), identifier: String(a.identifier || ""), product_id: String(a.first_order_item?.product_id || ""), variant_id: String(a.first_order_item?.variant_id || ""), total: int(a.total), total_usd: Number(a.total_usd || 0), test_mode: bool(a.test_mode) }));
        return json({ accepted: true, event: "order_created" });
      }

      if (event === "license_key_created") {
        const key = String(a.key || "").trim();
        const orderId = String(a.order_id || "");
        if (!key) return json({ error: "missing_license_key" }, 400);
        if (!orderId) return json({ error: "missing_order_id" }, 400);
        const keyHash = await sha256(key);
        const stub = ledgerForHash(env, keyHash);
        const provision = await stub.fetch("https://ledger/provision", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credits: CREDITS_PER_PURCHASE, order_id: orderId, license_id: data.id, product_id: a.product_id, user_email: a.user_email, test_mode: bool(a.test_mode ?? payload?.meta?.test_mode) })
        });
        const result = await provision.json();
        if (!provision.ok) return json(result, provision.status);
        await orderIndex(env, orderId).fetch("https://order/bind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key_hash: keyHash, license_id: data.id, product_id: a.product_id, user_email: a.user_email })
        });
        console.log(JSON.stringify({ event: "lemon_license_key_created", license_id: String(data.id || ""), order_id: orderId, product_id: String(a.product_id || ""), key_hash: keyHash.slice(0, 16), credits: Number(result.balance || 0), idempotent: bool(result.idempotent) }));
        return json({ accepted: true, event: "license_key_created", provisioned: true, credits: Number(result.balance || 0) });
      }

      if (event === "order_refunded") {
        const orderId = String(data.id || "");
        const total = Math.max(0, int(a.total));
        const refundedAmount = Math.max(0, int(a.refunded_amount));
        if (!orderId) return json({ error: "missing_order_id" }, 400);
        const lookup = await orderIndex(env, orderId).fetch("https://order/lookup", { method: "GET" });
        if (lookup.status === 404) {
          console.warn(JSON.stringify({ event: "lemon_order_refunded_unmapped", order_id: orderId, total, refunded_amount: refundedAmount }));
          return json({ accepted: true, event: "order_refunded", mapped: false, retryable: true }, 202);
        }
        const mapped = await lookup.json();
        const outcomes = [];
        for (const keyHash of mapped.key_hashes || []) {
          const r = await ledgerForHash(env, keyHash).fetch("https://ledger/refund", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ total, refunded_amount: refundedAmount })
          });
          const out = await r.json();
          outcomes.push({ key_hash: keyHash.slice(0, 16), status: r.status, ...out });
        }
        console.log(JSON.stringify({ event: "lemon_order_refunded", order_id: orderId, total, refunded_amount: refundedAmount, keys: outcomes.length }));
        return json({ accepted: true, event: "order_refunded", mapped: true, outcomes });
      }

      return json({ accepted: true, ignored: true, event });
    } catch (e) {
      console.error(JSON.stringify({ event: "lemonhook_error", message: String(e?.message || e) }));
      return json({ error: "internal_error" }, 500);
    }
  }
};
