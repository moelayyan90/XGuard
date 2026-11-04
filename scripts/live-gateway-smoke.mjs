import assert from "node:assert/strict";

const host = "https://xguardgate.com";
const root = "/api/gateway/v1";
const path = root + "/fact/npm/react/latest-version";
const common = { "user-agent": "XGuardGateway-smoke/1.0 (operational; not monetizable)", "cache-control": "no-cache" };
const request = (resource, extra = {}) => fetch(host + resource, { headers: { ...common, ...extra }, redirect: "error", signal: AbortSignal.timeout(15_000) });

const catalog = await request(root + "/catalog");
assert.equal(catalog.status, 200);
const spec = await catalog.json();
assert.equal(spec.public_facts_remain_free, true);
assert.ok(spec.rails.some(r => r.name === "lemon" && r.price === "1 license credit" &&
  r.purchase_url === "https://credits.xguardgate.com/" && r.invoice_issuer === "Lemon Squeezy"));
const offer = await request(path);
assert.equal(offer.status, 402);
const challenge = JSON.parse(Buffer.from(offer.headers.get("payment-required"), "base64"));
assert.equal(challenge.x402Version, 2);
assert.equal(challenge.resource.url, host + path);
assert.equal(challenge.accepts[0].network, "eip155:8453");
assert.equal(challenge.accepts[0].amount, "1000");
assert.equal(challenge.accepts[0].payTo.toLowerCase(), "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07");
assert.equal(challenge.source, undefined);
assert.equal((await request(path, { "Payment-Signature": "invalid", "Idempotency-Key": "production-smoke-invalid" })).status, 402);

const billing = await request(path, { Authorization: "Bearer xgk_" + "0".repeat(64), "Idempotency-Key": "production-billing-denied" });
assert.equal(billing.status, 402, "Billing service must reject an unprovisioned fixture license");
const denial = await billing.json();
assert.equal(denial.error, "lemon_license_not_authorized");
assert.equal(denial.source, undefined);
assert.equal((await request(root + "/test-base")).status, 200);

const supported = await fetch("https://facilitator.xpay.sh/supported", { redirect: "error", signal: AbortSignal.timeout(12000) });
assert.equal(supported.status, 200);
assert.ok((await supported.json()).kinds.some(k => k.x402Version === 2 && k.scheme === "exact" && k.network === "eip155:8453"));
console.log(JSON.stringify({ gateway: "production", no_payment: offer.status, malformed: 402,
  existing_lemon_binding: true, invalid_license_denied: billing.status, base_xpay_supported: true,
  real_transfers: 0, real_credit_debits: 0 }));
