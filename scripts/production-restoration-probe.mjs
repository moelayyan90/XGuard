// Small, explicitly synthetic, unsigned probes. No paid execution or settlement.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const output = process.argv[2];
if (!output) throw Error('Supply the evidence output path');
const started = new Date().toISOString(), results = [];
const paths = ['/', '/status', '/healthz', '/readyz', '/.well-known/agent-card.json', '/.well-known/x402', '/supported', '/a2a/health', '/witness/verifier-key', '/witness', '/robots.txt', '/sitemap.xml', '/sitemaps/site.xml', '/openapi.json', '/live/npm/react', '/fact/npm/react/latest-version', '/history/npm/react/latest-version', '/changes'];
async function probe(host, path, method = 'GET', body) {
  const url = host + path, t = performance.now();
  try {
    const r = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'XGuardLive-restoration-diagnostic/1.0', 'x-xguard-traffic-class': 'synthetic', accept: 'application/json, text/event-stream', ...(body ? {'content-type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
    const text = await r.text(); let value; try { value = JSON.parse(text); } catch {}
    if(value?.result?.tools)value.result.tools=value.result.tools.map(t=>({name:t.name}));
    if(value?.openapi)value={openapi:value.openapi,info:value.info,paths:Object.keys(value.paths||{})};
    for(const key of ['history','changes'])if(Array.isArray(value?.[key])&&value[key].length>3){value[key+'_count']=value[key].length;value[key]=value[key].slice(0,3);}
    const result = { url, method, status: r.status, ms: Math.round(performance.now()-t), headers: Object.fromEntries([...r.headers].filter(([k])=>/^(content-type|cache-control|allow|location|retry-after|x-robots-tag|x-xguard-worker-version-id|x-xguard-worker-version-tag|cf-ray|x-xguard-cache)$/.test(k))), ...(value ? {body:value} : {excerpt:text.slice(0,500)}) };
    results.push(result); console.log(JSON.stringify({url,method,status:r.status,ms:result.ms}));
    return value;
  } catch(e) { results.push({url,method,error:String(e)}); console.log(JSON.stringify({url,method,error:String(e)})); }
}
for (const host of ['https://xguardgate.com','https://api.xguardgate.com']) {
  for (let i=0;i<paths.length;i+=2) await Promise.all(paths.slice(i,i+2).map(path=>probe(host,path)));
  await probe(host,'/mcp','POST',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'XGuard restoration diagnostic',version:'1.0'}}});
  await probe(host,'/mcp','POST',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  await probe(host,'/verify','POST',{});
  await probe(host,'/witness/add-checkpoint','POST',{});
  const originHash=createHash('sha256').update('gblin.digital/receipts-log').digest('hex');
  await probe(host,'/witness/'+originHash+'/status');
  await probe(host,'/witness/'+originHash+'/checkpoint');
  await probe(host,'/','HEAD'); await probe(host,'/readyz','HEAD');
}
const fact=results.find(x=>x.url==='https://xguardgate.com/fact/npm/react/latest-version')?.body?.fact;
if(fact?.evidence_url?.startsWith('https://xguardgate.com/evidence/')) await probe('https://xguardgate.com',new URL(fact.evidence_url).pathname);
const changes=results.find(x=>x.url==='https://xguardgate.com/changes')?.body?.changes;
if(changes?.[0]?.entity_id&&changes[0].id) await probe('https://xguardgate.com','/changes/'+changes[0].entity_id+'/'+changes[0].id);
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({started,finished:new Date().toISOString(),scope:'Synthetic unsigned endpoint checks, not traffic analytics or proof of paid verification/settlement.',results},null,2)+'\n');
console.log(JSON.stringify({output,probes:results.length,server_failures:results.filter(x=>x.status>=500||x.error).length}));
