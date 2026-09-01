const VERSION = "5.1.0";
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder();

function cors(origin, env) {
  const allowed = String(env?.PUBLIC_SITE_ORIGIN || "https://xguardgate.com");
  return origin === allowed ? {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, idempotency-key, x-xguard-key",
    "access-control-max-age": "600",
    "vary": "Origin",
  } : {};
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function int(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}
function bool(value) { return value === true || value === 1 || value === "true"; }
function now() { return new Date().toISOString(); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function randomToken(bytes = 24) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
async function sha256(value) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(value)))); }

function parseHex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function timingSafeEqual(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(left, right);
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function validSignature(secret, rawBody, suppliedHex) {
  if (!secret) return false;
  const supplied = parseHex(suppliedHex);
  if (!supplied) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  return timingSafeEqual(expected, supplied);
}

function clientKey(request) {
  const authorization = (request.headers.get("authorization") || "").trim();
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim();
  return (request.headers.get("x-xguard-key") || "").trim();
}

function variantCatalog(env) {
  try {
    const parsed = JSON.parse(String(env?.LEMONSQUEEZY_VARIANT_CREDITS || "{}"));
    return Object.fromEntries(Object.entries(parsed).flatMap(([variant, credits]) => {
      const normalized = int(credits);
      return /^\d+$/.test(variant) && normalized > 0 ? [[variant, normalized]] : [];
    }));
  } catch { return {}; }
}

function allowedProducts(env) {
  return new Set(String(env?.LEMONSQUEEZY_ALLOWED_PRODUCTS || "").split(",").map(value => value.trim()).filter(Boolean));
}

function publicPackage(env) {
  const variants = variantCatalog(env);
  const variantId = String(env?.LEMONSQUEEZY_PUBLIC_VARIANT_ID || Object.keys(variants)[0] || "");
  return {
    variant_id: variantId,
    credits: variants[variantId] || 0,
    amount_minor: Math.max(0, int(env?.LEMONSQUEEZY_PUBLIC_PRICE_MINOR)),
    currency: String(env?.LEMONSQUEEZY_PUBLIC_CURRENCY || "JOD").toUpperCase(),
    one_time: true,
  };
}

function normalizeRecord(value) {
  const record = value || {};
  return {
    provisioned: bool(record.provisioned), granted: Math.max(0, int(record.granted)), balance: Math.max(0, int(record.balance)),
    consumed: Math.max(0, int(record.consumed)), refunded_credits: Math.max(0, int(record.refunded_credits)),
    debt_credits: Math.max(0, int(record.debt_credits)), restricted: bool(record.restricted) || bool(record.revoked), sequence: Math.max(0, int(record.sequence)),
    legacy_order_id: String(record.legacy_order_id || record.order_id || ""), legacy_refunded_amount: Math.max(0, int(record.legacy_refunded_amount ?? record.refunded_amount)),
    created_at: record.created_at || null, updated_at: record.updated_at || null,
  };
}

async function appendJournal(txn, record, entry) {
  record.sequence += 1;
  const item = { sequence: record.sequence, occurred_at: now(), ...entry };
  await txn.put(`journal:${String(record.sequence).padStart(12, "0")}`, item);
  return item;
}

export class CreditLedger {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/purchase" && request.method === "POST") {
      const body = await request.json();
      const credits = int(body?.credits);
      const orderId = String(body?.order_id || "");
      const eventId = String(body?.event_id || "");
      if (credits <= 0 || !orderId || !eventId) return json({ error: "invalid_purchase" }, 400);
      let result;
      await this.ctx.storage.transaction(async txn => {
        const duplicate = await txn.get(`event:${eventId}`);
        const storedRecord = await txn.get("record");
        const record = normalizeRecord(storedRecord);
        if (duplicate) { result = { status: 200, body: { ok: true, idempotent: true, credits: record.balance, granted: record.granted } }; return; }
        const orderKey = `order:${orderId}`;
        if (await txn.get(orderKey)) {
          await txn.put(`event:${eventId}`, { kind: "purchase_duplicate", order_id: orderId, created_at: now() });
          result = { status: 200, body: { ok: true, idempotent: true, credits: record.balance, granted: record.granted } }; return;
        }
        const timestamp = now();
        record.provisioned = true; record.granted += credits; record.balance += credits; record.created_at ||= timestamp; record.updated_at = timestamp;
        const order = { order_id: orderId, credits, total: Math.max(0, int(body?.total)), currency: String(body?.currency || "").toUpperCase(), product_id: String(body?.product_id || ""), variant_id: String(body?.variant_id || ""), refunded_amount: 0, refunded_credits: 0, test_mode: bool(body?.test_mode), created_at: timestamp };
        await txn.put(orderKey, order);
        await txn.put(`event:${eventId}`, { kind: "purchase", order_id: orderId, created_at: timestamp });
        const journal = await appendJournal(txn, record, { type: "purchase", delta_credits: credits, balance_after: record.balance, order_id: orderId, provider_event_id: eventId, variant_id: order.variant_id });
        await txn.put("record", record);
        result = { status: 200, body: { ok: true, idempotent: false, credits: record.balance, granted: record.granted, receipt_id: `xgr_${journal.sequence}` } };
      });
      return json(result.body, result.status);
    }

    if (path === "/refund" && request.method === "POST") {
      const body = await request.json();
      const orderId = String(body?.order_id || "");
      const eventId = String(body?.event_id || "");
      const refundedAmount = Math.max(0, int(body?.refunded_amount));
      if (!orderId || !eventId) return json({ error: "invalid_refund" }, 400);
      let result;
      await this.ctx.storage.transaction(async txn => {
        const record = normalizeRecord(await txn.get("record"));
        if (await txn.get(`event:${eventId}`)) { result = { status: 200, body: { ok: true, idempotent: true, credits: record.balance, debt_credits: record.debt_credits, restricted: record.restricted } }; return; }
        const orderKey = `order:${orderId}`;
        let order = await txn.get(orderKey);
        if (!order && record.legacy_order_id === orderId) {
          order = { order_id: orderId, credits: record.granted, total: Math.max(0, int(body?.total)), refunded_amount: record.legacy_refunded_amount, refunded_credits: record.refunded_credits, migrated_from_legacy_record: true, created_at: record.created_at || now() };
        }
        if (!order) { result = { status: 409, body: { error: "purchase_not_recorded" } }; return; }
        const total = Math.max(0, int(body?.total, order.total));
        if (refundedAmount < order.refunded_amount) { result = { status: 409, body: { error: "refund_amount_regressed" } }; return; }
        const cumulative = total > 0 ? Math.min(order.credits, Math.floor(order.credits * Math.min(1, refundedAmount / total) + 1e-9)) : order.credits;
        const delta = Math.max(0, cumulative - order.refunded_credits);
        order.total = total; order.refunded_amount = refundedAmount; order.refunded_credits = cumulative; order.updated_at = now();
        if (delta > 0) {
          const removed = Math.min(record.balance, delta);
          record.balance -= removed; record.refunded_credits += delta; record.debt_credits += delta - removed; record.restricted = record.debt_credits > 0; record.updated_at = now();
          await appendJournal(txn, record, { type: "refund", delta_credits: -delta, balance_after: record.balance, debt_after: record.debt_credits, order_id: orderId, provider_event_id: eventId, refunded_amount: refundedAmount });
        }
        await txn.put(orderKey, order); await txn.put(`event:${eventId}`, { kind: "refund", order_id: orderId, created_at: now() }); await txn.put("record", record);
        result = { status: 200, body: { ok: true, idempotent: delta === 0, refunded_credits: cumulative, credits: record.balance, debt_credits: record.debt_credits, restricted: record.restricted } };
      });
      return json(result.body, result.status);
    }

    if (path === "/consume" && request.method === "POST") {
      const body = await request.json();
      const units = int(body?.units, 1);
      const idempotencyId = String(body?.idempotency_id || request.headers.get("idempotency-key") || "").trim();
      if (units <= 0 || units > 1000) return json({ error: "invalid_units" }, 400);
      if (idempotencyId.length > 200) return json({ error: "invalid_idempotency_key" }, 400);
      let result;
      await this.ctx.storage.transaction(async txn => {
        const record = normalizeRecord(await txn.get("record"));
        if (!record.provisioned) { result = { status: 404, body: { error: "unknown_key" } }; return; }
        if (record.restricted) { result = { status: 403, body: { error: "account_restricted_refund_debt", debt_credits: record.debt_credits, credits: record.balance } }; return; }
        const replayKey = idempotencyId ? `consume:${await sha256(idempotencyId)}` : null;
        if (replayKey) { const prior = await txn.get(replayKey); if (prior) { result = { status: 200, body: { ...prior, idempotent: true } }; return; } }
        if (record.balance < units) { result = { status: 402, body: { error: "insufficient_credits", credits: record.balance } }; return; }
        record.balance -= units; record.consumed += units; record.updated_at = now();
        const journal = await appendJournal(txn, record, { type: "consume", delta_credits: -units, balance_after: record.balance, idempotency_hash: replayKey?.slice(8) || null });
        const response = { ok: true, consumed: units, credits: record.balance, receipt_id: `xgr_${journal.sequence}`, idempotent: false };
        if (replayKey) await txn.put(replayKey, response);
        await txn.put("record", record); result = { status: 200, body: response };
      });
      return json(result.body, result.status);
    }

    if (path === "/balance" && request.method === "GET") {
      const record = normalizeRecord(await this.ctx.storage.get("record"));
      if (!record.provisioned) return json({ error: "unknown_key" }, 404);
      return json({ credits: record.balance, granted: record.granted, consumed: record.consumed, refunded_credits: record.refunded_credits, debt_credits: record.debt_credits, restricted: record.restricted });
    }
    if (path === "/ledger" && request.method === "GET") {
      const record = normalizeRecord(await this.ctx.storage.get("record"));
      if (!record.provisioned) return json({ error: "unknown_key" }, 404);
      const limit = Math.max(1, Math.min(100, int(url.searchParams.get("limit"), 50)));
      const entries = await this.ctx.storage.list({ prefix: "journal:", reverse: true, limit });
      return json({ balance: record.balance, debt_credits: record.debt_credits, restricted: record.restricted, entries: [...entries.values()] });
    }
    const receiptMatch = path.match(/^\/receipt\/(xgr_(\d+))$/);
    if (receiptMatch && request.method === "GET") {
      const entry = await this.ctx.storage.get(`journal:${receiptMatch[2].padStart(12, "0")}`);
      return entry ? json({ receipt_id: receiptMatch[1], ...entry }) : json({ error: "receipt_not_found" }, 404);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class OrderIndex {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      if (await this.ctx.storage.get("record")) return json({ error: "checkout_exists" }, 409);
      const body = await request.json(); const keyHash = String(body?.key_hash || "");
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return json({ error: "invalid_key_hash" }, 400);
      await this.ctx.storage.put("record", { checkout_id: String(body?.checkout_id || ""), key_hash: keyHash, variant_id: String(body?.variant_id || ""), status: "pending", created_at: now() });
      return json({ ok: true }, 201);
    }
    if (path === "/claim" && request.method === "POST") {
      const body = await request.json(); let output;
      await this.ctx.storage.transaction(async txn => {
        const record = await txn.get("record");
        if (!record) { output = { status: 404, body: { error: "checkout_not_found" } }; return; }
        const orderId = String(body?.order_id || "");
        if (record.order_id && record.order_id !== orderId) { output = { status: 409, body: { error: "checkout_already_claimed" } }; return; }
        record.order_id = orderId; record.status = "paid"; record.paid_at ||= now(); await txn.put("record", record); output = { status: 200, body: record };
      });
      return json(output.body, output.status);
    }
    if (path === "/bind" && request.method === "POST") {
      const body = await request.json(); const keyHash = String(body?.key_hash || "");
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return json({ error: "invalid_key_hash" }, 400);
      let output;
      await this.ctx.storage.transaction(async txn => {
        const existing = await txn.get("record");
        const existingHashes = [existing?.key_hash, ...(existing?.key_hashes || [])].filter(Boolean);
        if (existingHashes.length && !existingHashes.includes(keyHash)) { output = { status: 409, body: { error: "order_already_bound" } }; return; }
        const record = { ...(existing || {}), key_hash: keyHash, key_hashes: [...new Set([...existingHashes, keyHash])], checkout_id: String(body?.checkout_id || existing?.checkout_id || ""), order_id: String(body?.order_id || existing?.order_id || ""), updated_at: now() };
        await txn.put("record", record);
        output = { status: 200, body: { ok: true } };
      });
      return json(output.body, output.status);
    }
    if (path === "/lookup" && request.method === "GET") { const record = await this.ctx.storage.get("record"); return record ? json(record) : json({ error: "mapping_not_found" }, 404); }
    return json({ error: "not_found" }, 404);
  }
}

function ledgerForHash(env, keyHash) { return env.CREDITS.getByName(keyHash); }
async function ledgerForKey(env, key) { return ledgerForHash(env, await sha256(key)); }
function checkoutIndex(env, checkoutId) { return env.ORDERS.getByName(`checkout:${checkoutId}`); }
function orderIndex(env, orderId) { return env.ORDERS.getByName(`order:${orderId}`); }
function checkoutUrl(env, checkoutId) { const base = new URL(String(env.LEMONSQUEEZY_CHECKOUT_URL)); base.searchParams.set("checkout[custom][xguard_checkout_id]", checkoutId); return base.toString(); }

async function createCheckout(request, env) {
  let body = {}; try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const suppliedKey = String(body?.operator_key || "").trim();
  if (suppliedKey && (suppliedKey.length < 20 || suppliedKey.length > 200)) return json({ error: "invalid_operator_key" }, 400);
  const operatorKey = suppliedKey || `xgk_${randomToken(32)}`;
  const keyHash = await sha256(operatorKey); const checkoutId = `xgc_${randomToken(24)}`; const packageInfo = publicPackage(env);
  if (!packageInfo.variant_id || packageInfo.credits <= 0 || !env.LEMONSQUEEZY_CHECKOUT_URL) return json({ error: "checkout_not_configured" }, 503);
  const created = await checkoutIndex(env, checkoutId).fetch("https://checkout/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkout_id: checkoutId, key_hash: keyHash, variant_id: packageInfo.variant_id }) });
  if (!created.ok) return json({ error: "checkout_session_unavailable" }, 503);
  return json({ checkout_id: checkoutId, checkout_url: checkoutUrl(env, checkoutId), operator_key: suppliedKey ? undefined : operatorKey, operator_key_notice: suppliedKey ? "Existing operator key will receive the credits after a verified payment webhook." : "Save this operator key now. XGuard stores only its SHA-256 hash and cannot recover it.", package: packageInfo }, 201);
}

async function handleWebhook(request, env) {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) return json({ error: "webhook_not_configured" }, 503);
  const declaredLength = int(request.headers.get("content-length"));
  if (declaredLength > MAX_WEBHOOK_BYTES) return json({ error: "webhook_body_too_large" }, 413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return json({ error: "webhook_body_too_large" }, 413);
  if (!(await validSignature(env.LEMONSQUEEZY_WEBHOOK_SECRET, raw, request.headers.get("x-signature")))) return json({ error: "invalid_signature" }, 401);
  let payload; try { payload = JSON.parse(dec.decode(raw)); } catch { return json({ error: "invalid_json" }, 400); }
  const event = String(payload?.meta?.event_name || request.headers.get("x-event-name") || ""); const data = payload?.data || {}; const attributes = data.attributes || {}; const orderId = String(data.id || attributes.order_id || "");
  if (event === "order_created") {
    if (!orderId) return json({ error: "missing_order_id" }, 422);
    if (bool(payload?.meta?.test_mode ?? attributes.test_mode) && !bool(env.ALLOW_TEST_WEBHOOKS)) return json({ accepted: true, ignored: true, reason: "test_order" });
    const item = attributes.first_order_item || {}; const productId = String(item.product_id || attributes.product_id || ""); const variantId = String(item.variant_id || attributes.variant_id || ""); const catalog = variantCatalog(env); const products = allowedProducts(env);
    if (!catalog[variantId] || (products.size && !products.has(productId))) return json({ error: "unrecognized_product_or_variant" }, 422);
    const status = String(attributes.status || "").toLowerCase(); if (status && status !== "paid") return json({ error: "order_not_paid", status }, 409);
    const checkoutId = String(payload?.meta?.custom_data?.xguard_checkout_id || "");
    if (!/^xgc_[a-f0-9]{48}$/.test(checkoutId)) return json({ error: "missing_checkout_binding" }, 422);
    const claimed = await checkoutIndex(env, checkoutId).fetch("https://checkout/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: orderId }) }); const session = await claimed.json();
    if (!claimed.ok) return json(session, claimed.status); if (session.variant_id !== variantId) return json({ error: "checkout_variant_mismatch" }, 409);
    const eventId = `lemon:order_created:${orderId}`;
    const purchased = await ledgerForHash(env, session.key_hash).fetch("https://ledger/purchase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_id: eventId, order_id: orderId, credits: catalog[variantId], total: int(attributes.total), currency: attributes.currency, product_id: productId, variant_id: variantId, test_mode: bool(payload?.meta?.test_mode ?? attributes.test_mode) }) });
    const outcome = await purchased.json(); if (!purchased.ok) return json(outcome, purchased.status);
    const bound = await orderIndex(env, orderId).fetch("https://order/bind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key_hash: session.key_hash, checkout_id: checkoutId, order_id: orderId }) });
    if (!bound.ok) return json({ error: "order_mapping_failed", retryable: bound.status >= 500 }, bound.status >= 500 ? 503 : 409);
    console.log(JSON.stringify({ event: "credits_granted", order_id: orderId, checkout_id: checkoutId, variant_id: variantId, credits: catalog[variantId], idempotent: outcome.idempotent }));
    return json({ accepted: true, event, provisioned: true, credits: outcome.credits, idempotent: outcome.idempotent });
  }
  if (event === "order_refunded") {
    if (!orderId) return json({ error: "missing_order_id" }, 422);
    const mappedResponse = await orderIndex(env, orderId).fetch("https://order/lookup"); if (!mappedResponse.ok) return json({ error: "order_mapping_not_ready", retryable: true }, 503);
    const mapped = await mappedResponse.json(); const total = Math.max(0, int(attributes.total)); const refundedAmount = Math.max(0, int(attributes.refunded_amount)); const eventId = `lemon:order_refunded:${orderId}:${refundedAmount}`;
    const keyHashes = [...new Set([mapped.key_hash, ...(mapped.key_hashes || [])].filter(value => /^[a-f0-9]{64}$/.test(String(value))))];
    if (!keyHashes.length) return json({ error: "order_mapping_invalid" }, 503);
    const outcomes = [];
    for (const keyHash of keyHashes) {
      const refunded = await ledgerForHash(env, keyHash).fetch("https://ledger/refund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_id: eventId, order_id: orderId, total, refunded_amount: refundedAmount }) });
      const outcome = await refunded.json();
      if (!refunded.ok) return json(outcome, refunded.status);
      outcomes.push(outcome);
    }
    console.log(JSON.stringify({ event: "credits_refunded", order_id: orderId, refunded_amount: refundedAmount, accounts: outcomes.length, restricted_accounts: outcomes.filter(outcome => outcome.restricted).length }));
    return json({ accepted: true, event, ...(outcomes.length === 1 ? outcomes[0] : {}), outcomes });
  }
  if (event === "license_key_created") return json({ accepted: true, ignored: true, reason: "credits_are_bound_to_verified_order_checkout_metadata" });
  return json({ accepted: true, ignored: true, event });
}

export default {
  async fetch(request, env) {
    const requestId = request.headers.get("cf-ray") || `local-${randomToken(8)}`; const url = new URL(request.url); const responseHeaders = { "x-xguard-version": VERSION, "x-request-id": requestId, ...cors(request.headers.get("origin"), env) };
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
      if (url.pathname === "/healthz") { const packageInfo = publicPackage(env); return json({ status: env.LEMONSQUEEZY_WEBHOOK_SECRET ? "ready" : "not_ready", service: "XGuard Universal Paid AI Agent + Secretless Gateway billing", version: VERSION, webhook_signature: env.LEMONSQUEEZY_WEBHOOK_SECRET ? "configured" : "missing", package: packageInfo }, env.LEMONSQUEEZY_WEBHOOK_SECRET ? 200 : 503, responseHeaders); }
      if (url.pathname === "/v1/pricing" && request.method === "GET") return json({ product: "XGuard Usage Credits", package: publicPackage(env), billing_boundary: "One credit is consumed for each authorized Secretless Egress attempt before credential release.", provider: "Lemon Squeezy" }, 200, responseHeaders);
      if (url.pathname === "/v1/checkout" && request.method === "POST") { const response = await createCheckout(request, env); const headers = new Headers(response.headers); Object.entries(responseHeaders).forEach(([key, value]) => headers.set(key, value)); return new Response(response.body, { status: response.status, headers }); }
      const checkoutMatch = url.pathname.match(/^\/v1\/checkout\/status\/(xgc_[a-f0-9]{48})$/);
      if (checkoutMatch && request.method === "GET") { const result = await checkoutIndex(env, checkoutMatch[1]).fetch("https://checkout/lookup"); const body = await result.json(); return result.ok ? json({ checkout_id: body.checkout_id, status: body.status, paid_at: body.paid_at || null }, 200, responseHeaders) : json({ error: "checkout_not_found" }, 404, responseHeaders); }
      if (url.pathname === "/webhooks/lemonsqueezy" && request.method === "POST") { const response = await handleWebhook(request, env); const headers = new Headers(response.headers); Object.entries(responseHeaders).forEach(([key, value]) => headers.set(key, value)); return new Response(response.body, { status: response.status, headers }); }
      if (["/v1/balance", "/v1/ledger"].includes(url.pathname) || url.pathname.startsWith("/v1/receipt/")) {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, responseHeaders); const key = clientKey(request); if (!key) return json({ error: "missing_key" }, 401, responseHeaders);
        const internalPath = url.pathname.replace(/^\/v1/, "") + url.search; const response = await (await ledgerForKey(env, key)).fetch(`https://ledger${internalPath}`); const headers = new Headers(response.headers); Object.entries(responseHeaders).forEach(([name, value]) => headers.set(name, value)); return new Response(response.body, { status: response.status, headers });
      }
      if (url.pathname === "/v1/consume") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, responseHeaders); const key = clientKey(request); if (!key) return json({ error: "missing_key" }, 401, responseHeaders);
        const body = await request.text(); const response = await (await ledgerForKey(env, key)).fetch("https://ledger/consume", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.headers.get("idempotency-key") || "" }, body: body || "{}" }); const headers = new Headers(response.headers); Object.entries(responseHeaders).forEach(([name, value]) => headers.set(name, value)); return new Response(response.body, { status: response.status, headers });
      }
      return json({ error: "not_found" }, 404, responseHeaders);
    } catch (error) {
      console.error(JSON.stringify({ event: "billing_error", request_id: requestId, message: String(error?.message || error) }));
      return json({ error: "internal_error", request_id: requestId }, 500, responseHeaders);
    }
  },
};

export const __test = { sha256, validSignature, variantCatalog, publicPackage };
