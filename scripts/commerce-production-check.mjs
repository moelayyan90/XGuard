import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PRODUCT_SERVICES } from '../apps/relay/src/products/registry.js';

const origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuard-commerce-smoke/1.0', 'x-xguard-traffic-class': 'synthetic', 'content-type': 'application/json', 'cache-control': 'no-cache' };
if (process.env.CANDIDATE_WORKER_ID) headers['cloudflare-workers-version-overrides'] = 'xguard-mainnet="' + process.env.CANDIDATE_WORKER_ID + '"';
async function fetchPath(path, body) {
  // Retrying a synthetic quote after an edge revision mismatch must preserve
  // the same idempotency key. Never sign, authorize or settle a payment here.
  const idempotencyKey = body ? 'commerce-smoke-' + crypto.randomUUID() : null;
  let r;
  for (let attempt = 0; attempt < 8; attempt++) {
    r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!process.env.EXPECTED_XGUARD_TAG || r.headers.get('x-xguard-worker-version-tag') === process.env.EXPECTED_XGUARD_TAG) break;
    if (attempt < 7) {
      await r.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  // Exactly one active version across each quoted/paid contract is mandatory.
  if (process.env.EXPECTED_XGUARD_TAG) assert.equal(r.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG, path);
  return r;
}
const catalogResponse = await fetchPath('/v1/commerce/catalog'); assert.equal(catalogResponse.status, 200);
const catalog = await catalogResponse.json(); assert.equal(catalog.products.length, 24);
for (const id of ['escrow', 'kv-cache', 'reputation-vault', 'gpu-marketplace', 'human-data']) assert.equal(catalog.products.find(p => p.id === id).adapters.length, 0);
const services = await (await fetchPath('/v1/checkout/catalog')).json();
for (const p of PRODUCT_SERVICES) {
  assert.ok(services.services.some(s => s.id === p.id && s.card_amount_cents === 200 && s.amount === '100000'));
  const quote = await fetchPath('/v1/checkout/quote', { service: p.id, input: Object.fromEntries(Object.entries(p.example).filter(([k]) => k !== 'max_amount_atomic')) });
  assert.equal(quote.status, 200, p.id); const value = await quote.json(); assert.equal(value.amount_cents, 200); assert.equal(value.currency, 'USD');
}
const partners = await (await fetchPath('/v1/commerce/partners')).json(); assert.ok(Array.isArray(partners.partners));
const blocked = await fetchPath('/v1/commerce/purchase', { service: 'escrow' }); assert.equal(blocked.status, 503);
const productPage = await fetchPath('/products/pii-redaction'); assert.equal(productPage.status, 200);
assert.match(await productPage.text(), /Pattern-based redaction/);
const manifest = await (await fetchPath('/server.json')).json(); assert.equal(manifest.name, 'io.github.moelayyan90/xguard'); assert.equal(manifest.version, '6.2.0');
const service = PRODUCT_SERVICES.find(p => p.route === 'redact');
const unpaid = await fetchPath('/api/paid/v1/redact', service.example);
if (catalog.new_service_purchase_enabled) {
  assert.equal(unpaid.status, 402, 'An enabled product must require payment without executing');
  const challenge = await unpaid.json(); assert.equal(challenge.accepts[0].amount, '100000'); assert.equal(challenge.accepts[0].network, 'eip155:8453'); assert.equal(challenge.result, undefined);
} else {
  assert.equal(unpaid.status, 503); assert.equal((await unpaid.json()).error, 'commerce_writer_activation_pending');
}
const report = { observed_at: new Date().toISOString(), source_tag: process.env.EXPECTED_XGUARD_TAG || null, commerce_products: catalog.products.length, bounded_new_adapters: PRODUCT_SERVICES.length, new_service_purchase_enabled: catalog.new_service_purchase_enabled, unpaid_http_status: unpaid.status, card_ready: services.payment.ready, card_blockers: services.payment.blockers, configured_partners: partners.partners.length, actual_payments_executed: 0, real_sales_established: false, scope: 'Read-only discovery, input/price validation and an unpaid challenge or writer gate. No capture, authorization signature, settlement, refund or supplier action.' };
if (process.env.COMMERCE_PRODUCTION_EVIDENCE) await writeFile(process.env.COMMERCE_PRODUCTION_EVIDENCE, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
