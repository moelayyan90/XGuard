import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/live-entry.js';
import { environment } from './live-harness.mjs';

const kind = { x402Version: 2, scheme: 'exact', network: 'eip155:8453' };
test('production entry exposes exact Base v2 directly on both origins without a signer claim', async () => {
  for (const origin of ['https://api.xguardgate.com', 'https://xguardgate.com']) {
    const r = await app.fetch(new Request(origin + '/supported'), {}, {});
    assert.equal(r.status, 200); assert.equal(r.headers.has('location'), false);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), { kinds: [kind], extensions: [], signers: {} });
  }
});
test('all current x402 discovery aliases identify the facilitator, operator and canonical endpoints', async () => {
  for (const origin of ['https://api.xguardgate.com', 'https://xguardgate.com']) {
    for (const path of ['/.well-known/x402', '/.well-known/x402.json', '/.well-known/x402-facilitator.json', '/facilitator']) {
      const r = await app.fetch(new Request(origin + path), {}, {});
      assert.equal(r.status, 200); assert.equal(r.headers.has('location'), false);
      const b = await r.json(); assert.equal(b.role, 'facilitator'); assert.equal(b.x402Version, 2);
      assert.equal(b.operator.name, 'Mohammad Elayyan'); assert.equal(b.operator.contact, 'mo.elayyan2023@gmail.com');
      for (const endpoint of ['supported', 'verify', 'settle']) assert.equal(b.endpoints[endpoint], 'https://api.xguardgate.com/' + endpoint);
      assert.equal(b.network, kind.network); assert.equal(b.scheme, kind.scheme);
    }
  }
});
test('operator identity is visible in server HTML and retained in negotiated machine identity', async () => {
  const h = environment();
  try {
    for (const accept of ['*/*', 'text/html', 'application/json']) {
      const r = await app.fetch(new Request('https://xguardgate.com/identity', { headers: { accept } }), h.env, h.ctx);
      assert.equal(r.status, 200);
      const text = await r.text();
      for (const value of ['Mohammad Elayyan', 'mo.elayyan2023@gmail.com', 'https://github.com/moelayyan90/XGuard']) assert.ok(text.includes(value));
      if (accept !== 'application/json') { assert.match(r.headers.get('content-type'), /text\/html/); assert.match(text, /<dt>Operator<\/dt><dd>Mohammad Elayyan<\/dd>/); }
    }
  } finally { await h.drain(); h.close(); }
});
for (const path of ['/verify', '/settle']) test(path + ' rejects invalid input before outbound calls or financial storage', async () => {
  const previous = globalThis.fetch; let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw Error('No network allowed'); };
  const env = { get QUOTAS() { throw Error('Financial state accessed'); }, get RECEIPTS() { throw Error('Financial state accessed'); } };
  try {
    for (const body of ['{}', '{', 'null', '[]', '{"x402Version":1}', '{"paymentPayload":"invalid"}']) {
      const r = await app.fetch(new Request('https://api.xguardgate.com' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body }), env, {});
      assert.equal(r.status, 400); assert.equal(r.headers.has('location'), false);
      assert.match(r.headers.get('content-type'), /application\/json/);
      const result = await r.json(); assert.ok(result.error || result.invalidReason || result.errorReason); assert.notEqual(result.success, true); assert.notEqual(result.isValid, true);
    }
    assert.equal(outbound, 0);
  } finally { globalThis.fetch = previous; }
});
test('CORS, HEAD, method and body limits are handled at the API boundary', async () => {
  for (const path of ['/supported', '/.well-known/x402', '/verify', '/settle']) {
    const r = await app.fetch(new Request('https://api.xguardgate.com' + path, { method: 'OPTIONS' }), {}, {});
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*');
  }
  const head = await app.fetch(new Request('https://api.xguardgate.com/supported', { method: 'HEAD' }), {}, {});
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const method = await app.fetch(new Request('https://api.xguardgate.com/settle'), {}, {}); assert.equal(method.status, 405);
  const large = await app.fetch(new Request('https://api.xguardgate.com/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(131073) }), {}, {});
  assert.equal(large.status, 413);
});
