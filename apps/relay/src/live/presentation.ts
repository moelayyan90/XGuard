import { DESIGN_PATH } from './design.ts';
import { ORIGIN, TOPICS } from './types.ts';
import { escape as e, valueText } from './util.ts';

export const CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182920;background:#f6f7f3;font-synthesis:none;--muted:#607168;--line:#dce3db;--green:#24583f}*{box-sizing:border-box}body{margin:0}a{color:var(--green);text-underline-offset:4px}a:hover{color:#102b1d}header{border-bottom:1px solid var(--line);background:#fff}nav,.wrap,footer{max-width:1200px;margin:auto;padding:24px 32px}nav{display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{font-size:21px;letter-spacing:-.8px;font-weight:800;text-decoration:none;color:#182920;white-space:nowrap}.brand span{font-size:12px;vertical-align:middle;background:#dcf0cc;border-radius:4px;padding:5px 7px;letter-spacing:1px;margin-left:7px}nav .links{display:flex;gap:26px;flex-wrap:wrap}nav .links a{font-size:14px;text-decoration:none}.eyebrow{font:600 11px ui-monospace,SFMono-Regular,monospace;letter-spacing:1.8px;text-transform:uppercase;color:var(--green);margin:24px 0 14px}h1{font-weight:600;font-size:clamp(34px,5.6vw,68px);line-height:1.04;letter-spacing:-2.8px;max-width:850px;margin:0 0 24px}h2{font-size:24px;letter-spacing:-.6px;font-weight:600;margin:28px 0 14px}h3{font-size:17px;margin:0 0 12px}.lead{font-size:18px;line-height:1.7;max-width:740px;color:var(--muted)}.hero{padding:38px 0 28px}.hero h1{max-width:700px}.sub{color:var(--muted);font-size:13px;line-height:1.6}.search{display:flex;max-width:620px;gap:10px;margin:24px 0}input,textarea,select{font:inherit;border:1px solid #b9c7b9;background:#fff;color:#182920;border-radius:5px;padding:12px;width:100%}input:focus,textarea:focus,select:focus{outline:2px solid #67945a;outline-offset:2px}button,.button{background:var(--green);color:white;border:0;border-radius:5px;padding:12px 20px;font:600 14px inherit;cursor:pointer;text-decoration:none;white-space:nowrap}button:hover,.button:hover{background:#173c29;color:white}.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:#fff;border-radius:8px;margin:20px 0 42px}.stat{padding:22px 24px;border-right:1px solid var(--line)}.stat:last-child{border:0}.stat strong{display:block;font-size:30px;font-weight:550;letter-spacing:-1px;margin-bottom:6px}.stat span{font-size:12px;color:var(--muted)}.section-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:#fff;padding:24px;border:1px solid var(--line);border-radius:8px}.card a{text-decoration:none}.card .value{font:600 24px ui-monospace,monospace;margin:22px 0 12px;overflow-wrap:anywhere}.tag{font:600 10px ui-monospace,monospace;padding:5px 8px;border-radius:4px;letter-spacing:.8px;background:#e6f1dc;color:#315e2c;display:inline-block}.tag.stale{background:#fff0d4;color:#7c5420}.tag.unknown,.tag.removed{background:#eef0ed;color:#596359}.topics{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 38px}.topics a{background:#fff;border:1px solid var(--line);border-radius:5px;padding:10px 14px;text-decoration:none;font-size:13px}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:7px;background:white}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th,td{padding:17px 20px;border-bottom:1px solid var(--line);vertical-align:top}th{font:500 11px ui-monospace,monospace;text-transform:uppercase;color:var(--muted);letter-spacing:.6px;background:#f2f5ef}tbody tr:last-child td{border-bottom:0}td:first-child{min-width:150px}td code{overflow-wrap:anywhere}.breadcrumbs{font-size:12px;margin:28px 0 24px;color:var(--muted)}.detail{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr);gap:24px}.current{font:500 clamp(30px,5vw,60px) ui-monospace,monospace;letter-spacing:-2px;overflow-wrap:anywhere;margin:30px 0 20px}.unit{font:14px ui-monospace,monospace;color:var(--muted);letter-spacing:0}.meta{display:grid;gap:20px}.meta dt{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.6px}.meta dd{margin:6px 0 0;font-size:14px;overflow-wrap:anywhere;line-height:1.6}.formats{display:flex;gap:18px;margin:18px 0 32px;font:12px ui-monospace,monospace}.note{padding:18px 22px;border-left:3px solid #99b57b;background:#eaf0e5;line-height:1.7;font-size:14px}.empty{padding:38px 24px;background:#fff;border:1px dashed #bdc9b9;border-radius:6px;color:var(--muted)}.prose{max-width:800px;font-size:16px;line-height:1.8}.prose p{margin:18px 0}.prose code{font-size:13px}.prose li{margin:10px 0}.prose ul{padding-left:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eff3eb;border:1px solid var(--line);padding:20px;font:12px/1.7 ui-monospace,monospace;border-radius:6px}.forms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.forms form{background:white;border:1px solid var(--line);padding:24px;border-radius:7px}label{display:block;font-size:13px;margin:12px 0 6px}.pagination{display:flex;gap:18px;margin:24px 0}.muted{color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:70px;display:flex;justify-content:space-between;gap:25px;font-size:12px;color:var(--muted)}footer div{display:flex;gap:16px;flex-wrap:wrap}time{font-variant-numeric:tabular-nums}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:800px){nav,.wrap,footer{padding:20px}nav{align-items:flex-start;flex-direction:column;gap:18px}nav .links{gap:18px}.hero{padding:20px 0}h1{letter-spacing:-1.6px}.stats{grid-template-columns:repeat(2,1fr)}.stat{border-bottom:1px solid var(--line)}.stat:nth-child(2){border-right:0}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail,.forms{grid-template-columns:1fr}footer{flex-direction:column}.current{letter-spacing:-1px}}@media(max-width:520px){.grid{grid-template-columns:1fr}.stat{padding:17px}.stat strong{font-size:25px}.search{flex-direction:column}.section-head{align-items:flex-start}th,td{padding:13px}.formats{flex-wrap:wrap}}`;

const when = (value: any) => value ? `<time datetime="${e(value)}">${e(String(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</time>` : 'No successful observation yet';
const tag = (value: string) => `<span class="tag ${e(value.toLowerCase())}">${e(value)}</span>`;
const show = (value: any) => value === null || value === undefined ? 'UNKNOWN' : e(valueText(value));
const formats = (path: string) => `<div class="formats"><span>MACHINE FORMATS</span><a href="${e(path)}?format=markdown" rel="nofollow">Markdown ↗</a><a href="${e(path)}?format=json" rel="nofollow">JSON ↗</a></div>`;
const sourceLink = (url: string) => `<a href="${e(url)}" rel="noopener noreferrer">${e(new URL(url).hostname)} ↗</a>`;
const factRows = (facts: any[]) => `<div class="table-scroll" role="region" tabindex="0" aria-label="Fact records"><table><thead><tr><th>Fact</th><th>Current value</th><th>Verification</th><th>Primary source</th></tr></thead><tbody>${facts.map(f => `<tr><td><a href="${e(f.canonical_url)}">${e(f.label)}</a></td><td><code>${show(f.current_value)}</code>${f.unit ? `<div class="sub">${e(f.unit)}</div>` : ''}${f.verification !== 'VERIFIED' ? `<div class="sub">Last observed: ${show(f.last_observed_value)}</div>` : ''}</td><td>${tag(f.verification)}<div class="sub">${when(f.verified_at)}</div></td><td>${sourceLink(f.source_url)}</td></tr>`).join('')}</tbody></table></div>`;
const entityRows = (items: any[]) => items.length ? `<div class="table-scroll" role="region" tabindex="0" aria-label="Entity records"><table><thead><tr><th>Entity</th><th>Topic</th><th>Facts</th><th>Last observation</th></tr></thead><tbody>${items.map(x => `<tr><td><a href="/live/${e(x.id)}">${e(x.title)}</a></td><td><a href="/topics/${e(x.topic)}">${e(TOPICS[x.topic])}</a></td><td>${e(x.facts)}</td><td>${when(x.updated_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No verified entities are published here yet. Candidates appear only after a successful primary-source check.</p>';
const changeRows = (items: any[]) => items.length ? `<div class="table-scroll" role="region" tabindex="0" aria-label="Observed changes"><table><thead><tr><th>Observed change</th><th>Before</th><th>After</th><th>Observed at</th></tr></thead><tbody>${items.map(x => `<tr><td><a href="/changes/${e(x.entity_id)}/${e(x.id)}">${e(x.label)}</a><div class="sub">${e(x.change_type)} · ${e(x.entity_id)}</div></td><td><code>${show(x.previous_value)}</code></td><td><code>${show(x.current_value)}</code></td><td>${when(x.observed_at)}<div class="sub">${sourceLink(x.source_url)}</div></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No observed changes yet.</p>';
const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>`;
const searchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></svg>`;
const brand = `<a class="brand" href="/" aria-label="XGuard Live home"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" stroke="currentColor" stroke-opacity=".58"/><path d="m9 10 14 12M23 10 9 22" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="16" r="2.5" fill="currentColor"/></svg>XGuard<span class="brand-live">LIVE</span></a>`;
const navLinks = [['/topics', 'Explore facts'], ['/changes', 'Change log'], ['/methodology', 'Methodology'], ['/pricing', 'Pricing']];
const currentPage = (path: string, href: string) => path === href ? ' aria-current="page"' : '';
const sectionLink = (href: string, label: string) => `<a class="text-link" href="${href}">${label}${arrow}</a>`;

function searchForm(query = ''): string {
  return `<form class="search" action="/search" role="search">
    <label class="sr-only" for="query">Search the fact index</label>
    <input id="query" name="q" type="search" placeholder="Search packages, runtimes, services…" value="${e(query)}" maxlength="100" required>
    <button type="submit">${searchIcon}Search facts</button>
  </form>`;
}

function layout(title: string, path: string, content: string, description: string, schema: any, noindex: boolean, home: boolean): { body: string; nonce: string } {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const footerGroups = [
    ['Explore', [['/topics', 'Fact index'], ['/changes', 'Change log'], ['/sources', 'Primary sources'], ['/status', 'System status']]],
    ['Resources', [['/install', 'Connect AI tools'], ['/methodology', 'Methodology'], ['/accuracy', 'Accuracy'], ['/llms.txt', 'For agents']]],
    ['Support', [['/pricing', 'Pricing'], ['/corrections', 'Corrections'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/refund-policy', 'Refunds']]],
  ] as const;
  return { nonce, body: `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${e(title)} | XGuard Live</title><meta name="description" content="${e(description)}">
    <meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow'}">
    <link rel="canonical" href="${ORIGIN}${e(path)}"><link rel="stylesheet" href="${DESIGN_PATH}">
    <link rel="alternate" type="application/atom+xml" title="XGuard Live changes" href="/changes.atom">
    <meta name="color-scheme" content="light"><meta name="theme-color" content="#102821">
    ${schema ? `<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}
  </head><body>
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="site-header"><nav class="site-nav" aria-label="Main navigation">
      ${brand}
      <div class="links">${navLinks.map(([href, label]) => `<a href="${href}"${currentPage(path, href)}>${label}</a>`).join('')}</div>
      <a class="nav-cta text-link" href="/install"${currentPage(path, '/install')}>Connect AI tools ${arrow}</a>
    </nav></header>
    <main id="main-content" class="wrap${home ? ' home-wrap' : ''}">${content}</main>
    <footer class="site-footer"><div class="site-footer-inner">
      <section>${brand}<p>The live facts layer for AI, grounded in primary sources.</p></section>
      ${footerGroups.map(([heading, links]) => `<section><h2>${heading}</h2>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</section>`).join('')}
    </div></footer>
  </body></html>` };
}

function observationFigure(fact: any): string {
  const contours = Array.from({ length: 13 }, (_, index) =>
    `<use href="#contour" transform="translate(0 ${index * 9})" opacity="${(0.25 + index * 0.054).toFixed(2)}"/>`).join('');
  return `<figure class="hero-figure">
    <figcaption class="figure-caption"><span>01 / Source record</span><span>Primary-source data</span></figcaption>
    <svg class="figure-art" viewBox="0 0 500 260" fill="none" aria-hidden="true">
      <defs><path id="contour" d="M56 105c38-13 62-16 99-45 26-20 55-35 97-31 56 5 83 44 128 58 28 9 44 16 55 25 8 7-8 18-36 20-54 4-80-17-119-16-58 1-80 32-132 32-33 0-62-10-90-24-13-6-16-14-2-19Z"/></defs>
      <g stroke="currentColor" stroke-width="1">${contours}</g>
      <path d="M252 32v164m-7-145h14m-7 0h155" stroke="#dae8c0" stroke-width="1" stroke-dasharray="4 5" opacity=".63"/>
      <circle cx="252" cy="51" r="12" stroke="#e0f3ad" opacity=".55"/><circle cx="252" cy="51" r="4" fill="#e0f3ad"/>
      <path d="M398 47h10v9m-330 131H67v-10m0-111V56h11m335 131h10v-10" stroke="#afc2ab" opacity=".66"/>
    </svg>
    ${fact ? `<a class="hero-sample" href="${e(fact.canonical_url)}">
      <span class="sample-label">${e(fact.entity_name)} · ${e(fact.label)}</span>${tag(fact.verification)}
      <strong class="sample-value">${show(fact.current_value)}</strong>
      <span class="sample-meta">${e(new URL(fact.source_url).hostname)} · ${when(fact.verified_at)}</span>
    </a>` : `<div class="hero-sample hero-sample-empty"><span class="sample-label">Fact preview</span><span class="sample-meta">Published observations appear here when available.</span></div>`}
  </figure>`;
}

function homeView(data: any): string {
  const featured = data.examples.find((fact: any) => fact.verification === 'VERIFIED') || data.examples[0];
  const stats = [[data.stats.facts, 'Published facts'], [data.stats.changes_today, 'Changes observed today'],
    [data.stats.sources, 'Sources monitored'], [data.stats.verified, 'Fresh verified facts']];
  return `<section class="home-hero" aria-labelledby="home-title">
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <p class="eyebrow">The live facts layer for AI</p>
        <h1 id="home-title">Current facts.<br><em>Clear evidence.</em></h1>
        <p class="lead">Look up software versions, service status and API pricing. See the official source, when it was checked and what changed.</p>
        ${searchForm()}
        <div class="hero-examples"><span>Try a search</span><a href="/search?q=react">React</a><a href="/search?q=python">Python</a><a href="/search?q=node">Node.js</a></div>
      </div>
      ${observationFigure(featured)}
    </div>
  </section>
  <section class="home-stats" aria-label="Fact index totals"><div class="wrap stats">
    ${stats.map(([n, label]) => `<div class="stat"><strong>${Number(n).toLocaleString('en-US')}</strong><span>${e(label)}</span></div>`).join('')}
  </div></section>
  <div class="wrap home-content">
    <section class="home-section" aria-labelledby="featured-heading">
      <div class="section-head"><div><p class="eyebrow">01 / Fact index</p><h2 id="featured-heading">Explore published facts</h2></div>${sectionLink('/topics', 'Browse the index')}</div>
      ${data.examples.length ? `<div class="grid">${data.examples.map((f: any) => `<article class="card fact-preview">
        <p class="eyebrow">${e(f.entity_name)}</p><h3><a href="${e(f.canonical_url)}">${e(f.label)}</a></h3>
        <div class="value">${show(f.current_value)}</div>${tag(f.verification)}
        <p class="sub">${when(f.verified_at)}<br>${sourceLink(f.source_url)}</p>
      </article>`).join('')}</div>` : '<p class="empty">No verified facts are published yet.</p>'}
      ${topicLinks()}
    </section>
    <section class="home-section" aria-labelledby="change-heading">
      <div class="section-head"><div><p class="eyebrow">02 / Observation history</p><h2 id="change-heading">What changed recently</h2></div>${sectionLink('/changes', 'Full change log')}</div>
      ${changeRows(data.changes)}
      <p class="sub">Last successful global observation: ${when(data.stats.last_update)}. All times UTC.</p>
    </section>
    <section class="home-section connect-panel" aria-labelledby="connect-heading">
      <div><p class="eyebrow">03 / Access</p><h2 id="connect-heading">Use facts in your workflow</h2>
      <p>Connect your AI client to read public facts, or get a paid verification receipt for a published fact.</p></div>
      <div class="actions"><a class="button" href="/install">Connect AI tools ${arrow}</a>${sectionLink('/api/gateway/v1/checkout', 'Get a fact receipt')}</div>
    </section>
  </div>`;
}
export function render(kind: string, data: any, path: string, noindex = false): { body: string; nonce: string } {
  let title = data.title || 'Current facts', description = 'Current facts, primary-source evidence and immutable change history.', content = '', schema: any = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url: ORIGIN + path };
  if (kind === 'home') {
    title = 'The live facts layer for AI';
    content = homeView(data);
    schema = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'XGuard Live', url: ORIGIN, description };
  } else if (kind === 'entity') {
    title = data.title;
    content = `<div class="breadcrumbs"><a href="/topics">Facts</a> / <a href="/topics/${e(data.topic)}">${e(TOPICS[data.topic])}</a></div><p class="eyebrow">Live entity record</p><h1>${e(title)}</h1><p class="lead">Current values and their latest primary-source verification.</p>${formats(path)}${factRows(data.facts)}<h2>Recent changes</h2>${changeRows(data.changes || [])}<p><a href="/history/${e(data.id)}">Browse observation history →</a></p>${data.related?.length ? `<h2>Declared dependencies</h2><p class="sub">Dependencies are linked through the source registry; verification of this entity does not verify a dependency.</p><div class="topics">${data.related.map((id: string) => `<a href="/search?q=${encodeURIComponent(id.split('/').slice(1).join('/'))}" rel="nofollow">${e(id)}</a>`).join('')}</div>` : ''}`;
  } else if (kind === 'fact') {
    const f = data.fact; title = `${f.entity_name} — ${f.label}`;
    description = `${f.label}: ${f.verification === 'VERIFIED' ? valueText(f.current_value) : f.verification}. Primary source: ${new URL(f.source_url).hostname}. Checked ${f.verified_at}.`;
    content = `<div class="breadcrumbs"><a href="/live/${e(f.entity)}">${e(f.entity_name)}</a> / ${e(f.label)}</div><p class="eyebrow">One fact. Its evidence. Its history.</p><h1>${e(f.label)}</h1>${f.verification === 'VERIFIED' ? `<p><a href="/api/gateway/v1/checkout?fact=${encodeURIComponent(path)}">Get a paid verification receipt ↗</a></p>` : ''}<div class="detail"><section class="card"><p class="eyebrow">Current value</p>${tag(f.verification)}<div class="current">${show(f.current_value)}${f.unit ? `<div class="unit">${e(f.unit)}</div>` : ''}</div>${f.verification !== 'VERIFIED' ? `<p class="note">Current value is unconfirmed. Last observed value: <strong>${show(f.last_observed_value)}</strong>, at ${when(f.observed_at)}.</p>` : ''}<p class="sub">Source checked ${when(f.verified_at)}</p>${formats(path)}</section><aside class="card"><dl class="meta"><div><dt>Primary source</dt><dd>${sourceLink(f.source_url)}</dd></div><div><dt>Previous value</dt><dd>${show(f.previous_value)}</dd></div><div><dt>Last change observed</dt><dd>${when(f.changed_at)}</dd></div><div><dt>Freshness limit</dt><dd>${e(f.max_age_seconds)} seconds after verification</dd></div></dl></aside></div><h2>Observation history</h2>${historyTable(data.history || [])}<p><a href="${e(f.history_url)}">Full history →</a></p><h2>Source evidence</h2><dl class="meta card"><div><dt>Evidence manifest</dt><dd><a href="${e(f.evidence_url)}">Open verification record ↗</a></dd></div><div><dt>Source response SHA-256</dt><dd><code>${e(f.source_hash)}</code></dd></div><div><dt>Verification scope</dt><dd>${e(f.confidence_scope)}</dd></div></dl><p class="sub">A change timestamp is when XGuard observed a difference, unless a publisher explicitly supplies a release date. <a href="/corrections?fact=${encodeURIComponent(f.id)}">Report a correction</a>.</p>`;
    schema = { '@context': 'https://schema.org', '@type': 'Dataset', name: title, description, url: f.canonical_url, dateModified: f.verified_at, datePublished: f.first_observed_at || f.observed_at, isBasedOn: f.source_url, citation: f.source_url, temporalCoverage: `${f.observed_at}/..`, measurementTechnique: 'Deterministic extraction from primary-source metadata', creator: { '@type': 'Organization', name: 'XGuard Live', url: ORIGIN }, variableMeasured: { '@type': 'PropertyValue', name: f.label, ...(f.verification === 'VERIFIED' ? { value: valueText(f.current_value), unitText: f.unit || undefined } : {}) } };
  } else if (kind === 'history') {
    title = data.title; content = `<p class="eyebrow">Immutable source observations</p><h1>${e(title)}</h1><p class="lead">Observations are retained even when a value is corrected, removed or becomes stale.</p>${formats(path)}${data.facts ? factRows(data.facts) : historyTable(data.history)}${pagination(path, data.page || 1, data.history?.length === 100)}<p class="sub">Conditional HTTP 304 checks update the verification time without inventing a new value or a change event.</p>`;
  } else if (kind === 'changes') {
    title = data.title || 'What changed'; content = `<p class="eyebrow">Evidence-backed differences</p><h1>${e(title)}</h1><p class="lead">Before, after, and the moment a difference was observed.</p>${formats(path)}${changeRows(data.changes)}${pagination(path, data.page || 1, data.changes.length === 100)}`;
  } else if (kind === 'index') {
    const search = path === '/search';
    const query = search ? data.title.slice('Search: '.length) : '';
    title = search ? 'Search the fact index' : data.title;
    content = `<p class="eyebrow">The fact index</p><h1>${e(title)}</h1>
      ${data.description ? `<p class="lead">${e(data.description)}</p>` : ''}
      ${searchForm(query)}${topicLinks(path)}${search ? `<h2>${query ? `Results for “${e(query)}”` : 'Find an entity'} </h2>` : formats(path)}
      ${search && !data.items.length ? `<p class="empty">${query.length < 2 ? 'Enter at least two characters to search.' : 'No matches. Try a different package, runtime or service name.'}</p>` : entityRows(data.items)}
      ${data.next ? `<p><a href="${e(data.next)}">Next page →</a></p>` : ''}`;
  } else if (kind === 'evidence') {
    title = 'Source evidence'; content = `<p class="eyebrow">Verification manifest</p><h1>${e(title)}</h1><p class="lead">A compact record of the source, observation and extracted fact.</p>${formats(path)}<pre>${e(JSON.stringify(data, null, 2))}</pre>`;
  } else if (kind === 'login') {
    title = 'Owner access'; noindex = true; content = `<p class="eyebrow">Owner operations</p><h1>Sign in</h1><form class="card prose" method="post" action="/admin/login"><label for="key">Owner access key</label><input id="key" name="key" type="password" autocomplete="current-password" required><p class="sub">Use the configured operator or Live admin key. It is never stored in your browser.</p><button>Sign in securely</button></form>`;
  } else if (kind === 'admin') {
    title = 'Owner operations'; noindex = true; content = adminView(data);
  } else if (kind === 'corrections') {
    title = 'Corrections'; noindex = Boolean(data.fact); content = `<p class="eyebrow">Accuracy is a process</p><h1>Report a correction</h1><p class="lead">Submit a fact and a supporting primary source. Every report enters review; it cannot directly change a verified record.</p><form class="card prose" method="post" action="/corrections"><label for="fact">Fact identifier</label><input id="fact" name="fact_id" value="${e(data.fact || '')}" placeholder="npm/react/latest-version" maxlength="350" required><label for="source">Primary-source URL</label><input id="source" name="source_url" type="url" maxlength="1000" required><label for="message">What needs checking?</label><textarea id="message" name="message" rows="5" maxlength="2000" required></textarea><p class="sub">Do not include private or personal information.</p><button>Submit for review</button></form>`;
  } else {
    title = data.title; description = data.description || description;
    content = `<p class="eyebrow">XGuard Live</p><h1>${e(title)}</h1><div class="prose">${data.html || `<p>${e(data.message || '')}</p>`}</div>`;
  }
  if (data.catalog_as_of) content += `<p class="sub${kind === 'home' ? ' wrap home-meta' : ''}">Index and totals as of ${when(data.catalog_as_of)}; refreshed at most every 15 minutes. Open a fact for its latest verification.</p>`;
  return layout(title, path, content, description, schema, noindex, kind === 'home');
}
function topicLinks(path = ''): string {
  return `<div class="topics">${Object.entries(TOPICS).map(([key, label]) => {
    const href = `/topics/${e(key)}`;
    return `<a href="${href}"${currentPage(path, href)}>${e(label)} ${arrow}</a>`;
  }).join('')}</div>`;
}
function historyTable(rows: any[]): string {
  return `<div class="table-scroll" role="region" tabindex="0" aria-label="Observation history"><table><thead><tr><th>Observed at</th><th>Value</th><th>Evidence</th></tr></thead><tbody>${rows.map(x => `<tr><td>${when(x.observed_at)}</td><td><code>${show(x.value)}</code></td><td>${sourceLink(x.source_url)}<div class="sub"><code>${e(x.source_hash.slice(0, 16))}…</code></div></td></tr>`).join('')}</tbody></table></div>`;
}
function pagination(path: string, page: number, next: boolean): string { return `<div class="pagination">${page > 1 ? `<a href="${e(path)}?page=${page - 1}" rel="prev">← Previous</a>` : ''}${next ? `<a href="${e(path)}?page=${page + 1}" rel="next">Next →</a>` : ''}</div>`; }
function adminView(data: any): string {
  const csrf = `<input type="hidden" name="csrf" value="${e(data.csrf)}">`, config = data.state.config;
  const form = (title: string, action: string, fields: string) => `<form method="post" action="/admin/${action}"><h3>${e(title)}</h3>${csrf}${fields}<p><button>Save</button></p></form>`;
  const input = (name: string, label: string, type = 'text', value = '') => `<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}" required></label>`;
  const today = new Date().toISOString().slice(0, 10), revenue = data.state.revenue.filter((x: any) => x.day === today).reduce((n: number, x: any) => n + x.amount_micros, 0) / 1000000;
  const requests = data.metrics.flatMap((x: any) => x.requests), verified = requests.filter((x: any) => x.day === today && x.classification === 'verified-ai').reduce((n: number, x: any) => n + x.requests, 0);
  return `<p class="eyebrow">Private owner operations</p><h1>Live operations.</h1><p class="sub">Provider fees, eligibility, verified crawlers and observed revenue remain separate.</p><div class="stats">${[[data.stats.facts, 'Published facts'], [verified, 'Verified AI requests today'], [data.state.report_count ? '$' + revenue.toFixed(6) : 'UNKNOWN', 'Provider-reported revenue today'], [data.stats.stale, 'Stale facts']].map(([n, t]) => `<div class="stat"><strong>${e(n)}</strong><span>${e(t)}</span></div>`).join('')}</div><div class="note"><strong>Monetization: ${e(config.mode)}</strong><br>Pay Per Crawl: ${e(config.pay_per_crawl)} · Pay Per Use: ${e(config.pay_per_use)}<br>${data.state.report_count ? 'Revenue comes from imported provider reports.' : 'No provider reports are connected. Zero recorded events does not prove zero account revenue.'}<br>Cloudflare dashboard confirmation is required before charging.</div><h2>Collection and health</h2><pre>${e(JSON.stringify(data.stats, null, 2))}</pre><h2>Provider setup</h2><p><a href="https://dash.cloudflare.com/">Cloudflare Dashboard ↗</a> → xguardgate.com → AI Crawl Control. Confirm access, exempt discovery URLs, and configure the buyer programs you accept. Account eligibility is not inferred from traffic.</p><div class="forms">${form('Refresh a source', 'refresh', input('id', 'Entity identifier'))}${form('Source control', 'source-enabled', input('id', 'Entity identifier') + '<label>State<select name="enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>')}${form('Publication control', 'suppress', input('id', 'Entity identifier') + '<label>State<select name="suppressed"><option value="true">Suppress</option><option value="false">Publish verified records</option></select></label>')}${form('Review a correction', 'correction-review', input('id', 'Correction ID') + '<label>Decision<select name="status"><option value="accepted-for-verification">Accept for source verification</option><option value="rejected">Reject</option></select></label>' + input('resolution', 'Review reason'))}${form('Monetization configuration', 'monetization-config', `<label>Configuration JSON<textarea name="payload" rows="10" required>${e(JSON.stringify(config, null, 2))}</textarea></label><p class="sub">Charging requires provider evidence, verified dynamic pricing and discovery exemptions.</p>`)}${form('Import a Cloudflare report', 'report-import', '<label>Provider export JSON<textarea name="payload" rows="10" required></textarea></label><p class="sub">Requires report_hash, report_reference and events. Event IDs are deduplicated; conflicting records are rejected.</p>')}${form('Record an actual invoice', 'cost', input('month', 'Billing month (YYYY-MM)') + input('amount_micros', 'Actual USD amount × 1,000,000', 'number') + input('reference', 'Invoice reference'))}</div><h2>Business metrics</h2><pre>${e(JSON.stringify(data.business, null, 2))}</pre><h2>Additional paid data services</h2><p class="sub">Public Live pages remain free. Attempts, signed delivery, settled USDC, provider payouts and invoiced costs are separate. Missing financial records mean UNKNOWN.</p><p><a href="/api/paid/v1/catalog">Services and exact prices</a> · <a href="/admin/paid-revenue">Private revenue JSON</a></p><pre>${e(JSON.stringify(data.paid_services || { status: 'UNKNOWN' }, null, 2))}</pre>${form('Reset paid-service circuit', 'paid-circuit-reset', '<p class="sub">Resume after reviewing paid-service failures. Free facts are independent.</p>')}<h2>Reported revenue and costs</h2><pre>${e(JSON.stringify({ revenue: data.state.revenue, costs: data.state.costs, top_earning_pages: data.state.top_earning_pages }, null, 2))}</pre><h2>Revenue milestones</h2><p>${[1, 10, 25, 50, 100].map(goal => `$${goal}/day: ${data.state.report_count ? revenue >= goal ? 'reached today' : 'not reached today' : 'unverified'}`).join(' · ')}</p><h2>Traffic and referrals</h2><p class="sub">User-agent matches alone are unverified claims. Missing referrers are unattributed. Browser referrals are not proof of a human visitor.</p><pre>${e(JSON.stringify(data.metrics, null, 2))}</pre><h2>Correction queue</h2><pre>${e(JSON.stringify(data.state.corrections, null, 2))}</pre><h2>Source health</h2><pre>${e(JSON.stringify(data.sources, null, 2))}</pre><h2>Audit log</h2><pre>${e(JSON.stringify(data.state.audit, null, 2))}</pre><form method="post" action="/admin/logout">${csrf}<button>Sign out</button></form>`;
}
export function markdown(kind: string, data: any): string {
  if (kind === 'fact') {
    const f = data.fact;
    return `# ${f.entity_name} — ${f.label}\n\nCurrent: ${f.current_value === null ? f.verification : valueText(f.current_value)}\nUnit: ${f.unit || 'none'}\nVerification: ${f.verification}\nObserved: ${f.observed_at}\nSource checked: ${f.verified_at}\nSource: ${f.source_url}\nPrevious: ${f.previous_value === null ? 'unknown' : valueText(f.previous_value)}\nChange observed: ${f.changed_at}\nLast observed value: ${valueText(f.last_observed_value)}\nEvidence SHA-256: ${f.source_hash}\nEvidence: ${f.evidence_url}\nHistory: ${f.history_url}\nCanonical: ${f.canonical_url}\n\n${f.confidence_scope}\n\n## History\n\n${data.history.map((x: any) => `- ${x.observed_at}: ${valueText(x.value)} — ${x.source_url}`).join('\n')}\n`;
  }
  return `# ${data.title || 'XGuard Live'}\n\n${kind === 'home' ? 'The live facts layer for AI.\n\n' : ''}\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}
