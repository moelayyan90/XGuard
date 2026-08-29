import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import test from "node:test";
import worker, { CreditLedger, OrderIndex } from "./index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async list(options = {}) {
    let entries = [...this.values.entries()].filter(([key]) => !options.prefix || key.startsWith(options.prefix));
    entries.sort(([left], [right]) => left.localeCompare(right));
    if (options.reverse) entries.reverse();
    if (options.limit) entries = entries.slice(0, options.limit);
    return new Map(entries.map(([key, value]) => [key, structuredClone(value)]));
  }
  async transaction(callback) { return callback(this); }
}

class Namespace {
  constructor(Type) { this.Type = Type; this.instances = new Map(); }
  getByName(name) {
    if (!this.instances.has(name)) this.instances.set(name, new this.Type({ storage: new MemoryStorage() }));
    const instance = this.instances.get(name);
    return { fetch: (input, init) => instance.fetch(new Request(input, init)) };
  }
}

function environment() {
  return {
    CREDITS: new Namespace(CreditLedger),
    ORDERS: new Namespace(OrderIndex),
    PUBLIC_SITE_ORIGIN: "https://xguardgate.com",
    LEMONSQUEEZY_CHECKOUT_URL: "https://example.lemonsqueezy.com/buy/example",
    LEMONSQUEEZY_ALLOWED_PRODUCTS: "1315065",
    LEMONSQUEEZY_VARIANT_CREDITS: '{"2056392":5000}',
    LEMONSQUEEZY_PUBLIC_VARIANT_ID: "2056392",
    LEMONSQUEEZY_PUBLIC_PRICE_MINOR: "355",
    LEMONSQUEEZY_PUBLIC_CURRENCY: "JOD",
    LEMONSQUEEZY_WEBHOOK_SECRET: "test-webhook-secret",
    ALLOW_TEST_WEBHOOKS: "false",
  };
}

async function call(env, path, init = {}) {
  return worker.fetch(new Request(`https://hooks.xguardgate.com${path}`, init), env);
}

function signedWebhook(env, payload, signature = null) {
  const raw = JSON.stringify(payload);
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature || createHmac("sha256", env.LEMONSQUEEZY_WEBHOOK_SECRET).update(raw).digest("hex") },
    body: raw,
  };
}

function orderPayload(checkoutId, overrides = {}) {
  return {
    meta: { event_name: "order_created", test_mode: false, custom_data: { xguard_checkout_id: checkoutId } },
    data: { id: "order-100", type: "orders", attributes: { status: "paid", total: 355, currency: "JOD", first_order_item: { product_id: 1315065, variant_id: 2056392 }, ...overrides } },
  };
}

async function newCheckout(env) {
  const response = await call(env, "/v1/checkout", { method: "POST", headers: { "content-type": "application/json", origin: "https://xguardgate.com" }, body: "{}" });
  assert.equal(response.status, 201);
  return response.json();
}

test("verified paid order grants the configured variant credits once", async () => {
  const env = environment();
  const checkout = await newCheckout(env);
  assert.match(checkout.operator_key, /^xgk_[a-f0-9]{64}$/);
  assert.equal(new URL(checkout.checkout_url).searchParams.get("checkout[custom][xguard_checkout_id]"), checkout.checkout_id);
  const payload = orderPayload(checkout.checkout_id);
  const first = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, payload));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).credits, 5000);
  const duplicate = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, payload));
  assert.equal((await duplicate.json()).idempotent, true);
  const balance = await call(env, "/v1/balance", { headers: { authorization: `Bearer ${checkout.operator_key}` } });
  assert.deepEqual(await balance.json(), { credits: 5000, granted: 5000, consumed: 0, refunded_credits: 0, debt_credits: 0, restricted: false });
});

test("invalid signature, missing checkout metadata, and unknown variants fail closed", async () => {
  const env = environment();
  const checkout = await newCheckout(env);
  const invalid = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, orderPayload(checkout.checkout_id), "0".repeat(64)));
  assert.equal(invalid.status, 401);
  const missing = orderPayload(checkout.checkout_id); delete missing.meta.custom_data;
  assert.equal((await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, missing))).status, 422);
  const unknown = orderPayload(checkout.checkout_id, { first_order_item: { product_id: 1315065, variant_id: 9999999 } });
  assert.equal((await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, unknown))).status, 422);
});

test("refund before purchase is retryable and an over-consumed refund creates debt", async () => {
  const env = environment();
  const refund = { meta: { event_name: "order_refunded" }, data: { id: "order-100", attributes: { total: 355, refunded_amount: 355 } } };
  assert.equal((await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, refund))).status, 503);
  const checkout = await newCheckout(env);
  assert.equal((await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, orderPayload(checkout.checkout_id)))).status, 200);
  const consumed = await call(env, "/v1/consume", { method: "POST", headers: { authorization: `Bearer ${checkout.operator_key}`, "content-type": "application/json", "idempotency-key": "egress-1" }, body: JSON.stringify({ units: 100 }) });
  assert.equal(consumed.status, 200);
  const replay = await call(env, "/v1/consume", { method: "POST", headers: { authorization: `Bearer ${checkout.operator_key}`, "content-type": "application/json", "idempotency-key": "egress-1" }, body: JSON.stringify({ units: 100 }) });
  assert.equal((await replay.json()).idempotent, true);
  const refunded = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, refund));
  assert.equal(refunded.status, 200);
  const result = await refunded.json();
  assert.equal(result.credits, 0);
  assert.equal(result.debt_credits, 100);
  assert.equal(result.restricted, true);
  const blocked = await call(env, "/v1/consume", { method: "POST", headers: { authorization: `Bearer ${checkout.operator_key}`, "content-type": "application/json" }, body: JSON.stringify({ units: 1 }) });
  assert.equal(blocked.status, 403);
});

test("ledger and receipts reconcile purchase, consume, and refund", async () => {
  const env = environment();
  const checkout = await newCheckout(env);
  await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, orderPayload(checkout.checkout_id)));
  await call(env, "/v1/consume", { method: "POST", headers: { authorization: `Bearer ${checkout.operator_key}`, "content-type": "application/json" }, body: JSON.stringify({ units: 2, idempotency_id: "use-2" }) });
  const partial = { meta: { event_name: "order_refunded" }, data: { id: "order-100", attributes: { total: 355, refunded_amount: 71 } } };
  await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, partial));
  const ledger = await call(env, "/v1/ledger", { headers: { "x-xguard-key": checkout.operator_key } });
  const body = await ledger.json();
  assert.equal(body.entries.length, 3);
  assert.deepEqual(body.entries.map(entry => entry.type), ["refund", "consume", "purchase"]);
  assert.equal(body.balance, 3998);
  const receipt = await call(env, "/v1/receipt/xgr_2", { headers: { "x-xguard-key": checkout.operator_key } });
  assert.equal((await receipt.json()).type, "consume");
});

test("unknown signed events are acknowledged without credit changes", async () => {
  const env = environment();
  const response = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, { meta: { event_name: "subscription_created" }, data: { id: "sub-1" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, true);
});

test("a second paid order tops up the same operator key", async () => {
  const env = environment();
  const first = await newCheckout(env);
  await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, orderPayload(first.checkout_id)));
  const secondResponse = await call(env, "/v1/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator_key: first.operator_key }) });
  const second = await secondResponse.json();
  assert.equal(second.operator_key, undefined);
  const secondOrder = orderPayload(second.checkout_id); secondOrder.data.id = "order-101";
  const paid = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, secondOrder));
  assert.equal((await paid.json()).credits, 10000);
});

test("legacy production records and plural order mappings remain refundable", async () => {
  const env = environment();
  const key = "legacy-license-key";
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).toString("hex");
  const ledger = env.CREDITS.getByName(digest);
  const ledgerInstance = env.CREDITS.instances.get(digest);
  await ledgerInstance.ctx.storage.put("record", { provisioned: true, granted: 5000, balance: 4000, consumed: 1000, refunded_credits: 0, refunded_amount: 0, revoked: false, order_id: "legacy-order", created_at: new Date().toISOString() });
  env.ORDERS.getByName("order:legacy-order");
  await env.ORDERS.instances.get("order:legacy-order").ctx.storage.put("record", { key_hashes: [digest] });
  const refund = { meta: { event_name: "order_refunded" }, data: { id: "legacy-order", attributes: { total: 355, refunded_amount: 355 } } };
  const response = await call(env, "/webhooks/lemonsqueezy", signedWebhook(env, refund));
  assert.equal(response.status, 200);
  const balance = await ledger.fetch("https://ledger/balance");
  assert.deepEqual(await balance.json(), { credits: 0, granted: 5000, consumed: 1000, refunded_credits: 5000, debt_credits: 1000, restricted: true });
});
