import assert from 'node:assert/strict';
const origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuardLive-smoke/6.0 (operational; not monetizable)', 'cache-control': 'no-cache' };
async function get(path, accept = 'application/json') {
  const response = await fetch(origin + path, { headers: { ...headers, accept }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`); return response;
}
const identity = await (await get('/identity')).json(); assert.equal(identity.name, 'XGuard Live');
const home = await get('/', 'text/html'); const html = await home.text(); assert.match(html, /The live facts/); assert.doesNotMatch(html, /MONETIZE MY API|Paid API Gateway/);
if (process.env.EXPECTED_XGUARD_TAG) assert.equal(home.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG);
const health = await (await get('/healthz')).json(); assert.equal(health.storage, 'reachable');
assert.match(await (await get('/robots.txt', 'text/plain')).text(), /Sitemap:/);
assert.match(await (await get('/sitemap.xml', 'application/xml')).text(), /sitemapindex/);
assert.match(await (await get('/llms.txt', 'text/plain')).text(), /text\/markdown/);
const index = await (await get('/topics')).json();
if (index.items.length) {
  const entity = await (await get(`/live/${index.items[0].id}`)).json(); const fact = entity.facts[0];
  const path = new URL(fact.canonical_url).pathname;
  const value = await (await get(path)).json();
  assert.equal(value.fact.id, fact.id); assert.ok(value.fact.source_hash); assert.ok(value.fact.verified_at);
  for (const accept of ['text/html', 'text/markdown']) assert.ok((await (await get(path, accept)).text()).includes(fact.source_hash));
  await get(new URL(fact.history_url).pathname);
}
const admin = await fetch(origin + '/admin', { headers, signal: AbortSignal.timeout(15000) }); assert.equal(admin.status, 401);
const retired = await fetch(origin + '/marketplace', { headers, signal: AbortSignal.timeout(15000) }); assert.equal(retired.status, 410);
console.log(JSON.stringify({ ok: true, origin, verified_facts: health.verified, published_facts: health.facts, collector: health.collector, last_cron: health.last_cron, revenue_test_requests: 0 }, null, 2));
