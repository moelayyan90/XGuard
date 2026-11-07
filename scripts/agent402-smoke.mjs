import assert from 'node:assert/strict';
const api = 'https://api.xguardgate.com', site = 'https://xguardgate.com';
const reports = [];
async function call(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'XGuard-Agent402-safe-routing-check/1.0', ...init.headers }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(r.headers.has('location'), false, url + ': redirect forbidden');
  assert.equal(r.url, url); const text = await r.text();
  if (init.headers?.accept !== 'text/html') assert.match(r.headers.get('content-type'), /application\/json/);
  const record = { url, status: r.status, contentType: r.headers.get('content-type'), version: r.headers.get('x-xguard-worker-version-id'), body: text };
  reports.push(record); return { r, text };
}
const supported = await call(api + '/supported'); assert.equal(supported.r.status, 200);
const body = JSON.parse(supported.text);
assert.ok(body.kinds.some(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === 'eip155:8453'));
assert.ok(Array.isArray(body.extensions)); assert.equal(typeof body.signers, 'object');
const discovery = await call(api + '/.well-known/x402'); assert.equal(discovery.r.status, 200);
const identity = JSON.parse(discovery.text); assert.equal(identity.role, 'facilitator'); assert.equal(identity.x402Version, 2);
assert.equal(identity.operator.name, 'Mohammad Elayyan'); assert.equal(identity.operator.contact, 'mo.elayyan2023@gmail.com');
for (const name of ['supported', 'verify', 'settle']) assert.equal(identity.endpoints[name], api + '/' + name);
const page = await call(site + '/identity', { headers: { accept: 'text/html' } }); assert.equal(page.r.status, 200);
assert.match(page.r.headers.get('content-type'), /text\/html/);
for (const value of ['Mohammad Elayyan', 'mo.elayyan2023@gmail.com', 'https://github.com/moelayyan90/XGuard']) assert.ok(page.text.includes(value));
for (const path of ['/verify', '/settle']) {
  const { r, text } = await call(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400); const error = JSON.parse(text); assert.ok(error.invalidReason || error.errorReason || error.error);
  assert.notEqual(error.success, true); assert.notEqual(error.isValid, true);
}
console.log(JSON.stringify({ agent402Ready: true, paymentsExecuted: 0, reports: reports.map(x => ({ ...x, body: x.contentType.includes('text/html') ? 'Server HTML contains the operator, contact and repository.' : JSON.parse(x.body) })) }, null, 2));
