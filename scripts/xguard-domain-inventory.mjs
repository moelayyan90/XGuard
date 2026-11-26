import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim().replace(/^Bearer\s+/i,'').replace(/^"(.*)"$/,'$1');
assert.ok(account && token);
const root='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/workers';
async function read(path) {
  const response=await fetch(root+path,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  if (!response.ok || body.success===false) {
    const codes=(body.errors||[]).map(e=>e.code).join(',');
    throw Error('Cloudflare HTTP '+response.status+' ('+codes+')');
  }
  return body;
}
const own=h=>h==='xguardgate.com'||h.endsWith('.xguardgate.com');
const known={'xguardgate.com':'xguard-mainnet','www.xguardgate.com':'xguard-mainnet','api.xguardgate.com':'xguard-mainnet','hooks.xguardgate.com':'xguard-lemonhook','credits.xguardgate.com':'xguard-credits','changemandate.xguardgate.com':'changemandate'};
const hosts=new Map(Object.entries(known).map(([hostname,service])=>[hostname,{hostname,service,source:'repository'}]));
let domainList='complete';
try {
  for(let page=1;page<=50;page++) {
    const response=await read('/domains?per_page=100&page='+page);
    for(const d of response.result) if(typeof d.hostname==='string' && own(d.hostname))
      hosts.set(d.hostname,{hostname:d.hostname,service:d.service,source:'cloudflare_custom_domain'});
    if (page>=(response.result_info?.total_pages??1)) break;
    assert.ok(page<50,'Domain inventory pagination limit reached');
  }
} catch(e) { domainList=e.message; }
let workers;
try {
  workers=new Map();
  for(let page=1;page<=50;page++) {
    const response=await read('/workers?per_page=100&page='+page);
    for (const w of response.result) workers.set(w.name,w.id);
    if(page>=(response.result_info?.total_pages??1))break;
    assert.ok(page<50,'Worker inventory pagination limit reached');
  }
} catch { workers=undefined; }
const versions={};
for(const name of new Set([...hosts.values()].map(h=>h.service))) {
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))continue;
  try {
    const deployments=(await read('/scripts/'+name+'/deployments')).result.deployments;
    const latest=deployments.toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
    assert.ok(latest?.versions?.length);
    versions[name]={active:latest.versions.map(v=>({version:v.version_id,percent:v.percentage}))};
    const id=workers?.get(name);
    if(id && latest.versions.length===1) {
      // Retrieve settings only. The report includes names and kinds, never binding values or source.
      const v=(await read('/workers/'+encodeURIComponent(id)+'/versions/'+latest.versions[0].version_id)).result;
      versions[name].entry=v.main_module;
      versions[name].date=v.compatibility_date;
      versions[name].binding_kinds=(v.bindings||[]).map(b=>b.type).sort();
      versions[name].worker_id=id;
    }
  } catch(e) { versions[name] = {...versions[name],inspection:e.message}; }
}
const report={observed_at:new Date().toISOString(),domain_list:domainList,hosts:[...hosts.values()].sort((a,b)=>a.hostname.localeCompare(b.hostname)),workers:versions};
console.log(JSON.stringify(report));
if(process.env.DOMAIN_INVENTORY_FILE)await writeFile(process.env.DOMAIN_INVENTORY_FILE,JSON.stringify(report,null,2));
