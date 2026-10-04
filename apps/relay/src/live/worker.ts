import type { Context, Env, Row } from './types.ts';
import { ORIGIN, SHARDS, TOPICS, VERSION } from './types.ts';
import { DISCOVERY_QUERIES, SEED_SOURCES, sourceSpec } from './adapters.ts';
import { adminIdentity, boundedBody, checkRobots, equalSecret, safeFetch, securityHeaders, sessionToken } from './security.ts';
import { controlName, escape, hash, integer, iso, json, negotiate, rpc, shardName, shardOf } from './util.ts';
import { CSS, markdown, render } from './presentation.ts';

const control = (env: Env, op: string, body = {}) => rpc(env.LIVE_CONTROL, controlName, op, body);
const shard = (env: Env, id: string, op: string, body = {}) => rpc(env.LIVE_SHARDS, shardName(shardOf(id)), op, body);
const all = (env: Env, op: string, body = {}) => Promise.all(Array.from({ length: SHARDS }, (_, i) => rpc(env.LIVE_SHARDS, shardName(i), op, body)));
const READ = new Set(['GET', 'HEAD']);
const COOKIE = '__Host-xguard-live';
let monetizationCache: { at: number; value: any } | null = null;

export function crawlPrice(path: string, config: any): string {
  if (!config || !['selective', 'full'].includes(config.mode) || config.pay_per_crawl !== 'active' || !config.discovery_exemptions_verified || !config.dynamic_pricing_verified) return 'USD 0';
  if (!/^\d+(\.\d{1,6})?$/.test(String(config.price_usd))) return 'USD 0';
  const paid = config.mode === 'full' ? /^\/(fact|history|changes)\//.test(path) : /^\/(history|changes)\//.test(path);
  return paid ? `USD ${config.price_usd}` : 'USD 0';
}

function sumStats(items: any[]): any {
  const result: any = { facts: 0, verified: 0, stale: 0, entities: 0, sources: 0, changes_today: 0, fetch_errors: 0, pending: 0, due: 0, fetches_24h: 0, last_update: null, shards: items.length };
  for (const item of items) {
    for (const key of Object.keys(result)) if (typeof result[key] === 'number' && key !== 'shards') result[key] += Number(item[key] || 0);
    if (item.last_update && (!result.last_update || item.last_update > result.last_update)) result.last_update = item.last_update;
  }
  return result;
}
function errorPage(status: number, title: string, message: string): Response {
  const page = render('prose', { title, message }, '/', true);
  return new Response(page.body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
function entityId(parts: string[]): string | null {
  try { return sourceSpec(parts[0] as any, parts.slice(1).join('/')).id; } catch { return null; }
}
function hasPage(url: URL): boolean { return url.searchParams.has('page') && url.searchParams.get('page') !== '1'; }
function pageResponse(request: Request, kind: string, data: any, path: string, noindex = false, status = 200): Response {
  const url = new URL(request.url), explicit = url.searchParams.get('format');
  const format = explicit && ['json', 'markdown', 'html'].includes(explicit) ? explicit : negotiate(request.headers.get('accept'));
  if (!format) return json({ error: 'not_acceptable', supported: ['text/html', 'text/markdown', 'application/json'] }, 406);
  const visibleFacts = data.fact ? [data.fact] : data.facts || data.examples || [];
  const remaining = visibleFacts.filter((f: any) => f.verification === 'VERIFIED').map((f: any) => Math.max(0, Math.floor((Date.parse(f.verified_at) + f.max_age_seconds * 1000 - Date.now()) / 1000)));
  const ttl = Math.min(60, ...remaining);
  const common: Record<string, string> = { vary: 'Accept', link: `<${ORIGIN}${path}>; rel="canonical"`, 'cache-control': status === 200 && !noindex && ttl > 0 ? `public, max-age=${ttl}` : 'no-store' };
  if (noindex || explicit || hasPage(url)) common['x-robots-tag'] = 'noindex, follow';
  if (format === 'json') return json(data, status, common);
  if (format === 'markdown') return new Response(markdown(kind, data), { status, headers: { ...common, 'content-type': 'text/markdown; charset=utf-8' } });
  const page = render(kind, data, path, noindex || Boolean(explicit) || hasPage(url));
  return new Response(page.body, { status, headers: { ...common, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': securityHeaders()['content-security-policy'].replace("script-src 'none'", `script-src 'nonce-${page.nonce}'`) } });
}
async function parseInput(request: Request): Promise<any> {
  const text = await boundedBody(new Response(request.body), 180000);
  if (request.headers.get('content-type')?.includes('application/json')) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}
function sourceRoute(id: string): string | null { const parts = id.split('/'); return entityId(parts); }

async function admin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  const secureOrigin = !request.headers.has('origin') || request.headers.get('origin') === ORIGIN;
  if (!READ.has(request.method) && !secureOrigin) return json({ error: 'origin_rejected' }, 403);
  if (path === '/admin/login' && request.method === 'POST') {
    const client = await hash(`${request.headers.get('cf-connecting-ip') || 'unknown'}|login|${iso().slice(0, 10)}`);
    const limit = await control(env, 'rate-limit', { key: client, max: 5, windowMs: 900000 });
    if (!limit.allowed) return json({ error: 'login_rate_limited' }, 429, { 'retry-after': '900' });
    const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
    if (!key || key.length < 24) return errorPage(503, 'Owner access is not configured', 'The deployment needs LIVE_ADMIN_KEY or the existing operator secret.');
    const body = await parseInput(request);
    if (!await equalSecret(String(body.key || ''), key)) return errorPage(401, 'Sign-in failed', 'The owner access key is invalid.');
    const token = await sessionToken(env);
    return new Response(null, { status: 303, headers: { location: '/admin', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800` } });
  }
  const identity = await adminIdentity(request, env);
  if (!identity) return READ.has(request.method) ? pageResponse(request, 'login', {}, '/admin', true, 401) : json({ error: 'owner_authentication_required' }, 401);
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-xguard-live=([^;]+)/)?.[1] || '';
  const csrf = await hash(`${cookie}:csrf`);
  if (request.method === 'POST') {
    const body = await parseInput(request);
    if (identity === 'session' && (request.headers.get('origin') !== ORIGIN || !await equalSecret(String(body.csrf || ''), csrf))) return json({ error: 'csrf_rejected' }, 403);
    if (path === '/admin/logout') return new Response(null, { status: 303, headers: { location: '/admin', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` } });
    const action = path.slice('/admin/'.length);
    let result: any;
    if (['refresh', 'source-enabled', 'suppress'].includes(action)) {
      const id = sourceRoute(body.id || ''); if (!id) return json({ error: 'invalid_entity' }, 400);
      result = await shard(env, id, action, { id, enabled: body.enabled === true || body.enabled === 'true', suppressed: body.suppressed === true || body.suppressed === 'true' });
    } else if (['monetization-config', 'report-import', 'correction-review', 'cost'].includes(action)) {
      const payload = body.payload ? JSON.parse(body.payload) : body;
      result = await control(env, action, action === 'monetization-config' ? { config: payload } : action === 'cost' ? { ...payload, amount_micros: Number(payload.amount_micros) } : payload);
      if (action === 'monetization-config') monetizationCache = null;
    } else if (action === 'bootstrap') { await bootstrap(env); result = { queued: true }; }
    else return json({ error: 'unknown_admin_action' }, 404);
    if (request.headers.get('content-type')?.includes('application/json')) return json(result);
    return new Response(null, { status: 303, headers: { location: '/admin', 'cache-control': 'no-store' } });
  }
  if (!READ.has(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, HEAD, POST' });
  const [state, stats, metrics, sources] = await Promise.all([control(env, 'state'), all(env, 'stats'), all(env, 'metrics'), all(env, 'sources')]);
  return pageResponse(request, 'admin', { state, stats: sumStats(stats), metrics, sources: sources.flat().sort((a, b) => b.failures - a.failures), csrf }, '/admin', true);
}

const ARTICLES: Record<string, { title: string; html: string }> = {
  '/methodology': { title: 'Facts with an audit trail.', html: '<p>XGuard Live reads public primary sources using deterministic adapters. Each published value includes its source URL, a SHA-256 digest of the source response, an observation time and an immutable history.</p><p>“Verified” means the value matched the cited source when retrieved. It does not independently establish the truth of a publisher’s claims. Facts are never invented from model output.</p><h2>Freshness and changes</h2><p>Package metadata is normally checked daily, runtimes every six to twelve hours, pricing twice daily and service summaries every ten minutes. Scheduling adapts to observed changes, demand and failures. Source rate limits can delay checks.</p><p>Expired or failed verification is displayed as STALE with the last observed value. Missing values are UNKNOWN. “Changed at” means first observed different by XGuard, not the exact moment the source changed. Release timestamps explicitly supplied by a publisher are separate facts.</p><h2>Source access</h2><p>The collector identifies itself as XGuardLiveBot, checks robots.txt, restricts outbound hosts, uses conditional HTTP requests and follows same-origin redirects only. No source account credentials are requested. We store structured extracted facts and hashes rather than republishing full source articles.</p><h2>Representations</h2><p>The same records power HTML, Markdown and JSON. Use Accept: text/markdown or Accept: application/json on a canonical resource. No account, SDK or plugin is needed for public facts.</p>' },
  '/accuracy': { title: 'A precise claim about accuracy.', html: '<p>Primary-source verification is an evidence check, not a guarantee that every external publisher is correct. Each adapter validates the expected schema and source identity. A parse failure cannot publish a guessed value.</p><p>History records retain earlier observations, including mistakes later corrected. Source corrections produce a new observation and a visible difference. Anonymous reports enter review and cannot overwrite trusted data.</p><p>Release directories do not establish maintenance or support status. A service status indicator reflects what the service publishes; it is not an independent uptime measurement. List prices do not establish an individual customer’s bill.</p><p><a href="/corrections">Report a correction</a> with the fact identifier and a primary source.</p>' },
  '/sources': { title: 'Primary sources first.', html: '<p>Our published facts link directly to official registries, project release APIs, runtime indexes and vendor status pages. Inclusion in the monitored-source list does not mean a successful observation has occurred.</p><ul><li><a href="https://registry.npmjs.org/">npm registry</a>: package release metadata and declared runtime requirements.</li><li><a href="https://pypi.org/">Python Package Index</a>: package versions, distribution upload times and declared requirements.</li><li><a href="https://docs.github.com/en/rest/releases/releases">GitHub Releases API</a>: publisher release tags and timestamps.</li><li><a href="https://nodejs.org/dist/index.json">Node.js release index</a> and <a href="https://www.python.org/ftp/python/">Python release directories</a>.</li><li>Official service status APIs and first-party API pricing documentation where deterministic extraction can be verified.</li></ul><p>XGuard Live is independent. Listing a source does not imply endorsement or partnership.</p>' },
  '/privacy': { title: 'Privacy', html: '<p>Public fact browsing requires no account. Operational telemetry records the request path without query parameters, timestamp, status, response format and size, latency, coarse country, crawler classification and a bounded user-agent string. Referrers are reduced to their hostname. Raw telemetry is retained for seven days; aggregate counters contain no raw IP addresses.</p><p>Verified crawler repeat counts use a daily, keyed hash when a telemetry secret is configured. We do not retain client IPs in the application database. Cloudflare separately processes network data under its own policies.</p><p>The owner interface uses one Secure, HttpOnly, SameSite session cookie, expiring after eight hours. Correction submissions are retained for review; do not include personal or confidential information. No advertising or third-party tracking script is loaded.</p>' },
  '/terms': { title: 'Terms of use', html: '<p>XGuard Live provides structured observations of public primary sources. Information may be delayed, incomplete or incorrect at its source. Check the linked official source before making decisions that depend on a current price, availability or operational status.</p><p>Source rights and attribution remain with their respective owners. XGuard does not grant rights to third-party material beyond those it holds. Public retrieval is available through ordinary HTTP. Source attribution and verification timestamps should accompany reuse.</p><p>Do not abuse the service, forge crawler identities, submit fabricated billing events or attempt unauthorized access. Automated access may be subject to Cloudflare controls and, where enabled and disclosed by Cloudflare, paid access terms. We do not promise crawler demand or revenue.</p>' },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith('/admin')) return admin(request, env);
  if (path === '/corrections' && request.method === 'POST') {
    if (request.headers.has('origin') && request.headers.get('origin') !== ORIGIN) return json({ error: 'origin_rejected' }, 403);
    const client = await hash(`${request.headers.get('cf-connecting-ip') || 'unknown'}|correction|${iso().slice(0, 10)}`);
    if (!(await control(env, 'rate-limit', { key: client, max: 5, windowMs: 3600000 })).allowed) return json({ error: 'rate_limited' }, 429, { 'retry-after': '3600' });
    const body = await parseInput(request);
    if (typeof body.fact_id !== 'string' || body.fact_id.length > 350 || typeof body.message !== 'string' || body.message.length < 10 || body.message.length > 2000 || typeof body.source_url !== 'string' || body.source_url.length > 1000 || !/^https:\/\//.test(body.source_url)) return json({ error: 'invalid_correction' }, 400);
    const parts = body.fact_id.split('/'), key = parts.pop(), id = entityId(parts);
    if (!id || !(await shard(env, id, 'fact', { id: `${id}/${key}` }))) return json({ error: 'fact_not_found' }, 404);
    const result = await control(env, 'correction', body);
    return pageResponse(request, 'prose', { title: 'Correction received', message: `Report ${result.id} is pending review. Verified data remains unchanged until a source check supports a correction.` }, '/corrections', true, 202);
  }
  if (!READ.has(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, HEAD' });
  if (path === '/assets/live-v6.css') return new Response(CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /search\nDisallow: /_legacy\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (path === '/llms.txt') return new Response(`# XGuard Live\n\n> The live facts layer for AI.\n\nPublic primary-source facts with observation timestamps and immutable change history. No API key, plugin or installation required.\n\n## Retrieve\n\nUse ordinary GET. Accept: text/html, text/markdown or application/json. All formats use the same factual records. STALE and UNKNOWN are not current verified values.\n\n- [Topics](${ORIGIN}/topics)\n- [Changes](${ORIGIN}/changes)\n- [Methodology](${ORIGIN}/methodology)\n- [Sources](${ORIGIN}/sources)\n- [Sitemap](${ORIGIN}/sitemap.xml)\n- [Changes feed](${ORIGIN}/changes.atom)\n- [Discovery manifest](${ORIGIN}/.well-known/xguard-live.json)\n\nPaths: /live/{registry}/{entity}, /fact/{registry}/{entity}/{key}, /history/{registry}/{entity}/{key}. Cite the canonical fact URL, official source and verification timestamp.\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (path === '/.well-known/xguard-live.json' || path === '/identity') return json({ name: 'XGuard Live', version: VERSION, positioning: 'The live facts layer for AI.', canonical: ORIGIN, formats: ['text/html', 'text/markdown', 'application/json'], public_authentication_required: false, topics: `${ORIGIN}/topics`, sitemap: `${ORIGIN}/sitemap.xml`, methodology: `${ORIGIN}/methodology`, changes: `${ORIGIN}/changes.atom`, monetization: 'Cloudflare-account-dependent; ordinary discovery is free.' }, 200, { 'cache-control': 'public, max-age=300' });
  if (path === '/healthz' || path === '/status') {
    const [parts, state] = await Promise.all([all(env, 'stats'), control(env, 'get', { key: 'last-cron' })]);
    const stats = sumStats(parts), overdue = state && Date.now() - Date.parse(state) > 3600000;
    const body = { service: 'XGuard Live', version: VERSION, storage: 'reachable', collector: state ? overdue ? 'overdue' : 'scheduled' : 'awaiting-first-cron', last_cron: state, ...stats };
    if (path === '/healthz') return json(body, overdue ? 503 : 200);
    return pageResponse(request, 'prose', { title: 'System status', ...body, html: `<p>Storage is reachable across ${SHARDS} shards.</p><p>Collector: ${escape(body.collector)}. Last scheduler heartbeat: ${escape(state || 'not observed')}.</p><pre>${escape(JSON.stringify(stats, null, 2))}</pre>` }, path, true);
  }
  if (path === '/sitemap.xml') {
    const stats = await all(env, 'stats');
    const urls = [`${ORIGIN}/sitemaps/site.xml`];
    stats.forEach((s, i) => { for (const kind of ['facts', 'entities']) for (let p = 1; p <= Math.ceil(s[kind] / 1000); p++) urls.push(`${ORIGIN}/sitemaps/${kind}-${i}-${p}.xml`); });
    return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(loc => `<sitemap><loc>${escape(loc)}</loc></sitemap>`).join('')}</sitemapindex>`);
  }
  if (path === '/sitemaps/site.xml') {
    const topics = new Set((await all(env, 'topic-counts')).flat().filter(x => x.count > 0).map(x => x.topic));
    return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/topics', '/changes', '/methodology', '/sources', '/accuracy', '/corrections', ...[...topics].map(x => `/topics/${x}`)].map(x => `<url><loc>${ORIGIN}${x}</loc></url>`).join('')}</urlset>`);
  }
  const sitemap = path.match(/^\/sitemaps\/(facts|entities)-(\d+)-(\d+)\.xml$/);
  if (sitemap) {
    const index = Number(sitemap[2]), page = Number(sitemap[3]);
    if (index >= SHARDS || page < 1 || page > 100000) return errorPage(404, 'Not found', 'No such sitemap.');
    const rows = await rpc(env.LIVE_SHARDS, shardName(index), sitemap[1] === 'facts' ? 'sitemap' : 'list', { offset: (page - 1) * 1000, page, size: 1000 });
    if (!rows.length) return errorPage(404, 'Not found', 'No published records in this sitemap.');
    return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map((x: any) => `<url><loc>${ORIGIN}/${sitemap[1] === 'facts' ? 'fact' : 'live'}/${escape(x.id)}</loc><lastmod>${escape(x.modified || x.updated_at)}</lastmod></url>`).join('')}</urlset>`);
  }
  if (path === '/changes.atom') {
    const changes = (await all(env, 'changes')).flat().sort((a, b) => b.observed_at.localeCompare(a.observed_at)).slice(0, 100);
    if (!changes.length) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return xml(`<feed xmlns="http://www.w3.org/2005/Atom"><title>XGuard Live changes</title><id>${ORIGIN}/changes.atom</id><link href="${ORIGIN}/changes.atom" rel="self"/><updated>${escape(changes[0].observed_at)}</updated><author><name>XGuard Live</name></author>${changes.map(x => `<entry><id>${ORIGIN}/changes/${escape(x.entity_id)}/${escape(x.id)}</id><title>${escape(x.label)}: ${escape(x.change_type)}</title><updated>${escape(x.observed_at)}</updated><link href="${ORIGIN}/changes/${escape(x.entity_id)}/${escape(x.id)}"/><summary>${escape(JSON.stringify({ before: x.previous_value, after: x.current_value, source: x.source_url }))}</summary></entry>`).join('')}</feed>`, 'application/atom+xml');
  }
  if (path === '/') {
    const [stats, lists, changes] = await Promise.all([all(env, 'stats'), all(env, 'list', { size: 2 }), all(env, 'changes')]);
    const picked = lists.flat().slice(0, 6);
    const entities = await Promise.all(picked.map(x => shard(env, x.id, 'entity', { id: x.id })));
    const examples = entities.filter(Boolean).map(x => x.facts.find((f: any) => /latest-version|service-status|latest-release/.test(f.fact)) || x.facts[0]).filter(Boolean);
    return pageResponse(request, 'home', { title: 'XGuard Live', stats: sumStats(stats), examples, changes: changes.flat().sort((a, b) => b.observed_at.localeCompare(a.observed_at)).slice(0, 8) }, path);
  }
  if (ARTICLES[path]) return pageResponse(request, 'prose', ARTICLES[path], path);
  if (path === '/corrections') return pageResponse(request, 'corrections', { fact: url.searchParams.get('fact') || '' }, path, url.searchParams.has('fact'));
  if (path === '/topics' || path.startsWith('/topics/')) {
    const topic = path.slice('/topics/'.length), parts = topic.split('/page/');
    if (path !== '/topics' && !TOPICS[parts[0]]) return errorPage(404, 'Topic not found', 'This topic is not in the verified index.');
    const page = parts[1] ? integer(parts[1], 0, 1, 100000) : 1; if (!page) return errorPage(404, 'Page not found', 'Invalid page number.');
    const counts = await all(env, 'topic-counts');
    const pages: { shard: number; page: number }[] = [];
    counts.forEach((rows, i) => { const count = rows.find((x: any) => x.topic === parts[0])?.count || 0;
      for (let p = 1; p <= Math.ceil(count / 50); p++) pages.push({ shard: i, page: p }); });
    if (path !== '/topics' && page > Math.max(1, pages.length)) return errorPage(404, 'Page not found', 'This index page has no published records.');
    const placement = pages[page - 1];
    const items = path === '/topics' ? (await all(env, 'list', { size: 4 })).flat() : placement ? await rpc(env.LIVE_SHARDS, shardName(placement.shard), 'list', { topic: parts[0], page: placement.page, size: 50 }) : [];
    return pageResponse(request, 'index', { title: path === '/topics' ? 'Explore current facts.' : TOPICS[parts[0]], description: 'Only primary-source observations are published.', items, next: path !== '/topics' && page < pages.length ? `/topics/${parts[0]}/page/${page + 1}` : null }, path, !items.length);
  }
  if (path === '/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const items = q.length >= 2 ? (await all(env, 'search', { q })).flat().slice(0, 100) : [];
    return pageResponse(request, 'index', { title: `Search: ${q}`, items }, path, true);
  }
  if (path === '/changes') {
    const changes = (await all(env, 'changes')).flat().sort((a, b) => b.observed_at.localeCompare(a.observed_at)).slice(0, 100);
    return pageResponse(request, 'changes', { title: 'What changed', changes }, path, !changes.length);
  }
  const type = path.split('/')[1];
  if (['live', 'fact', 'history', 'changes', 'evidence'].includes(type)) {
    const parts = path.split('/').slice(2); let id = entityId(parts), key: string | undefined;
    if (!id) { key = parts.pop(); id = entityId(parts); }
    if (!id) return errorPage(404, 'Record not found', 'No canonical entity matches this URL.');
    if (type === 'live') { const entity = await shard(env, id, 'entity', { id }); if (entity && !key) return pageResponse(request, 'entity', { ...entity, changes: (await shard(env, id, 'changes', { entity: id })).slice(0, 8) }, path); }
    if (type === 'fact' && key) { const fact = await shard(env, id, 'fact', { id: `${id}/${key}` }); if (fact) return pageResponse(request, 'fact', { fact, history: (await shard(env, id, 'history', { id: fact.id, page: 1 })).slice(0, 10) }, path, fact.verification === 'REMOVED'); }
    if (type === 'history') {
      if (key) { const fact = await shard(env, id, 'fact', { id: `${id}/${key}` }); if (fact) return pageResponse(request, 'history', { title: `${fact.label} history`, history: await shard(env, id, 'history', { id: fact.id, page: integer(url.searchParams.get('page'), 1, 1, 1000000) }), page: integer(url.searchParams.get('page'), 1, 1, 1000000) }, path); }
      else { const entity = await shard(env, id, 'entity', { id }); if (entity) return pageResponse(request, 'history', { title: `${entity.title} history`, facts: entity.facts, history: [] }, path); }
    }
    if (type === 'changes') { const changes = await shard(env, id, 'changes', { entity: id, id: key, page: integer(url.searchParams.get('page'), 1, 1, 1000000) }); if (changes.length) return pageResponse(request, 'changes', { title: key ? 'Observed change' : `${id} changes`, changes, page: integer(url.searchParams.get('page'), 1, 1, 1000000) }, path); }
    if (type === 'evidence' && key) { const evidence = await shard(env, id, 'evidence', { entity: id, observation: key }); if (evidence) return pageResponse(request, 'evidence', evidence, path, true); }
    return errorPage(404, 'Fact not found', 'This record has not passed publication checks or is unavailable. Browse the verified index for current records.');
  }
  if (/^\/(marketplace|sellers|pricing|try|connect|developers|mcp|a2a|v1|edge|facilitator|architecture|docs|server\.json|skill\.md)(\/|$)/.test(path) || path.startsWith('/.well-known/')) return errorPage(410, 'This service has been retired', 'XGuard now publishes current, source-verified facts. Browse the fact index at /topics. Historical operational records are retained.');
  return errorPage(404, 'Page not found', 'Browse the fact index to find a published record.');
}
const xml = (body: string, type = 'application/xml') => new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=300' } });

export function classify(request: Request): any {
  const ua = request.headers.get('user-agent') || '', cf = (request as any).cf || {};
  const known: [RegExp, string][] = [[/OAI-SearchBot|ChatGPT-User|GPTBot/i, 'OpenAI'], [/Claude-SearchBot|Claude-User|ClaudeBot/i, 'Anthropic'], [/PerplexityBot|Perplexity-User/i, 'Perplexity'], [/cohere-ai/i, 'Cohere'], [/Google-CloudVertexBot/i, 'Google']];
  const operator = known.find(([re]) => re.test(ua))?.[1] || '';
  const verified = cf.botManagement?.verifiedBot === true;
  return { operator, classification: operator ? verified ? 'verified-ai' : 'claimed-ai' : verified ? 'verified-bot' : /bot|crawler|spider|curl|wget/i.test(ua) ? 'unverified-bot' : 'unclassified', synthetic: /^XGuard(?:Live|[-/])/i.test(ua), user_agent: ua.slice(0, 240) };
}
async function telemetry(request: Request, response: Response, env: Env, duration: number, cache: string): Promise<void> {
  const url = new URL(request.url); if (/^\/(admin|healthz|assets)/.test(url.pathname)) return;
  const cls = classify(request); let referrer = '';
  try { referrer = new URL(request.headers.get('referer') || '').hostname; } catch { /* No attribution without evidence. */ }
  const platforms: Record<string, string> = { 'chatgpt.com': 'ChatGPT', 'perplexity.ai': 'Perplexity', 'claude.ai': 'Claude' };
  const timestamp = iso(), cf = (request as any).cf || {};
  const key = env.LIVE_SESSION_KEY || env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
  const visitor_hash = cls.classification === 'verified-ai' && key ? await hash(`${key}|${timestamp.slice(0, 10)}|${request.headers.get('cf-connecting-ip') || ''}|${cls.operator}`) : '';
  const event = { id: crypto.randomUUID(), timestamp, path: url.pathname.slice(0, 500), status: response.status, content_type: response.headers.get('content-type') || '', cache, ...cls, referrer,
    referral_platform: platforms[referrer], country: /^[A-Z]{2}$/.test(cf.country || '') ? cf.country : '', bytes: Number(response.headers.get('content-length') || 0), latency_ms: Math.round(duration * 100) / 100, visitor_hash };
  const parts = url.pathname.split('/').slice(2);
  const target = ['live', 'fact', 'history', 'changes', 'evidence'].includes(url.pathname.split('/')[1])
    ? entityId(parts) || entityId(parts.slice(0, -1)) : null;
  await rpc(env.LIVE_SHARDS, shardName(shardOf(target || url.pathname)), 'telemetry', { event });
}

export async function bootstrap(env: Env): Promise<void> {
  if (env.LIVE_BOOTSTRAP === 'off' || await control(env, 'get', { key: 'bootstrap' })) return;
  const groups: Row[][] = Array.from({ length: SHARDS }, () => []);
  for (const spec of SEED_SOURCES) groups[shardOf(spec.id)].push({ adapter: spec.adapter, identifier: spec.identifier });
  await Promise.all(groups.map((sources, i) => rpc(env.LIVE_SHARDS, shardName(i), 'seed', { sources, provenance: 'curated-developer-demand' })));
  await control(env, 'set', { key: 'bootstrap', value: { at: iso(), candidates: SEED_SOURCES.length } });
}
async function discover(env: Env): Promise<void> {
  const progress = await control(env, 'get', { key: 'discovery' }) || { query: 0, candidates: 0, last_run: null };
  if (progress.query >= DISCOVERY_QUERIES.length || progress.candidates >= 1500 || (progress.last_run && Date.now() - Date.parse(progress.last_run) < 540000)) return;
  const lease = await control(env, 'source-lease', { domain: 'registry.npmjs.org' }); if (!lease.token) return;
  try {
    const query = DISCOVERY_QUERIES[progress.query], url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=150`;
    await checkRobots(url, env); const response = await safeFetch(url);
    if (!response.ok) throw new Error(`discovery_http_${response.status}`);
    const body = JSON.parse(await boundedBody(response));
    if (!Array.isArray(body.objects)) throw new Error('discovery_schema_mismatch');
    const groups: any[][] = Array.from({ length: SHARDS }, () => []);
    for (const entry of body.objects) {
      if (!entry.package || typeof entry.score?.final !== 'number' || entry.score.final < .3) continue;
      try { const spec = sourceSpec('npm', entry.package.name); groups[shardOf(spec.id)].push({ adapter: 'npm', identifier: spec.identifier }); } catch { /* Candidate is invalid. */ }
    }
    const results = await Promise.all(groups.map((sources, i) => rpc(env.LIVE_SHARDS, shardName(i), 'seed', { sources, provenance: `official-npm-search:${query}` })));
    await control(env, 'set', { key: 'discovery', value: { query: progress.query + 1, candidates: progress.candidates + results.reduce((n, x) => n + x.queued, 0), last_run: iso(), last_error: null } });
  } catch (error) { await control(env, 'set', { key: 'discovery', value: { ...progress, last_run: iso(), last_error: String(error).slice(0, 160) } }); }
  finally { await control(env, 'source-release', { domain: 'registry.npmjs.org', token: lease.token }); }
}

export async function expandDemand(env: Env): Promise<void> {
  const prior = await control(env, 'get', { key: 'demand-growth' }) || { day: '', queued: 0, total: 0 };
  const day = iso().slice(0, 10), daily = prior.day === day ? prior.queued : 0;
  if (daily >= 100 || prior.total >= 5000) return;
  const candidates = (await all(env, 'growth-candidates')).flat().sort((a, b) => b.requests - a.requests);
  const seen = new Set<string>(); let queued = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    try {
      const parts = candidate.id.split('/'), spec = sourceSpec(parts.shift() as any, parts.join('/'));
      const result = await shard(env, spec.id, 'seed', { sources: [{ adapter: spec.adapter, identifier: spec.identifier }], provenance: `observed-demand:${candidate.parent}` });
      queued += result.queued;
    } catch { /* Only canonical identifiers with an existing official adapter qualify. */ }
    if (queued >= Math.min(20, 100 - daily, 5000 - prior.total)) break;
  }
  await control(env, 'set', { key: 'demand-growth', value: { day, queued: daily + queued, total: prior.total + queued, checked_at: iso(), candidates: candidates.length } });
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const started = performance.now(), url = new URL(request.url); let response: Response, cacheStatus = 'BYPASS';
    try {
      if (url.hostname === 'www.xguardgate.com' || url.hostname === 'api.xguardgate.com') return new Response(null, { status: 308, headers: { location: `${ORIGIN}${url.pathname}${url.search}`, ...securityHeaders() } });
      let decoded: string; try { decoded = decodeURIComponent(url.pathname); } catch { return json({ error: 'invalid_url' }, 400); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('%') || decoded.includes('//') || /[\u0000-\u0020]/.test(decoded)) return json({ error: 'invalid_path' }, 400);
      if (decoded !== '/' && decoded.endsWith('/')) return new Response(null, { status: 308, headers: { location: `${ORIGIN}${decoded.replace(/\/+$/, '')}${url.search}`, ...securityHeaders() } });
      if (decoded !== url.pathname) { url.pathname = decoded; request = new Request(url, request); }
      const cacheable = request.method === 'GET' && !url.search && !request.headers.has('authorization') && !request.headers.has('cookie') && !/^\/(admin|healthz|status|corrections|search|evidence)/.test(url.pathname);
      const format = negotiate(request.headers.get('accept'));
      const cacheKey = new Request(`${url.origin}${url.pathname}?__live_format=${format || 'none'}&__live_build=${env.CF_VERSION_METADATA?.id || VERSION}`);
      const edgeCache = (globalThis as any).caches?.default;
      const cached = cacheable && edgeCache ? await edgeCache.match(cacheKey) : null;
      if (cached) { response = cached; cacheStatus = 'HIT'; }
      else {
        response = await route(request, env);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const headers = new Headers(response.headers); headers.set('content-length', String(bytes.length));
        response = new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, headers });
        if (cacheable && response.status === 200 && !response.headers.get('cache-control')?.includes('no-store') && edgeCache) {
          cacheStatus = 'MISS'; ctx.waitUntil(edgeCache.put(cacheKey, response.clone()).catch((err: any) => console.warn(JSON.stringify({ event: 'cache_write_failed', code: String(err) }))));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'live_request_failed', path: url.pathname, message: String(error) }));
      response = json({ error: 'service_temporarily_unavailable', request_id: crypto.randomUUID() }, 503, { 'retry-after': '30' });
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders())) if (!headers.has(key)) headers.set(key, value);
    headers.set('x-xguard-product', 'XGuard Live'); headers.set('x-xguard-version', VERSION); headers.set('x-xguard-cache', cacheStatus);
    if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
    // Pricing is a response hint for Cloudflare's verified, opted-in in-band layer.
    // It is never evidence of a payment and never creates a revenue event.
    if (request.headers.get('cf-pay-per-crawl')?.includes('pricing=in-band')) {
      try {
        if (!monetizationCache || Date.now() - monetizationCache.at > 60000) monetizationCache = { at: Date.now(), value: await control(env, 'get', { key: 'monetization' }) };
        headers.set('crawler-price', crawlPrice(url.pathname, monetizationCache.value));
      } catch (error) {
        headers.set('crawler-price', 'USD 0');
        console.error(JSON.stringify({ event: 'monetization_config_unavailable', message: String(error) }));
      }
    }
    const etag = response.status === 200 && !response.headers.get('cache-control')?.includes('no-store') ? `"${await hash(await response.clone().text())}"` : null;
    if (etag) headers.set('etag', etag);
    const notModified = etag && request.headers.get('if-none-match')?.split(',').map(x => x.trim()).includes(etag) && READ.has(request.method);
    if (notModified) headers.delete('content-length');
    response = new Response(request.method === 'HEAD' || notModified ? null : response.body, { status: notModified ? 304 : response.status, headers });
    ctx.waitUntil(telemetry(request, response.clone(), env, performance.now() - started, cacheStatus).catch(error => console.error(JSON.stringify({ event: 'telemetry_failed', message: String(error) }))));
    return response;
  },
  async scheduled(_controller: unknown, env: Env, _ctx: Context): Promise<void> {
    await bootstrap(env);
    await all(env, 'tick');
    if (env.LIVE_SOURCE_FETCHES !== 'off') { await discover(env); await expandDemand(env); }
    await control(env, 'set', { key: 'last-cron', value: iso() });
    console.log(JSON.stringify({ event: 'live_cron_complete', at: iso() }));
  },
};
