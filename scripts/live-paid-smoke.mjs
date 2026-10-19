import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const base = 'https://api.xguardgate.com/api/paid/v1';
const headers = { accept: 'application/json', 'user-agent': 'XGuardLiveSmoke/1.0', 'x-xguard-traffic-class': 'synthetic' };
export async function runPaidSmoke({ fetchImpl = globalThis.fetch, expectedTag = process.env.EXPECTED_XGUARD_TAG, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const get = (path, init = {}, timeout = 15000) => fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  let catalogResponse;
  // A Worker upload can reach the apex before the API hostname. Wait only for
  // the expected revision; genuine contract failures still fail verification.
  for (let attempt = 0; attempt < 6; attempt++) {
    catalogResponse = await get('/catalog', {}, 5000);
    if (!expectedTag || catalogResponse.headers.get('x-xguard-worker-version-tag') === expectedTag) break;
    if (attempt < 5) { await catalogResponse.body?.cancel(); await pause(5000); }
  }
  assert.equal(catalogResponse.status, 200);
  if (expectedTag) assert.equal(catalogResponse.headers.get('x-xguard-worker-version-tag'), expectedTag, 'API revision did not converge before the bounded deadline');
  const catalog = await catalogResponse.json(); assert.equal(catalog.public_facts_remain_free, true); assert.equal(catalog.services.length, 3);
  assert.deepEqual(catalog.services.map(x => [x.route, x.price.amount_atomic]), [['batch', '10000'], ['history', '20000'], ['compare', '20000']]);
  const unpaid = await get('/batch', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `monitor-${crypto.randomUUID()}` }, body: JSON.stringify({ facts: ['npm/react/latest-version'], max_amount_atomic: '10000' }) });
  const raw = await unpaid.text();
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error(`Paid probe returned non-JSON: HTTP ${unpaid.status}, revision ${unpaid.headers.get('x-xguard-worker-version-tag') || 'unknown'}, type ${unpaid.headers.get('content-type') || 'unknown'}`); }
  if (expectedTag) assert.equal(unpaid.headers.get('x-xguard-worker-version-tag'), expectedTag, 'Paid response revision differs from the verified catalog');
  assert.equal(result.result, undefined, 'Unsigned probes cannot receive a purchased result');
  assert.equal(result.receipt, undefined, 'Unsigned probes cannot produce a paid receipt');
  assert.ok([402, 503].includes(unpaid.status), JSON.stringify(result));
  if (unpaid.status === 402) { assert.equal(result.x402Version, 2); assert.equal(result.accepts[0].amount, '10000'); assert.ok(unpaid.headers.get('payment-required')); }
  else assert.ok(['paid_services_paused', 'paid_service_not_ready', 'paid_circuit_open', 'storage_request_quota_exhausted', 'storage_read_quota_exhausted', 'storage_write_quota_exhausted', 'paid_dependency_unavailable'].includes(result.error), JSON.stringify(result));
  return { paid_contract: 'passed', purchase_availability: unpaid.status === 402 ? 'challenge-ready-no-sale-proven' : 'blocked-no-payment-accepted', blocked_reason: result.reasons || result.error || null, payments_submitted: 0, production_sale_proven: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runPaidSmoke()));
