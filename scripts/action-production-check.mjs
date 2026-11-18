import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function runActionSmoke({
  fetchImpl = globalThis.fetch,
  expectedTag = process.env.EXPECTED_XGUARD_TAG,
  origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com',
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const headers = { 'user-agent': 'XGuard-action-smoke/1.0', 'x-xguard-traffic-class': 'synthetic', 'cache-control': 'no-cache' };
  async function read(path, body) {
    let r;
    for (let attempt = 0; attempt < 8; attempt++) {
      r = await fetchImpl(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { ...headers, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (!expectedTag || r.headers.get('x-xguard-worker-version-tag') === expectedTag) break;
      if (attempt < 7) {
        await r.body?.cancel();
        await pause(3000);
      }
    }
    // Bounded retries accommodate mixed Cloudflare edge revisions, but can
    // NEVER accept an old deployment, a changed price, or an unpaid delivery.
    if (expectedTag) assert.equal(r.headers.get('x-xguard-worker-version-tag'), expectedTag, path);
    assert.equal(r.status, 200, path);
    return r;
  }
  const home = await (await read('/')).text(); assert.match(home, /XGUARD ACTION CLOUD/);
  const catalog = await (await read('/v1/checkout/catalog')).json();
  assert.equal(catalog.name, 'XGuard Action Cloud');
  assert.ok(catalog.services.some(s => s.id === 'csv-clean' && s.card_amount_cents === 200));
  const quote = await (await read('/v1/checkout/quote', { service: 'csv-clean', input: { csv: 'email,name\nsmoke@example.com,Synthetic smoke\n' } })).json();
  assert.equal(quote.amount_cents, 200);
  assert.equal(quote.currency, 'USD');
  if (catalog.payment?.ready && catalog.payment.readiness_url === '/v1/checkout/readiness') {
    assert.equal(quote.card_ready, true, 'Configured checkout could not read the order ledger');
    const ledger = await (await read('/v1/checkout/readiness')).json();
    assert.equal(ledger.scope, 'merchant_configuration_and_ledger_read');
    assert.equal(ledger.ready, true);
  }
  const checkout = await (await read('/checkout?service=csv-clean')).text();
  assert.match(checkout, /Review final price/);
  const spec = await (await read('/openapi.json')).json();
  assert.ok(spec.paths['/v1/checkout/orders']);
  return {
    action_cloud: 'passed',
    services: catalog.services.length,
    card_ready: catalog.payment.ready,
    blockers: catalog.payment.blockers,
    completed_financial_canary: false,
    real_payments: 0,
    real_sales: 'not established by this read-only smoke',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runActionSmoke()));
}
