import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { ACTION_BROWSER } from '../src/action/site.js';
import { cleanCsv, normalizeCsv, parseCsv } from '../src/action/csv.js';
import { actionCatalog, normalizeAction } from '../src/action/catalog.js';
import { LIVE_PAID } from '../src/live/paid-data.ts';
import { paypalApi, paypalConfig, paypalOrderBody, validatePaypalOrder, verifyPaypalWebhook } from '../src/action/paypal.js';
import { actionFetch } from '../src/action/gateway.js';
import { checkoutPreviewFetch } from '../src/action/checkout-preview.js';
import { PAYPAL_CHECKOUT_PREVIEW_ORIGIN } from '../src/action/paypal.js';

test('operator-only credential check never activates checkout, exposes a token or submits a transaction', async () => {
  const original=globalThis.fetch, key='private-operator-fixture-'.repeat(2); let calls=0;
  const env={LIVE_ADMIN_KEY:key,PAYPAL_ENVIRONMENT:'live',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'private-fixture-secret',PAYPAL_MERCHANT_ID:'TESTMERCHANT1',PAYPAL_WEBHOOK_ID:'fixture',PAYPAL_VERIFIED_EMAIL:'moelayyan2026@gmail.com',PAYPAL_ENABLED:'off'};
  const request=(secret)=>new Request('https://xguardgate.com/admin/action-cloud/paypal-readiness',{headers:secret?{authorization:'Bearer '+secret}:{}});
  try {
    globalThis.fetch=async (url,init)=>{calls++;assert.equal(url,'https://api-m.paypal.com/v1/oauth2/token');assert.equal(init.method,'POST');return Response.json({access_token:'private-fixture-access-token'});};
    for(const bad of [undefined,'wrong'])assert.equal((await actionFetch(request(bad),env)).status,401);
    assert.equal(calls,0);
    const r=await actionFetch(request(key),env), text=await r.text(), value=JSON.parse(text);
    assert.equal(r.status,200);assert.equal(value.credentials_valid,true);assert.equal(value.checkout_enabled,false);assert.equal(value.transactions_submitted,0);assert.equal(calls,1);
    assert.doesNotMatch(text,/private-fixture|TESTMERCHANT1|access_token|client_secret/);assert.match(r.headers.get('cache-control'),/no-store/);
    assert.equal((await actionFetch(request(key),{...env,PAYPAL_VERIFIED_EMAIL:'unverified@example.com'})).status,503);assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({error:'invalid_client',error_description:'private-fixture-description'},{status:401});
    const rejected=await actionFetch(request(key),env);assert.equal(rejected.status,503);assert.doesNotMatch(await rejected.text(),/private-fixture/);
  } finally {globalThis.fetch=original;}
});

test('isolated checkout preview cannot enable live payments or expose production routes', async () => {
  const env = { XGUARD_CHECKOUT_SANDBOX_PREVIEW: 'on', PAYPAL_ENVIRONMENT: 'sandbox' };
  const request = (path, origin = PAYPAL_CHECKOUT_PREVIEW_ORIGIN) => new Request(origin + path);
  assert.equal(await checkoutPreviewFetch(request('/'), {}), null);
  assert.equal((await checkoutPreviewFetch(request('/'), { ...env, PAYPAL_ENVIRONMENT: 'live' })).status, 503);
  assert.equal((await checkoutPreviewFetch(request('/', 'https://xguardgate.com'), env)).status, 503);
  for (const path of ['/mcp', '/witness', '/admin/paid-revenue', '/api/paid/v1/extract']) assert.equal((await checkoutPreviewFetch(request(path), env)).status, 404);
  const page = await checkoutPreviewFetch(request('/checkout?service=csv-clean'), env);
  assert.equal(page.status, 200); assert.match(page.headers.get('x-robots-tag'), /noindex/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /cloudflareinsights/);
});
test('Sandbox preview preserves same-origin protection, merchant binding and return URLs', async () => {
  const receiver = 'sandbox@business.example.com';
  const env = { XGUARD_CHECKOUT_SANDBOX_PREVIEW: 'on', PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'private-fixture-secret', PAYPAL_WEBHOOK_ID: 'fixture', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_SANDBOX_RECEIVER_EMAIL: receiver, PAYPAL_VERIFIED_EMAIL: receiver, PAYPAL_ENABLED: 'on' };
  const response = await checkoutPreviewFetch(new Request(PAYPAL_CHECKOUT_PREVIEW_ORIGIN + '/v1/checkout/config', { headers: { origin: PAYPAL_CHECKOUT_PREVIEW_ORIGIN } }), env);
  const body = await response.json(); assert.equal(body.ready, true); assert.equal(body.environment, 'sandbox'); assert.equal(body.client_secret, undefined);
  assert.equal(response.headers.get('access-control-allow-origin'), PAYPAL_CHECKOUT_PREVIEW_ORIGIN);
  assert.equal((await checkoutPreviewFetch(new Request(PAYPAL_CHECKOUT_PREVIEW_ORIGIN + '/v1/checkout/config', { headers: { origin: 'https://evil.example' } }), env)).status, 403);
  const q = { id: 'xgo_' + 'b'.repeat(40), amount_cents: 200 };
  assert.equal(paypalOrderBody(q, env).payment_source.paypal.experience_context.return_url, PAYPAL_CHECKOUT_PREVIEW_ORIGIN + '/dashboard?paypal=return');
  assert.equal(paypalOrderBody(q, env).payment_source.paypal.experience_context.cancel_url, PAYPAL_CHECKOUT_PREVIEW_ORIGIN + '/dashboard?paypal=cancel');
  assert.equal(paypalOrderBody(q, { ...env, PAYPAL_ENVIRONMENT: 'live' }).payment_source.paypal.experience_context.return_url, 'https://xguardgate.com/dashboard?paypal=return');
});
test('a refused provider OAuth client cannot create an order or leak its description', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const env = { PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'private-fixture-secret', PAYPAL_WEBHOOK_ID: 'fixture', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_VERIFIED_EMAIL: 'moelayyan2026@gmail.com', PAYPAL_ENABLED: 'on' };
  try {
    for (const [reply, expected] of [
      [Response.json({ error: 'invalid_client', error_description: 'private-fixture-description' }, { status: 401 }), 'paypal_oauth_invalid_client'],
      [new Response('<html>private-fixture-description</html>', { status: 403, headers: { 'content-type': 'text/html' } }), 'paypal_oauth_forbidden'],
      [Response.json({ token_type: 'Bearer' }), 'paypal_oauth_token_missing'],
    ]) {
      const before = calls;
      globalThis.fetch = async (url, init) => {
        calls++; assert.equal(url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
        assert.equal(init.headers.accept, 'application/json'); return reply;
      };
      await assert.rejects(() => paypalApi(env, 'POST', '/v2/checkout/orders', {}), error => {
        assert.equal(error.code, expected); assert.equal(error.status, 503);
        assert.doesNotMatch(JSON.stringify(error), /private-fixture/); return true;
      });
      assert.equal(calls, before + 1, 'No provider order request after rejected authentication');
    }
  } finally { globalThis.fetch = original; }
});

test('CSV transformation keeps every retained and duplicate row, parses quoted records and escapes formulas', () => {
  const r = cleanCsv({ csv: 'email,name,note\r\na@x.test, Alice ,"hello, world"\r\na@x.test,Alice,same key\r\nb@x.test,Bob,"multi\nline"\r\nc@x.test,=SUM(1),"say ""hi"""\r\n,,\r\n', key_columns: ['email'] });
  assert.equal(r.report.input_rows, 5); assert.equal(r.report.output_rows, 3); assert.equal(r.report.duplicate_rows, 1); assert.equal(r.report.blank_rows_removed, 1); assert.equal(r.report.cells_trimmed, 1); assert.equal(r.report.formula_cells_escaped, 1);
  assert.match(r.files[0].content, /'=SUM\(1\)/); assert.match(r.files[1].content, /same key/);
  assert.equal(parseCsv(r.files[0].content)[2][2], 'multi\nline');
  assert.equal(cleanCsv({ csv: 'n;value\n1;x\n1;x\n', delimiter: ';', dedupe: false }).report.output_rows, 2);
});
test('bad and excessive CSV input is rejected before purchase', () => {
  for (const csv of ['h,h\n1,2', 'h\n"bad', 'h\n"x" trailing', 'h\nx,y', 'h\na"b', 'h\n' + 'a'.repeat(65536), 'h\n' + Array(2001).fill('a').join('\n')]) assert.throws(() => normalizeCsv({ csv }));
  assert.throws(() => normalizeCsv({ csv: 'h\na', key_columns: ['missing'] }));
  assert.throws(() => normalizeCsv({ csv: 'h\na', command: 'execute' }));
});
test('all current paid services derive their card checkout from one registry and preserve x402 amounts', () => {
  const catalog = actionCatalog();
  for (const d of LIVE_PAID) { const p = catalog.find(p => p.id === d.id); assert.ok(p); assert.equal(p.amount, d.amount); assert.ok(p.card_amount_cents >= 200); assert.equal(p.checkout_url, '/checkout?service=' + d.id); const example = { ...d.example }; if (example.run_at) example.run_at = new Date(Date.now() + 60000).toISOString(); assert.equal(normalizeAction(d.id, example).input.capability, d.id); }
  assert.equal(normalizeAction('csv-clean', { csv: 'h\na' }).product.card_amount_cents, 200);
  assert.throws(() => normalizeAction('unbounded-shell', {}));
});
test('merchant activation fails closed and the receiving email cannot be replaced by config', () => {
  assert.equal(paypalConfig({}).ready, false);
  assert.equal(paypalConfig({ PAYPAL_VERIFIED_EMAIL: 'other@example.com' }).ready, false);
  const env = { PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_WEBHOOK_ID: 'fixture', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_VERIFIED_EMAIL: 'moelayyan2026@gmail.com', PAYPAL_ENABLED: 'on' };
  assert.equal(paypalConfig(env).ready, true);
  const q = { id: 'xgo_' + 'a'.repeat(40), amount_cents: 200 }, unit = { reference_id: q.id, custom_id: q.id, invoice_id: q.id, amount: { currency_code: 'USD', value: '2.00' }, payee: { merchant_id: env.PAYPAL_MERCHANT_ID, email_address: 'moelayyan2026@gmail.com' } };
  const order = { id: 'PAYPALORDER1', intent: 'CAPTURE', purchase_units: [unit] };
  assert.equal(validatePaypalOrder(order, q, env, true), null);
  assert.throws(() => validatePaypalOrder({ ...order, purchase_units: [{ ...unit, payee: { ...unit.payee, email_address: 'other@example.com' } }] }, q, env));
  assert.throws(() => validatePaypalOrder({ ...order, purchase_units: [{ ...unit, amount: { currency_code: 'USD', value: '0.01' } }] }, q, env));
});
test('unconfigured checkout exposes truthful prices without payment, storage or a buyer account', async () => {
  const request = (path, body, headers = {}) => new Request('https://xguardgate.com' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const r = await actionFetch(request('/v1/checkout/quote', { service: 'csv-clean', input: { csv: 'h\na' } }), {}); assert.equal(r.status, 200); assert.equal((await r.json()).card_ready, false);
  const blocked = await actionFetch(request('/v1/checkout/orders', { service: 'csv-clean', input: { csv: 'h\na' } }, { 'idempotency-key': 'fixture-unique-value', 'x-xguard-checkout-token': 'a'.repeat(64) }), {});
  assert.equal(blocked.status, 503);
  assert.equal((await actionFetch(request('/v1/checkout/quote', { service: 'csv-clean', input: { csv: 'h\na' } }, { origin: 'https://evil.example' }), {})).status, 403);
  const preflight = await actionFetch(new Request('https://xguardgate.com/v1/checkout/orders', { method: 'OPTIONS', headers: { origin: 'https://xguardgate.com' } }), {});
  assert.equal(preflight.status, 204); assert.equal(await preflight.text(), ''); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://xguardgate.com');
});
test('real Sandbox receiver identities cannot redirect the live merchant', async () => {
  const receiver = 'merchant@business.example.com';
  const env = { PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_WEBHOOK_ID: 'fixture', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_SANDBOX_RECEIVER_EMAIL: receiver, PAYPAL_VERIFIED_EMAIL: receiver, PAYPAL_ENABLED: 'on' };
  assert.equal(paypalConfig(env).ready, true);
  const q = { id: 'xgo_' + 'b'.repeat(40), name: 'Sandbox CSV cleanup', amount_cents: 200 };
  const body = paypalOrderBody(q, env);
  assert.equal(body.purchase_units[0].payee.email_address, receiver);
  validatePaypalOrder({ ...body, id: 'SANDBOXORDER1' }, q, env);
  assert.equal(paypalConfig({ ...env, PAYPAL_ENVIRONMENT: 'live' }).receiver, 'moelayyan2026@gmail.com');
  assert.ok(paypalConfig({ ...env, PAYPAL_ENVIRONMENT: 'live' }).blockers.includes('receiver_ownership_unverified'));
  const request = new Request('https://xguardgate.com/v1/checkout/webhooks/paypal', { headers: Object.fromEntries(['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'].map(k => [k, 'invalid'])) });
  await assert.rejects(() => verifyPaypalWebhook(env, request, {}), e => e.code === 'invalid_webhook_certificate' && e.status === 401);
});

test('verified results download with their signed receipt and survive a repeat recovery', async () => {
  const { document } = parseHTML('<html><body><section id="task-result" hidden><div id="downloads"></div><pre id="result-json"></pre></section></body></html>');
  const context = { document, URL, Blob };
  runInNewContext(ACTION_BROWSER, context);
  const receipt = { payload: { order_id: 'fixture' }, proof: 'signed-fixture' };
  const result = { data: { rows: 1 } };
  const output = { order: { id: 'fixture', receipt }, result };
  context.showResult(output);
  context.showResult(output);
  const links = [...document.querySelectorAll('#downloads a')];
  assert.deepEqual(links.map(link => link.download), ['result-fixture.json', 'receipt-fixture.json']);
  try {
    assert.deepEqual(await (await fetch(links[0].href)).json(), result);
    assert.deepEqual(await (await fetch(links[1].href)).json(), receipt);
  } finally {
    for (const link of links) URL.revokeObjectURL(link.href);
  }
});

test('PayPal returns resume only the original local purchase and cancellations perform no capture', async () => {
  const { document } = parseHTML('<html><body><div id="task-history"></div><div id="quote-status"></div></body></html>');
  const saved = { key: 'fixture-key', id: 'xgo_' + 'a'.repeat(40), token: 'r'.repeat(64), paypal_order_id: 'PAYPALORDER1', status: 'AWAITING_PAYMENT' };
  const calls = [];
  const location = { pathname: '/dashboard', search: '' };
  const context = {
    document, location, URLSearchParams, window: { history: { replaceState() {} } },
    localStorage: { getItem: () => JSON.stringify([saved]), setItem() {} },
    fetch: async (url, options) => {
      calls.push([url, options.method, options.headers['X-XGuard-Checkout-Token']]);
      return Response.json({ order: saved });
    },
  };
  runInNewContext(ACTION_BROWSER, context);
  for (const search of ['?paypal=cancel&token=PAYPALORDER1', '?paypal=return&token=UNRELATED', '?token=PAYPALORDER1']) {
    location.search = search;
    await context.resumePaypalReturn();
  }
  assert.deepEqual(calls, []);
  for (const search of ['?paypal=return&token=PAYPALORDER1', '?token=PAYPALORDER1&PayerID=legacy']) {
    location.search = search;
    await context.resumePaypalReturn();
  }
  assert.deepEqual(calls, Array(2).fill(['/v1/checkout/orders/' + saved.id + '/capture', 'POST', saved.token]));
});

test('quote and readiness report an exhausted checkout ledger without contacting PayPal', async () => {
  const config = { PAYPAL_ENVIRONMENT: 'live', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_WEBHOOK_ID: 'fixture', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_VERIFIED_EMAIL: 'moelayyan2026@gmail.com', PAYPAL_ENABLED: 'on' };
  let blocked = true, reads = 0;
  config.PAID_GATEWAY = { idFromName: name => name, get: name => ({ async fetch(url, init) {
    assert.equal(name, 'action-cloud-v1:references');
    assert.equal(url, 'https://action.internal/action/lookup');
    assert.equal(JSON.parse(init.body).reference, '__checkout_readiness__');
    reads++;
    if (blocked) throw Error('Exceeded allowed volume of requests in Durable Objects free tier');
    return Response.json({id:null});
  } }) };
  const check = () => actionFetch(new Request('https://xguardgate.com/v1/checkout/readiness'), config);
  const unavailable = await check();
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.headers.get('cache-control'), /no-store/);
  const quote = await actionFetch(new Request('https://xguardgate.com/v1/checkout/quote', {method:'POST',body:JSON.stringify({service:'csv-clean',input:{csv:'h\na'}})}), config);
  const data = await quote.json();
  assert.equal(data.amount_cents, 200); assert.equal(data.card_ready, false);
  assert.deepEqual(data.blockers, ['storage_request_quota_exhausted']);
  blocked = false;
  assert.equal((await (await check()).json()).ready, true);
  assert.equal(reads, 3);
});
