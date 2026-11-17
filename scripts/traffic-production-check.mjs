import assert from 'node:assert/strict';

const origin = 'https://xguardgate.com';
const expected = process.env.EXPECTED_XGUARD_TAG;
const headers = { accept: 'text/html', 'user-agent': 'XGuard-traffic-contract-smoke/1.0', 'x-xguard-traffic-class': 'synthetic' };
async function read(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(origin + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (expected && r.headers.get('x-xguard-worker-version-tag') !== expected && attempt < 4) {
      await r.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 2000)); continue;
    }
    if (expected) assert.equal(r.headers.get('x-xguard-worker-version-tag'), expected, path);
    assert.equal(r.status, 200, path);
    return r;
  }
}
for (const path of ['/', '/marketplace', '/action/pricing', '/action/docs', '/products', '/compute', '/network', '/privacy']) {
  const r = await read(path), csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src [^;]*https:\/\/static\.cloudflareinsights\.com/, path);
  assert.match(csp, /connect-src [^;]*https:\/\/cloudflareinsights\.com/, path);
  assert.match(csp, /frame-ancestors 'none'/, path);
  assert.ok(!/noindex/i.test(r.headers.get('x-robots-tag') || ''), path);
  const html = await r.text();
  assert.match(html, /<link rel="canonical"/, path);
  if (path === '/') {
    assert.match(html, /property="og:description"/);
    assert.match(html, /type="application\/ld\+json"/);
  }
}
for (const path of ['/checkout?service=csv-clean', '/dashboard']) {
  const r = await read(path);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.ok(!(r.headers.get('content-security-policy') || '').includes('static.cloudflareinsights.com'));
  await r.body?.cancel();
}
const sitemap = await (await read('/sitemaps/site.xml')).text();
for (const path of ['/products', '/products/productized-services', '/compute', '/identity', '/privacy', '/refund-policy']) assert.ok(sitemap.includes('<loc>' + origin + path + '</loc>'), path);
assert.ok(!sitemap.includes('/checkout'));
console.log(JSON.stringify({ public_analytics_policy: 'passed', private_task_boundary: 'passed', product_discovery: 'passed', traffic_class: 'synthetic', browser_beacon_ingestion: 'requires one identified browser test and provider dashboard confirmation', human_visitors_measured_by_this_check: 0 }));
