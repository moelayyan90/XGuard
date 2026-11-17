import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import app from '../src/live-entry.js';
import { publicAnalyticsResponse } from '../src/public-analytics.js';
import { environment, seed } from './live-harness.mjs';

const script = 'https://static.cloudflareinsights.com';
const collector = 'https://cloudflareinsights.com';
const directives = r => new Map((r.headers.get('content-security-policy') || '').split(';').map(x => { const [key, ...values] = x.trim().split(/\s+/); return [key, values]; }));

test('all public HTML routers permit the existing Cloudflare beacon without a second injection or financial storage', async () => {
  const h = environment();
  try {
    await seed(h);
    for (const path of ['/', '/marketplace', '/action/pricing', '/action/docs', '/products', '/products/productized-services', '/compute', '/network', '/authority', '/topics', '/privacy']) {
      const r = await app.fetch(new Request('https://xguardgate.com' + path, { headers: { accept: 'text/html' } }), h.env, h.ctx);
      assert.equal(r.status, 200, path);
      const csp = directives(r);
      assert.ok(csp.get('script-src').includes(script), path);
      assert.ok(csp.get('connect-src').includes("'self'"), path);
      assert.ok(csp.get('connect-src').includes(collector), path);
      assert.deepEqual(csp.get('frame-ancestors'), ["'none'"], path);
      assert.ok(!csp.get('script-src').includes("'unsafe-inline'"), path);
      assert.ok(!csp.get('script-src').includes("'unsafe-eval'"), path);
      const html = await r.text();
      assert.ok(!html.includes('beacon.min.js'), 'Cloudflare owns injection at the edge');
      if (path === '/') assert.ok(csp.get('script-src').includes('https://www.paypal.com'), 'PayPal SDK stays permitted');
    }
    for (const path of ['/checkout', '/dashboard', '/admin', '/v1/checkout/config', '/openapi.json', '/mcp', '/.well-known/agent-card.json']) {
      const r = await app.fetch(new Request('https://xguardgate.com' + path), h.env, h.ctx);
      assert.ok(!(r.headers.get('content-security-policy') || '').includes(script), path);
    }
  } finally { await h.drain(); h.close(); }
});

test('HTML wrapper never alters private, failed, API or non-HTML responses or duplicates policy sources', async () => {
  const make = (status = 200, type = 'text/html', extra = {}) => new Response('original bytes', { status, headers: { 'content-type': type, 'content-security-policy': "default-src 'none'; script-src 'self'; script-src-elem 'none'; frame-ancestors 'none'", ...extra } });
  for (const [path, status, type, extra] of [['/dashboard', 200, 'text/html'], ['/checkout', 200, 'text/html'], ['/api/data', 200, 'text/html'], ['/v1/orders', 200, 'text/html'], ['/', 503, 'text/html'], ['/', 200, 'application/json'], ['/', 200, 'text/html', { 'x-robots-tag': 'noindex' }]]) {
    const response = make(status, type, extra);
    assert.equal(publicAnalyticsResponse(new Request('https://xguardgate.com' + path), response), response);
  }
  const request = new Request('https://xguardgate.com/products');
  const r = publicAnalyticsResponse(request, publicAnalyticsResponse(request, make()));
  assert.equal(await r.text(), 'original bytes');
  assert.deepEqual(directives(r).get('script-src-elem'), [script]);
  assert.deepEqual(directives(r).get('script-src'), ["'self'", script]);
});

test('product discovery sitemap and public social metadata remain accurate while private tasks stay unindexed', async () => {
  const h = environment();
  try {
    await seed(h);
    const sitemap = await (await app.fetch(new Request('https://xguardgate.com/sitemaps/site.xml'), h.env, h.ctx)).text();
    for (const path of ['/products', '/products/productized-services', '/compute', '/identity', '/privacy', '/refund-policy']) assert.ok(sitemap.includes('<loc>https://xguardgate.com' + path + '</loc>'));
    assert.ok(!sitemap.includes('/checkout'));
    const descriptions = new Set();
    for (const path of ['/', '/marketplace', '/action/pricing', '/action/docs']) {
      const r = await app.fetch(new Request('https://xguardgate.com' + path), h.env, h.ctx);
      const { document } = parseHTML(await r.text());
      const description = document.querySelector('meta[name=description]').getAttribute('content');
      descriptions.add(description);
      assert.equal(document.querySelector('meta[property="og:description"]').getAttribute('content'), description);
      assert.equal(document.querySelector('meta[property="og:url"]').getAttribute('content'), 'https://xguardgate.com' + path);
      assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index,follow');
      const schema = document.querySelector('script[type="application/ld+json"]');
      assert.equal(JSON.parse(schema.textContent).url, 'https://xguardgate.com' + path);
      assert.ok(directives(r).get('script-src').includes("'nonce-" + schema.getAttribute('nonce') + "'"));
    }
    assert.equal(descriptions.size, 4);
    for (const path of ['/checkout', '/dashboard']) {
      const r = await app.fetch(new Request('https://xguardgate.com' + path), h.env, h.ctx);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex');
      const { document } = parseHTML(await r.text());
      assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex,nofollow');
    }
  } finally { await h.drain(); h.close(); }
});
