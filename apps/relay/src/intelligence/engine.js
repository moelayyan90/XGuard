import { BASE, definitionFor, routeFor } from './catalog.js';
import { compareOpenApi } from './openapi.js';
import { advisories, compatibility, diagnose, npmRelease } from './sources.js';
import { rpc, shardName, shardOf, hash } from '../live/util.ts';
import { canonicalFact } from '../live/paid-data.ts';
import { sourceSpec } from '../live/adapters.ts';
const toolTasks = { fact:'facts', dependency:'dependencies', 'api-diff':'breaking-changes', 'model-price':'models', compatibility:'compatibility', diagnosis:'failures', 'cloud-status':'infrastructure', advisory:'security', decision:'decisions' };
const sourceId = id => id.slice(0,id.lastIndexOf('/'));
const queryShard = (env,entity,op,body) => rpc(env.LIVE_SHARDS,shardName(shardOf(entity)),op,body);
function ensureFact(id) {
  if (!canonicalFact(id)) throw new Error('invalid_fact_id');
  return id;
}
function compact(f) {
  if (!f || typeof f.source_url !== 'string' || !Number.isFinite(Date.parse(f.verified_at))) throw new Error('fact_not_available');
  return { id:f.id, value:f.current_value, last_observed:f.last_observed_value, verification:f.verification, confidence:f.confidence,
    verified_at:f.verified_at, age_seconds:Math.max(0,Math.floor((Date.now()-Date.parse(f.verified_at))/1000)),
    source:f.source_url, source_hash:f.source_hash, unit:f.unit, changed_at:f.changed_at };
}
async function oneFact(env,id) {
  ensureFact(id);
  const record = await queryShard(env,sourceId(id),'fact-page',{id});
  return { ...compact(record?.fact), recent_history:(record.history || []).map(o => ({ at:o.observed_at, value:o.value, source:o.source_url, hash:o.source_hash })) };
}
async function batch(env,ids) {
  const shards = new Map();
  for (const id of new Set(ids)) {
    const index = shardOf(sourceId(ensureFact(id)));
    if (!shards.has(index)) shards.set(index,[]);
    shards.get(index).push(id);
  }
  const results = new Map(), chunks = [];
  for (const [shard,facts] of shards) for (let i=0;i<facts.length;i+=20) chunks.push([shard,facts.slice(i,i+20)]);
  for (let i=0;i<chunks.length;i+=5) await Promise.all(chunks.slice(i,i+5).map(async ([n,facts]) => {
    const rows = await rpc(env.LIVE_SHARDS,shardName(n),'paid-read',{kind:'batch',facts});
    if (!Array.isArray(rows) || rows.length !== facts.length) throw new Error('incomplete_batch');
    for (const row of rows) results.set(row.id,compact(row.fact));
  }));
  return { units:ids.length, facts:ids.map(id => { if (!results.has(id)) throw new Error('incomplete_batch'); return results.get(id); }) };
}
async function infrastructure(env,provider) {
  const f = await oneFact(env,'status/' + provider + '/service-status');
  return { verdict:f.verification !== 'VERIFIED' ? 'unknown' : f.value === 'none' ? 'no_reported_incident' : 'review_provider_incident',
    action:f.verification !== 'VERIFIED' ? 'Check the current provider status before deploying.' : f.value === 'none' ? 'Use application-level checks before deployment.' : 'Review the provider incident and affected components before deployment.',
    evidence:[f], scope:'Provider-wide status can differ from regional and application availability.' };
}
export async function prepareIntelligence(input,env,fetcher=fetch) {
  const start = Date.now(), d = definitionFor(input.capability), q = input.query;
  if (!d) throw new Error('unknown_intelligence_operation');
  let data;
  switch (d.route) {
    case 'facts': data = await oneFact(env,q.fact); break;
    case 'batch': data = await batch(env,q.facts); break;
    case 'history':
    case 'changes': {
      const id = ensureFact(q.fact);
      const page = await queryShard(env,sourceId(id),'history',{id,page:q.page || 1,include_label:true});
      if (!page || !Array.isArray(page.history)) throw new Error('history_unavailable');
      if (d.route === 'changes') {
        const rows = page.history;
        data = { fact:id, changes:rows.slice(0,-1).flatMap((r,i) => JSON.stringify(r.value) === JSON.stringify(rows[i+1].value) ? [] : [{at:r.observed_at, previous:rows[i+1].value, current:r.value, source:r.source_url, hash:r.source_hash}]), scope:'Changes between consecutive retained observations on the latest history page.' };
      } else data = {fact:id,page:q.page || 1,observations:page.history.map(r => ({ at:r.observed_at, value:r.value, source:r.source_url, hash:r.source_hash }))};
      break;
    }
    case 'evidence': {
      const [adapter,...rest] = q.entity.split('/');
      if (sourceSpec(adapter,rest.join('/')).id !== q.entity || !/^[a-zA-Z0-9_-]{1,100}$/.test(q.observation)) throw new Error('invalid_observation_id');
      const e = await queryShard(env,q.entity,'evidence',{ entity:q.entity,observation:q.observation });
      if (!e) throw new Error('observation_unavailable');
      data = { observation:q.observation, fact:e.fact_id, value:JSON.parse(e.value_json), observed_at:e.observed_at, source:e.source_url, hash:e.source_hash, method:e.method }; break;
    }
    case 'models':
      if (!/^pricing\/(openai|anthropic)\/[a-z0-9-]+(input|output)-price$/.test(q.fact)) throw new Error('unsupported_model_price_field');
      data = await oneFact(env,q.fact); break;
    case 'breaking-changes': data = await compareOpenApi(q.before,q.after); break;
    case 'infrastructure': data = await infrastructure(env,q.provider); break;
    case 'failures': data = await diagnose(q.code,fetcher); break;
    case 'compatibility': data = await compatibility(q,fetcher); break;
    case 'security': data = await advisories(q,fetcher); break;
    case 'dependencies': {
      const advisory = await advisories(q,fetcher);
      const manifest = q.ecosystem === 'npm' ? await npmRelease(q.name,q.version,fetcher) : null;
      data = { package:q, advisory, publisher:manifest, action:advisory.advisories.length ? 'Review published fixed ranges and test an exact replacement.' : manifest?.deprecated ? 'Replace the deprecated release and test compatibility.' : 'Review the supplied evidence before updating.',
        abandonment:'unknown', scope:'Publisher deprecation and vulnerability declarations do not establish abandonment or whole-project compatibility.' }; break;
    }
    case 'decisions': {
      if (q.question === 'provider-available') data = await infrastructure(env,q.provider);
      else if (q.question === 'npm-compatibility') data = await compatibility(q,fetcher);
      else data = await advisories(q,fetcher);
      data = { question:q.question, decision:data.verdict, confidence:data.confidence || data.evidence[0]?.confidence || 'documented_observation', ...data }; break;
    }
    case 'tools': {
      const target = routeFor(toolTasks[q.task]);
      data = { service:target.name, operation:target.route, method:'POST', endpoint:BASE + '/' + target.route, input_schema:target.schema,
        output_schema:{type:'object',required:['result','receipt','settlement','proofrail']}, payment:'x402 v2 exact on Base', protocols:['HTTP','MCP','A2A'],
        evidence:[{source:BASE + '/catalog', kind:'deployed service registry', revision:env.CF_VERSION_METADATA?.tag || null}], scope:'XGuard registry. Availability of external clients and providers is not probed.' }; break;
    }
    default: throw new Error('intelligence_handler_unavailable');
  }
  const body = JSON.stringify(data), bytes = new TextEncoder().encode(body).length;
  if (bytes > 65000) throw new Error('intelligence_result_exceeds_storage_budget');
  return { data,status:200,final_url:BASE + '/' + d.route,content_type:'application/json',body_sha256:await hash(body),body_bytes:bytes,latency_ms:Date.now()-start,
    verification:{ scope:'Evidence and limitations are included in the result.' } };
}
