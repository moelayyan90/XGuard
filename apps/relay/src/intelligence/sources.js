import semver from 'semver';
import { parseModelCard } from './model-card.js';
import { parseHTML } from 'linkedom';
import { boundedBody } from '../live/security.ts';
const cache = new Map(), inFlight = new Map();
const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const cfDocs = 'https://developers.cloudflare.com/workers/observability/errors/';
const actions = {
  '1101': 'Find the exception and stack in Worker logs. Check that every request produces a Response.',
  '1102': 'Inspect CPU profiles and bound work per request.',
  '1019': 'Inspect the Worker subrequest chain for a routing loop.',
  '1021': 'Check the requested destination and its permitted access.',
  '1022': 'Check that the deployed Worker and its route match.',
  '1024': 'Use the supported hostname or service binding for the upstream.',
  '1027': 'Check the request count and reset window for the current plan.',
  '1042': 'Check the target Worker route and same-zone Worker fetch configuration.',
};
export const validNpm = (name, version) => npmName.test(name) && typeof version === 'string' && semver.valid(version) === version;
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);
  if (inFlight.size >= 32) throw new Error('source_capacity_exceeded');
  const fetchData = (async () => {
    const value = await load();
    if (cache.size >= 96) cache.delete(cache.keys().next().value);
    cache.set(key,{ value, expires: Date.now()+300000 });
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key,fetchData);
  return fetchData;
}
async function read(url, fetcher, init, limit) {
  const r = await fetcher(url,{ ...init, redirect: 'manual', signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('official_source_unavailable');
  const body = await boundedBody(r,limit);
  return { body, verified_at: new Date().toISOString(), source: url };
}
function githubRepository(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(?:git\+)?https:\/\/github\.com\/([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]{1,100})\/?$/i);
  if (!match || match[2].includes('..')) return null;
  const name = match[2].replace(/\.git$/i, '');
  return name ? match[1] + '/' + name : null;
}
async function archiveStatus(repository,fetcher) {
  if (!repository) return null;
  const url = 'https://api.github.com/repos/' + repository;
  try {
    return await cached(url,async () => {
      const { body, ...evidence } = await read(url,fetcher,{headers:{accept:'application/vnd.github+json','user-agent':'XGuard-Dependency-Intelligence'}},100000);
      const repo = JSON.parse(body);
      if (repo.full_name?.toLowerCase() !== repository.toLowerCase() || typeof repo.archived !== 'boolean') throw new Error('repository_identity_mismatch');
      return { archived:repo.archived, ...evidence };
    });
  } catch { return null; }
}
export async function npmRelease(name,version,fetcher) {
  if (version === 'latest' ? !npmName.test(name) : !validNpm(name,version)) throw new Error('invalid_npm_release');
  const url = 'https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + encodeURIComponent(version);
  return cached(url,async () => {
    const { body, ...evidence } = await read(url,fetcher,{ headers:{ accept:'application/json' } },400000);
    const p = JSON.parse(body);
    if (p.name !== name || !validNpm(name,p.version) || (version !== 'latest' && p.version !== version)) throw new Error('registry_identity_mismatch');
    return { ...evidence, version:p.version, deprecated:typeof p.deprecated === 'string' ? p.deprecated.slice(0,400) : null,
      repository:githubRepository(typeof p.repository === 'string' ? p.repository : p.repository?.url),
      engines:p.engines || {}, peers:p.peerDependencies || {} };
  });
}
export async function packageHealth(q,fetcher) {
  if (q.ecosystem === 'npm') {
    if (!validNpm(q.name,q.version)) throw new Error('invalid_exact_version');
    const exact = await npmRelease(q.name,q.version,fetcher);
    const [latest, repository] = await Promise.all([
      npmRelease(q.name,'latest',fetcher).catch(() => null), archiveStatus(exact.repository,fetcher),
    ]);
    return { exact, latest_version:latest?.version ?? null, latest_source:latest ? {source:latest.source,verified_at:latest.verified_at} : null,
      semver_change:latest ? semver.diff(exact.version,latest.version) : null, repository };
  }
  if (q.ecosystem !== 'PyPI') return null;
  const name = q.name.toLowerCase().replace(/[-_.]+/g,'-');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(name) || !/^[a-z0-9][a-z0-9_.!+-]{0,99}$/i.test(q.version)) throw new Error('invalid_pypi_release');
  const url = 'https://pypi.org/pypi/' + name + '/' + encodeURIComponent(q.version) + '/json';
  const exact = await cached(url,async () => {
    const {body,...evidence} = await read(url,fetcher,{headers:{accept:'application/json'}},600000);
    const data = JSON.parse(body), info = data.info;
    if (typeof info?.name !== 'string' || info.name.toLowerCase().replace(/[-_.]+/g,'-') !== name || info.version !== q.version || !Array.isArray(data.urls)) throw new Error('registry_identity_mismatch');
    const files = data.urls;
    return {version:info.version,requires_python:info.requires_python ?? null,
      yanked:files.length && files.every(file => typeof file.yanked === 'boolean') ? files.every(file => file.yanked) : null,
      repository:githubRepository(info.project_urls?.Source || info.project_urls?.Repository || info.project_urls?.['Source Code']),...evidence};
  });
  return {exact,repository:await archiveStatus(exact.repository,fetcher)};
}
export async function compatibility(q,fetcher) {
  if (!validNpm(q.name,q.version) || !validNpm(q.target,q.target_version)) throw new Error('invalid_exact_version');
  const pkg = await npmRelease(q.name,q.version,fetcher);
  const range = q.target === 'node' ? pkg.engines.node : Object.hasOwn(pkg.peers,q.target) ? pkg.peers[q.target] : undefined;
  const verdict = typeof range === 'string' && semver.validRange(range) ? (semver.satisfies(q.target_version,range) ? 'matches_declared_range' : 'outside_declared_range') : 'unknown';
  return { verdict, target: q.target, target_version: q.target_version, declared_range: range ?? null,
    evidence: [{ source: pkg.source, verified_at: pkg.verified_at }], confidence: verdict === 'unknown' ? 'insufficient_declaration' : 'publisher_manifest',
    scope: 'Published semver range only. Runtime and transitive integration require project testing.' };
}
const packageKey = (ecosystem,name) => ecosystem === 'PyPI' ? name.toLowerCase().replace(/[-_.]+/g,'-') : ecosystem === 'NuGet' ? name.toLowerCase() : name;
export async function advisories(q,fetcher) {
  const url = 'https://api.osv.dev/v1/query';
  const query = { package:{ name:q.name, ecosystem:q.ecosystem }, version:q.version };
  return cached(url + JSON.stringify(query),async () => {
    const { body, ...evidence } = await read(url,fetcher,{ method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(query) },600000);
    const data = JSON.parse(body);
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).some(k => !['vulns','next_page_token'].includes(k)) || (data.vulns !== undefined && !Array.isArray(data.vulns))) throw new Error('osv_schema_unavailable');
    const active = (data.vulns || []).filter(v => !v.withdrawn);
    const identifiers = active.slice(0,36).map(v => {
      if (!/^[a-z0-9][a-z0-9._:-]{1,120}$/i.test(v.id) || !Array.isArray(v.affected)) throw new Error('osv_schema_unavailable');
      const matched = v.affected.filter(a => a.package?.ecosystem === q.ecosystem && packageKey(q.ecosystem,a.package.name) === packageKey(q.ecosystem,q.name));
      return { id:v.id, aliases:(v.aliases || []).filter(s => /^CVE-\d{4}-\d+$/.test(s)).slice(0,8),
        source:'https://osv.dev/vulnerability/' + encodeURIComponent(v.id), modified:v.modified,
        fix_ranges:matched.flatMap(a => (a.ranges || []).map(r => ({ type:r.type, events:(r.events || []).filter(e => e.fixed || e.introduced || e.last_affected).slice(0,20) }))).slice(0,12) };
    });
    const partial = Boolean(data.next_page_token) || active.length > identifiers.length;
    return { verdict: identifiers.length ? 'published_advisories_found' : partial ? 'incomplete' : 'no_matching_advisory_reported', advisories:identifiers, partial,
      evidence:[{...evidence, query}], confidence:partial ? 'partial_index_response' : 'exact_version_index_query',
      scope:'OSV coverage at verification time. Fix events are per advisory and range. Confirm the proposed replacement in a new exact-version query.' };
  });
}
export async function modelCard(model,fetcher) {
  if(!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(model) || model.includes('..')) throw new Error('invalid_model_id');
  const url='https://developers.openai.com/api/docs/models/'+model+'.md';
  return cached(url,async()=>{
    const {body,...evidence}=await read(url,fetcher,{headers:{accept:'text/markdown'}},160000);
    return {...parseModelCard(body,model),evidence:[evidence],scope:'Public provider documentation. Project-specific access, quotas and current service uptime require separately authorized checks.'};
  });
}
export async function diagnose(code,fetcher) {
  const rows = await cached(cfDocs,async () => {
    const { body, ...evidence } = await read(cfDocs,fetcher,{ headers:{ accept:'text/html' } },1100000);
    const { document } = parseHTML(body);
    const entries = new Map();
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length === 2 && Object.hasOwn(actions,cells[0].textContent.trim())) entries.set(cells[0].textContent.trim(),cells[1].textContent.trim().slice(0,480));
    }
    if (!entries.size) throw new Error('error_reference_schema_unavailable');
    return { entries, evidence };
  });
  if (!rows.entries.has(code)) throw new Error('error_code_unverified');
  return { code, documented_meaning:rows.entries.get(code), next_check:actions[code], evidence:[rows.evidence],
    affected_versions:null, fixed_in:null, confidence:'provider_error_reference', scope:'A provider error category. Logs from the affected request are needed for a case-specific diagnosis.' };
}
