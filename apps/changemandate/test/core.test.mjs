import test from "node:test";
import assert from "node:assert/strict";
import { evaluateChange, ChangeMandateError } from "../src/core.mjs";

const base = (overrides = {}) => ({
  request_id: "req-1", nonce: "nonce-1", operation: { type: "exchange" },
  original: {
    order_id: "o-1", checkout_hash: "h-1", merchant_id: "m-1", currency: "USD", one_time_total_minor: 10000,
    recurring: [], line_items: [{ id: "sku-a", quantity: 1, unit_price_minor: 10000 }],
    authorization: { max_additional_one_time_minor: 2500, allow_recurring: false, max_recurring_delta_minor: 0, allowed_merchants: ["m-1"], allow_currency_change: false, allow_multi_merchant: false, allow_quantity_increase: false }
  },
  proposed: { merchant_id: "m-1", currency: "USD", one_time_total_minor: 10000, recurring: [], line_items: [{ id: "sku-a", quantity: 1, unit_price_minor: 10000 }] },
  ...overrides
});

test("no additional liability is allowed", async () => { const r = await evaluateChange(base()); assert.equal(r.decision, "ALLOW"); assert.equal(r.delta.one_time_delta_minor, 0); });
test("positive exchange delta inside budget is allowed", async () => { const x = base(); x.proposed.one_time_total_minor = 11700; const r = await evaluateChange(x); assert.equal(r.decision, "ALLOW_WITHIN_PREAUTHORIZED_DELTA"); assert.equal(r.delta.one_time_delta_minor, 1700); });
test("positive delta above budget requires new authorization", async () => { const x = base(); x.proposed.one_time_total_minor = 14000; const r = await evaluateChange(x); assert.equal(r.decision, "NEW_AUTHORIZATION_REQUIRED"); assert.ok(r.reason_codes.includes("ONE_TIME_DELTA_EXCEEDS_BUDGET")); assert.equal(r.authorization_required.one_time_delta_minor, 4000); });
test("new subscription requires authorization by default", async () => { const x = base(); x.proposed.recurring = [{ key: "plus", amount_minor: 1200, currency: "USD", interval: "month" }]; const r = await evaluateChange(x); assert.equal(r.decision, "NEW_AUTHORIZATION_REQUIRED"); assert.ok(r.reason_codes.includes("RECURRING_LIABILITY_NOT_AUTHORIZED")); assert.equal(r.pricing.code, "recurring_liability_change"); });
test("authorized recurring delta can pass", async () => { const x = base(); x.original.authorization.allow_recurring = true; x.original.authorization.max_recurring_delta_minor = 1500; x.proposed.recurring = [{ key: "plus", amount_minor: 1200, currency: "USD", interval: "month" }]; const r = await evaluateChange(x); assert.equal(r.decision, "ALLOW_WITHIN_PREAUTHORIZED_DELTA"); });
test("currency change requires authorization", async () => { const x = base(); x.proposed.currency = "EUR"; const r = await evaluateChange(x); assert.equal(r.decision, "NEW_AUTHORIZATION_REQUIRED"); assert.ok(r.reason_codes.includes("CURRENCY_CHANGE_NOT_AUTHORIZED")); });
test("multi merchant change requires authorization and highest tier", async () => { const x = base(); x.proposed.merchant_ids = ["m-1", "m-2"]; const r = await evaluateChange(x); assert.equal(r.decision, "NEW_AUTHORIZATION_REQUIRED"); assert.equal(r.pricing.code, "multi_merchant_change"); });
test("refund is allowed", async () => { const x = base(); x.proposed.one_time_total_minor = 8000; const r = await evaluateChange(x); assert.equal(r.decision, "ALLOW"); assert.equal(r.delta.one_time_delta_minor, -2000); });
test("unsafe integer is rejected", async () => { const x = base(); x.proposed.one_time_total_minor = Number.MAX_SAFE_INTEGER + 2; await assert.rejects(() => evaluateChange(x), ChangeMandateError); });
test("fingerprint is stable", async () => { const a = await evaluateChange(base()); const b = await evaluateChange(base()); assert.equal(a.change_fingerprint, b.change_fingerprint); });
