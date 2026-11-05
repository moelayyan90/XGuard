import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
const origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuardLive-smoke/6.0 (operational; not monetizable)', 'cache-control': 'no-cache', 'x-xguard-traffic-class': 'synthetic' };
const candidate = process.env.CANDIDATE_WORKER_ID;
if (candidate) {
  assert.match(candidate, /^[0-9a-f-]{36}$/);
  headers['cloudflare-workers-version-overrides'] = `xguard-mainnet="${candidate}"`;
}
async function get(path, accept = 'application/json') {
  const response = await fetch(origin + path, { headers: { ...headers, accept }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.clone().json().catch(() => null) : null;
    const revision = response.headers.get('x-xguard-worker-version-tag');
    const quota = ['storage_request_quota_exhausted', 'storage_write_quota_exhausted', 'storage_read_quota_exhausted'].includes(body?.error);
    if (response.status === 503 && quota && process.env.EXPECTED_XGUARD_TAG && revision === process.env.EXPECTED_XGUARD_TAG && process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'quota_exhausted=true\n');
    }
    console.error(JSON.stringify({ path, status: response.status, revision, ray: response.headers.get('cf-ray'),
      reason: body?.error ?? (body?.collector === 'overdue' ? 'collector_overdue' : null), quota_reset_at: body?.quota_reset_at ?? null }));
  }
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  if (candidate) assert.equal(response.headers.get('x-xguard-worker-version-id'), candidate, `${path}: version override did not reach the candidate`);
  return response;
}
const identity = await (await get('/identity')).json(); assert.equal(identity.name, 'XGuard Live');
const health = await (await get('/healthz')).json(); assert.equal(health.storage, 'reachable');
const home = await get('/', 'text/html'); const html = await home.text(); assert.match(html, /The live facts/); assert.doesNotMatch(html, /MONETIZE MY API|Paid API Gateway/);
if (process.env.EXPECTED_XGUARD_TAG) assert.equal(home.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG);
if (process.env.EXPECT_LIVE_OPENAPI === 'true') {
  const manifest = await (await get('/.well-known/xguard-live.json')).json();
  assert.equal(manifest.openapi, origin + '/openapi.json');
  const spec = await (await get('/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  for (const route of ['batch', 'history', 'compare']) assert.ok(spec.paths[`/api/paid/v1/${route}`].post.responses['402']);
}
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
