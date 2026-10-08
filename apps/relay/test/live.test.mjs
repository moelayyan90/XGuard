import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { classify } from '../src/live/worker.ts';
import { sourceSpec, parseSource } from '../src/live/adapters.ts';
import { allowedUrl, boundedBody, robotsAllows, safeFetch } from '../src/live/security.ts';
import { stable, changeType, negotiate, retryDelay, shardName, shardOf, controlName } from '../src/live/util.ts';
import { storage, environment, seed } from './live-harness.mjs';
import { Store } from '../src/live/store.ts';
import { parseHTML } from 'linkedom';

test('stable normalization, typed comparisons and HTTP negotiation', () => {
  assert.equal(stable({ z: 1, a: ['x', false] }), '{"a":["x",false],"z":1}');
  assert.equal(changeType('input-price', 3, 2), 'price_decreased');
  assert.equal(changeType('latest-version', '1', '2'), 'released');
  assert.equal(changeType('status', 'up', null), 'removed');
  assert.equal(negotiate('application/json;q=.8,text/html;q=.2'), 'json');
  assert.equal(negotiate('text/html;q=0,*/*;q=1'), 'markdown');
  assert.equal(negotiate('application/xml'), null);
  assert.equal(negotiate('*/*'), 'html');
});
test('source canonicalization rejects SSRF and only uses official hosts', () => {
  assert.equal(sourceSpec('pypi', 'Foo_Bar.Baz').id, 'pypi/foo-bar-baz');
  for (const target of ['http://registry.npmjs.org/react', 'https://127.0.0.1/', 'https://[::1]/', 'https://registry.npmjs.org.evil.test/', 'https://user:pass@registry.npmjs.org/', 'https://registry.npmjs.org:8443/', 'https://169.254.169.254/']) assert.throws(() => allowedUrl(target));
  assert.throws(() => sourceSpec('npm', '../../admin'));
  assert.throws(() => sourceSpec('github', 'x/y/z'));
  assert.throws(() => allowedUrl('https://pypi.org/', 'https://registry.npmjs.org'));
});
test('robots longest match, specific groups, wildcard and allow precedence', () => {
  const rules = 'User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.json$\n';
  assert.equal(robotsAllows(rules, '/private/token'), false);
  assert.equal(robotsAllows(rules, '/private/public'), true);
  assert.equal(robotsAllows(rules, '/file.json'), false);
  assert.equal(robotsAllows(rules, '/file.json?x=1'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: XGuardLiveBot\nAllow: /\n', '/react'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /x\nAllow: /x', '/x'), true);
});
test('bounded fetch rejects cross-origin redirects and oversized bodies', async () => {
  await assert.rejects(() => safeFetch('https://registry.npmjs.org/react/latest', {}, async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }), false));
  await assert.rejects(() => boundedBody(new Response('abcdef'), 3), /source_too_large/);
  const response = await safeFetch('https://registry.npmjs.org/react/latest', {}, async () => new Response('{}'), false);
  assert.equal(response.status, 200);
  assert.ok(retryDelay(0, 1, '120') >= 120000);
});
test('adapters validate identity and parse primary-source facts without guessing', () => {
  const spec = sourceSpec('npm', 'react');
  assert.throws(() => parseSource(spec, '{"name":"fake","version":"1"}'), /schema_mismatch/);
  const result = parseSource(spec, '{"name":"react","version":"2.0.0","engines":{"node":">=18"}}');
  assert.equal(result.facts.find(x => x.key === 'latest-version').value, '2.0.0');
  assert.equal(result.facts.find(x => x.key === 'deprecated').value, false);
  assert.equal(result.facts.some(x => x.key === 'license'), false);
  const pypi = parseSource(sourceSpec('pypi', 'requests'), JSON.stringify({ info: { name: 'requests', version: '1', requires_python: '>=3.10' }, releases: { 1: [{ upload_time_iso_8601: '2026-01-01T00:00:00Z', yanked: false }] } }));
  assert.equal(pypi.facts.find(x => x.key === 'release-yanked').value, false);
  assert.throws(() => parseSource(sourceSpec('pricing', 'openai'), '<table><tr><th>Model</th><th>Input</th><th>Output</th></tr><tr><td>X</td><td>$2</td><td>$3</td></tr></table>'), /unverified/);
  const pricing = parseSource(sourceSpec('pricing', 'openai'), '<section>Per 1 million tokens<table><tr><th>Model</th><th>Input</th><th>Output</th></tr><tr><td>GPT X</td><td>$2</td><td>$3</td></tr></table></section>');
  assert.equal(pricing.facts[0].value, 2);
});
test('temporal facts preserve changes, source evidence and immutable history', async () => {
  const h = environment();
  try {
    const { store } = await seed(h, '1.0.0', '2026-01-01T00:00:00Z');
    const original = store.history('npm/react/latest-version', 1)[0];
    await seed(h, '2.0.0');
    const current = store.fact('npm/react/latest-version');
    assert.equal(current.current_value, '2.0.0'); assert.equal(current.previous_value, '1.0.0');
    assert.equal(current.change_type, 'released'); assert.equal(store.history(current.id, 1).length, 2);
    assert.equal(store.history(current.id, 1)[1].id, original.id);
    assert.throws(() => store.run('UPDATE fact_observations SET value_json=? WHERE id=?', '"bad"', original.id), /immutable_history/);
    assert.throws(() => store.run('DELETE FROM fact_changes'), /immutable_history/);
    assert.throws(() => store.run('DELETE FROM evidence'), /immutable_history/);
    const before = store.one('SELECT count(*) AS n FROM fact_changes').n;
    await seed(h, '2.0.0'); assert.equal(store.one('SELECT count(*) AS n FROM fact_changes').n, before);
    assert.equal(store.history(current.id, 1).length, 3);
  } finally { h.close(); }
});
test('stale values never masquerade as current, and 304 needs prior evidence', async () => {
  const h = environment();
  try {
    const { store } = await seed(h, '1.0.0', '2020-01-01T00:00:00Z');
    assert.equal(store.fact('npm/react/latest-version').verification, 'STALE');
    assert.equal(store.fact('npm/react/latest-version').current_value, null);
    const source = store.one('SELECT * FROM sources WHERE id=?', 'npm/react');
    store.revalidated(source, new Date().toISOString(), Date.now() + 10000);
    assert.equal(store.fact('npm/react/latest-version').current_value, '1.0.0');
    store.failed(source, 'source_http_503', 10000);
    assert.equal(store.fact('npm/react/latest-version').verification, 'STALE');
    assert.throws(() => store.revalidated({ id: 'npm/unknown' }, new Date().toISOString(), 1), /304_without/);
  } finally { h.close(); }
});
test('an invalid observation rolls back the whole write', async () => {
  const h = environment(); try {
    const { store, spec } = await seed(h);
    const before = store.stats();
    assert.throws(() => store.observe({ spec, facts: [{ key: 'invalid/key', label: 'bad', value: 'x' }], observedAt: new Date().toISOString(), hash: 'a'.repeat(64), fetchId: 'x', method: 'test' }, 0));
    assert.deepEqual(store.stats(), before);
  } finally { h.close(); }
});
test('canonical HTML, Markdown and JSON expose equivalent verified facts with no auth', async () => {
  const h = environment(); try {
    await seed(h, '19.0.0');
    const url = 'https://xguardgate.com/fact/npm/react/latest-version';
    for (const accept of ['text/html', 'text/markdown', 'application/json']) {
      const response = await worker.fetch(new Request(url, { headers: { accept } }), h.env, h.ctx);
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), new RegExp(accept));
      const text = await response.text(); assert.ok(text.includes('19.0.0'));
      const citedSource = accept === 'application/json' ? JSON.parse(text).fact.source_url
        : accept === 'text/markdown' ? text.match(/^Source: (.+)$/m)?.[1]
        : parseHTML(text).document.querySelector('aside a[rel]')?.getAttribute('href');
      assert.equal(citedSource, 'https://registry.npmjs.org/react/latest');
      assert.equal(response.headers.get('vary'), 'Accept'); assert.ok(response.headers.get('strict-transport-security'));
      if (accept === 'text/html') {
        const { document } = parseHTML(text), schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        assert.equal(schema['@type'], 'Dataset'); assert.equal(schema.variableMeasured.value, '19.0.0');
        assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'), url);
        assert.equal(document.querySelectorAll('script:not([type="application/ld+json"])').length, 0);
      }
    }
    await h.drain();
  } finally { h.close(); }
});
test('public discovery, permanent changes, robots, sitemap, 404/410 and safe redirects', async () => {
  const h = environment(); try {
    const { store } = await seed(h); const changes = store.changes('npm/react');
    for (const path of ['/', '/live/npm/react', '/history/npm/react/latest-version', `/changes/npm/react/${changes[0].id}`, '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/xguard-live.json', '/topics', '/search?q=react', '/changes.atom']) {
      const response = await worker.fetch(new Request(`https://xguardgate.com${path}`), h.env, h.ctx); assert.equal(response.status, 200, path);
    }
    const robots = await (await worker.fetch(new Request('https://xguardgate.com/robots.txt'), h.env, h.ctx)).text();
    assert.equal(robotsAllows(robots, '/live/npm/react', 'OAI-SearchBot'), true);
    assert.equal(robotsAllows(robots, '/live/npm/react', 'GPTBot'), false);
    const site = await worker.fetch(new Request(`https://xguardgate.com/sitemaps/facts-${shardOf('npm/react')}-1.xml`), h.env, h.ctx);
    assert.match(await site.text(), /\/fact\/npm\/react\/latest-version/);
    assert.equal((await worker.fetch(new Request('https://xguardgate.com/fact/npm/not-real/latest-version'), h.env, h.ctx)).status, 404);
    assert.equal((await worker.fetch(new Request('https://xguardgate.com/marketplace'), h.env, h.ctx)).status, 410);
    const alias = await worker.fetch(new Request('https://api.xguardgate.com/live/npm/react'), h.env, h.ctx); assert.equal(alias.status, 308); assert.equal(alias.headers.get('location'), 'https://xguardgate.com/live/npm/react');
    await h.drain();
  } finally { h.close(); }
});
test('HEAD and conditional responses preserve representation metadata', async () => {
  const h = environment(); try {
    await seed(h);
    const url = 'https://xguardgate.com/fact/npm/react/latest-version', headers = { accept: 'application/json' };
    const response = await worker.fetch(new Request(url, { headers }), h.env, h.ctx), etag = response.headers.get('etag');
    const head = await worker.fetch(new Request(url, { method: 'HEAD', headers }), h.env, h.ctx);
    assert.equal(await head.text(), ''); assert.equal(head.status, 200);
    const conditional = await worker.fetch(new Request(url, { headers: { ...headers, 'if-none-match': etag } }), h.env, h.ctx);
    assert.equal(conditional.status, 304); assert.equal(await conditional.text(), '');
    await h.drain();
  } finally { h.close(); }
});
test('admin authentication, CSRF, rate limits and corrections do not overwrite facts', async () => {
  const h = environment(); try {
    const { store } = await seed(h);
    assert.equal((await worker.fetch(new Request('https://xguardgate.com/admin'), h.env, h.ctx)).status, 401);
    const bearer = { authorization: `Bearer ${h.env.LIVE_ADMIN_KEY}`, 'content-type': 'application/json' };
    const rejected = await worker.fetch(new Request('https://xguardgate.com/admin/refresh', { method: 'POST', headers: { ...bearer, origin: 'https://evil.example' }, body: '{"id":"npm/react"}' }), h.env, h.ctx); assert.equal(rejected.status, 403);
    const login = await worker.fetch(new Request('https://xguardgate.com/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://xguardgate.com' }, body: new URLSearchParams({ key: h.env.LIVE_ADMIN_KEY }) }), h.env, h.ctx);
    assert.equal(login.status, 303); assert.match(login.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const csrf = await worker.fetch(new Request('https://xguardgate.com/admin/refresh', { method: 'POST', headers: { cookie, origin: 'https://xguardgate.com', 'content-type': 'application/json' }, body: '{"id":"npm/react"}' }), h.env, h.ctx); assert.equal(csrf.status, 403);
    const before = store.fact('npm/react/latest-version').current_value;
    const correction = await worker.fetch(new Request('https://xguardgate.com/corrections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fact_id: 'npm/react/latest-version', source_url: 'https://registry.npmjs.org/react/latest', message: 'Please verify this published version again.' }) }), h.env, h.ctx);
    assert.equal(correction.status, 202); assert.equal(store.fact('npm/react/latest-version').current_value, before);
    await h.drain();
  } finally { h.close(); }
});
test('crawler classification distinguishes spoofed user agents from verified metadata', () => {
  const request = new Request('https://xguardgate.com/', { headers: { 'user-agent': 'GPTBot/1.0', 'x-verified-bot': 'true' } });
  assert.equal(classify(request).classification, 'claimed-ai');
  Object.defineProperty(request, 'cf', { value: { botManagement: { verifiedBot: true } } });
  assert.equal(classify(request).classification, 'verified-ai');
  assert.equal(classify(new Request('https://xguardgate.com/', { headers: { 'user-agent': 'XGuardLive-smoke/1' } })).synthetic, true);
});
test('monetization cannot activate without evidence; actual imports are idempotent and immutable', async () => {
  const h = environment(); try {
    const obj = h.env.LIVE_CONTROL.get(controlName);
    const call = async body => obj.fetch(new Request('https://internal/', { method: 'POST', body: JSON.stringify(body) }));
    const activate = await call({ op: 'monetization-config', config: { mode: 'selective', pay_per_crawl: 'active', pay_per_use: 'unverified', price_usd: '0.01' } }); assert.equal(activate.status, 400);
    const initial = await (await call({ op: 'state' })).json(); assert.equal(initial.report_count, 0); assert.equal(initial.config.mode, 'observe');
    const report = { op: 'report-import', report_hash: 'a'.repeat(64), report_reference: 'cloudflare-report:test-only', events: [{ external_id: 'fixture-event', program: 'pay-per-use', buyer: 'local-test-buyer', path: '/fact/npm/react/latest-version', occurred_at: new Date().toISOString(), amount_micros: 100, currency: 'USD', uses: 1 }] };
    assert.equal((await (await call(report)).json()).imported, 1);
    assert.equal((await (await call(report)).json()).imported, 0);
    assert.throws(() => obj.store.run('DELETE FROM monetization_events'), /immutable_history/);
    report.events[0].amount_micros = 200; assert.equal((await call(report)).status, 400);
    const state = await (await call({ op: 'state' })).json(); assert.equal(state.revenue[0].amount_micros, 100);
  } finally { h.close(); }
});
test('schema migration is repeatable and preserves historical rows', async () => {
  const db = storage(); const first = new Store(db); first.set('sentinel', 42); const second = new Store(db);
  assert.equal(second.get('sentinel'), 42); assert.equal(second.one('SELECT count(*) AS n FROM schema_versions').n, 1); db.db.close();
});

test('demand expansion queues only observed official relationships and remains unpublished', async () => {
  const { expandDemand } = await import('../src/live/worker.ts');
  const h = environment(); try {
    const { store } = await seed(h);
    store.run('INSERT INTO entity_relationships VALUES(?,?,?)', 'npm/react', 'npm/scheduler', 'declared-dependency');
    for (let i = 0; i < 3; i++) {
      await worker.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version', { headers: { 'user-agent': 'Example browser' } }), h.env, h.ctx);
      await h.drain();
    }
    await expandDemand(h.env);
    const target = h.env.LIVE_SHARDS.get(shardName(shardOf('npm/scheduler'))).store;
    assert.ok(target.one('SELECT id FROM sources WHERE id=?', 'npm/scheduler'));
    assert.equal(target.entity('npm/scheduler'), null);
    await expandDemand(h.env);
    assert.equal(target.stats().sources, 1);
  } finally { await h.drain(); h.close(); }
});
test('in-band prices keep discovery free and never enable themselves', async () => {
  const { crawlPrice } = await import('../src/live/worker.ts');
  const ready = {mode:'full',pay_per_crawl:'active',discovery_exemptions_verified:true,dynamic_pricing_verified:true,price_usd:'0.001'};
  for (const path of ['/', '/robots.txt', '/llms.txt', '/sitemaps/facts-1-1.xml', '/topics', '/live/npm/react', '/.well-known/xguard-live.json']) assert.equal(crawlPrice(path, ready), 'USD 0');
  assert.equal(crawlPrice('/fact/npm/react/latest-version', ready), 'USD 0.001');
  assert.equal(crawlPrice('/fact/npm/react/latest-version', {...ready,mode:'observe'}), 'USD 0');
  assert.equal(crawlPrice('/fact/npm/react/latest-version', {...ready,dynamic_pricing_verified:false}), 'USD 0');
});

test('business ratios use actual reports and invoices with honest unknown states', async () => {
  const {businessMetrics} = await import('../src/live/metrics.ts');
  const clock = new Date('2026-10-04T00:00:00Z');
  const traffic = [{requests:[{day:'2026-10-04',classification:'verified-ai',requests:1000}],top_pages:[],repeat:{crawlers:0}}];
  const empty = {revenue:[],costs:[],category_revenue:[]};
  assert.equal(businessMetrics(empty, traffic, clock).reported_gross_revenue_usd, null);
  const state = {...empty,revenue:[{day:'2026-10-04',program:'pay-per-crawl',amount_micros:2000000,uses:5}],costs:[{month:'2026-10',amount_micros:500000}]};
  const metrics = businessMetrics(state, traffic, clock);
  assert.equal(metrics.reported_revenue_per_1000_verified_ai_requests_usd, 2);
  assert.equal(metrics.reported_gross_margin, .75);
  assert.equal(metrics.paid_retrievals_reported, 5);
  assert.equal(businessMetrics(state, [], clock).invoiced_cost_per_1000_requests_usd, null);
});

test('vendor tiered pricing cannot mix context bands or undocumented units', () => {
  const spec=sourceSpec('pricing','openai');
  const table='<table><thead><tr><th></th><th>Short context</th><th>Long context</th></tr><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Cache writes</th><th>Output</th><th>Input</th><th>Cached input</th><th>Cache writes</th><th>Output</th></tr></thead><tbody><tr><td>example-model</td><td>$1</td><td>$0.1</td><td>$0.2</td><td>$3</td><td>$2</td><td>$0.2</td><td>$0.4</td><td>$5</td></tr></tbody></table>';
  const document='<p>Prices per 1M tokens.</p><section><astro-island component-export="TextTokenPricingTables" props=\'{"tier":[0,"standard"]}\'>'+table+'</astro-island></section>';
  const facts=parseSource(spec,document).facts;
  assert.equal(facts.find(x=>x.key==='example-model-standard-short-context-input-price').value,1);
  assert.equal(facts.find(x=>x.key==='example-model-standard-long-context-input-price').value,2);
  assert.throws(()=>parseSource(spec,document.replace('Prices per 1M tokens.','Undocumented unit')),/pricing_table_unverified/);
});

test('public indexes share one durable snapshot across concurrent requests and object restarts', async () => {
  const h = environment();
  try {
    await seed(h);
    let reads = 0;
    const get = h.env.LIVE_SHARDS.get;
    h.env.LIVE_SHARDS.get = id => ({ ...get(id), async fetch(request) { reads++; return get(id).fetch(request); } });
    const request = path => worker.fetch(new Request('https://xguardgate.com' + path, { headers: { accept: 'application/json', 'user-agent': 'XGuardLive-regression' } }), h.env, h.ctx);
    const health = await Promise.all(Array.from({ length: 8 }, () => request('/healthz')));
    assert.ok(health.every(r => r.status === 200)); assert.equal(reads, 32);
    const stats = await health[0].json(); assert.equal(stats.facts, 4); assert.ok(stats.catalog_as_of);
    for (const path of ['/', '/topics', '/changes', '/sitemap.xml', '/sitemaps/site.xml']) assert.equal((await request(path)).status, 200);
    assert.equal(reads, 32, 'repeated global pages must not fan out across all shards');
    const previous = h.controls.get(controlName);
    const { LiveControl } = await import('../src/live/objects.ts');
    h.controls.set(controlName, new LiveControl(previous.state, h.env));
    assert.equal((await request('/healthz')).status, 200); assert.equal(reads, 32, 'the catalog survives object eviction');
    await seed(h, '2.0.0'); reads = 0;
    const fact = await (await request('/fact/npm/react/latest-version')).json();
    assert.equal(fact.fact.current_value, '2.0.0'); assert.equal(reads, 1, 'a fact and its history use one storage request');
  } finally { await h.drain(); h.close(); }
});

test('aggregate snapshots age expired examples and invalidate suppressed entities', async () => {
  const h = environment(), originalNow = Date.now;
  try {
    const { store } = await seed(h);
    store.run('UPDATE fact_definitions SET max_age=1 WHERE id=?', 'npm/react/latest-version');
    const headers = { accept: 'application/json', 'user-agent': 'XGuardLive-regression' };
    const home = () => worker.fetch(new Request('https://xguardgate.com/', { headers }), h.env, h.ctx).then(r => r.json());
    assert.equal((await home()).examples[0].verification, 'VERIFIED');
    const now = originalNow(); Date.now = () => now + 2000;
    const expired = (await home()).examples[0];
    assert.equal(expired.verification, 'STALE'); assert.equal(expired.current_value, null); assert.equal(expired.normalized_value, null); assert.equal(expired.last_observed_value, '1.0.0');
    Date.now = originalNow;
    const suppressed = await worker.fetch(new Request('https://xguardgate.com/admin/suppress', { method: 'POST', headers: { authorization: `Bearer ${h.env.LIVE_ADMIN_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'npm/react', suppressed: true }) }), h.env, h.ctx);
    assert.equal(suppressed.status, 200);
    const updated = await home(); assert.equal(updated.stats.facts, 0); assert.equal(updated.examples.length, 0);
    assert.equal(store.one('SELECT count(*) AS n FROM fact_observations').n, 4);
  } finally { Date.now = originalNow; await h.drain(); h.close(); }
});

test('automatic alarms and domain contention cannot create a seconds-long retry loop', async () => {
  const h = environment({ LIVE_SOURCE_FETCHES: 'on' });
  try {
    const { object, store } = await seed(h), now = Date.now();
    store.set('last-tick', new Date(now).toISOString());
    store.run('UPDATE sources SET next_fetch=0');
    await object.wake(); assert.ok(object.state.storage.alarm >= now + 600000);
    await object.fetch(new Request('https://internal/', { method: 'POST', body: JSON.stringify({ op: 'seed', sources: [{ adapter: 'npm', identifier: 'undici' }] }) }));
    assert.ok(object.state.storage.alarm >= now + 600000, 'new candidates do not bypass the automatic alarm budget');
    store.deferDomain('registry.npmjs.org', 600000);
    assert.equal(store.claimDue(), null); assert.ok(store.nextDue() >= now + 600000);
    assert.ok(store.claimDue(now + 601000), 'the source becomes eligible after backoff');
  } finally { h.close(); }
});

test('existing schema opens read-only and additive migration preserves observations', async () => {
  const h = environment();
  try {
    const { store } = await seed(h), db = store.storage;
    store.run('UPDATE schema_versions SET version=1'); store.run('DROP INDEX fetch_time');
    const migrated = new Store(db);
    assert.equal(migrated.one('SELECT count(*) AS n FROM schema_versions').n, 2);
    assert.equal(migrated.one('SELECT count(*) AS n FROM fact_observations').n, 4);
    const readOnly = { ...db, sql: { exec(query, ...args) { assert.match(query, /^SELECT /); return db.sql.exec(query, ...args); } }, transactionSync() { throw new Error('Reopening storage must not write'); } };
    assert.equal(new Store(readOnly).fact('npm/react/latest-version').current_value, '1.0.0');
  } finally { h.close(); }
});

test('provider request exhaustion stays an honest 503 while static documentation remains available', async () => {
  const h = environment();
  try {
    h.env.LIVE_CONTROL = { idFromName: x => x, get: () => ({ fetch: async () => { throw new Error('Exceeded allowed volume of requests in Durable Objects free tier.'); } }) };
    const headers = { accept: 'application/json', 'user-agent': 'XGuardLive-regression' };
    const response = await worker.fetch(new Request('https://xguardgate.com/healthz', { headers }), h.env, h.ctx);
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    const failure = await response.json(); assert.equal(failure.error, 'storage_request_quota_exhausted'); assert.ok(Date.parse(failure.quota_reset_at) > Date.now());
    const home = await worker.fetch(new Request('https://xguardgate.com/', { headers: { ...headers, accept: 'text/html' } }), h.env, h.ctx);
    assert.equal(home.status, 503); assert.match(await home.text(), /Previously published facts are preserved/);
    assert.equal((await worker.fetch(new Request('https://xguardgate.com/methodology', { headers }), h.env, h.ctx)).status, 200);
  } finally { await h.drain(); h.close(); }
});
