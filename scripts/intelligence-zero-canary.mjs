import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
const sha=process.env.DEPLOY_SHA, cli='apps/relay/node_modules/.bin/wrangler', config='apps/relay/wrangler.jsonc';
assert.match(sha||'',/^[0-9a-f]{40}$/);
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim().replace(/^Bearer\s+/i,'').replace(/^"(.*)"$/,'$1');
assert.ok(token && process.env.CLOUDFLARE_ACCOUNT_ID,'Cloudflare deployment credentials required');
function wrangler(...args) {
  return execFileSync(cli,[...args,'--config',config],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:token,WRANGLER_SEND_METRICS:'false'},maxBuffer:4*1024*1024});
}
function active() {return JSON.parse(wrangler('deployments','list','--json')).at(-1)?.versions || [];}
const current=active();
assert.equal(current.length,1);
assert.equal(Number(current[0].percentage),100);
const control=current[0].version_id;
const info=JSON.parse(wrangler('versions','view',control,'--json'));
assert.equal(info.annotations?.['workers/tag'],'git-'+sha.slice(0,12),'Expected the just-verified compatible reader as control');
const log=wrangler('versions','upload','apps/relay/src/paid-only-entry.js','--tag','paid-'+sha.slice(0,12),'--message','Paid-only API canary '+sha);
const candidate=log.match(/Worker Version ID:\s*([0-9a-f-]{36})/)?.[1];
assert.ok(candidate && candidate!==control,'Candidate upload did not return a distinct Worker version');
console.log(JSON.stringify({control,candidate,normal_traffic_percent:0}));
const quoteHeader={'cloudflare-workers-version-overrides':'xguard-mainnet="'+candidate+'"','x-xguard-traffic-class':'canary','accept':'application/json'};
async function probe(origin,path,expected,init={}) {
  const r=await fetch(origin+path,{...init,headers:{...quoteHeader,...init.headers},redirect:'error',signal:AbortSignal.timeout(9000)});
  assert.equal(r.headers.get('x-xguard-worker-version-id'),candidate,'Override not propagated');
  assert.equal(r.status,expected,path);
  return r;
}
try {
  wrangler('versions','deploy',control+'@100',candidate+'@0','--yes','--message','Isolated XGuard paid contract check');
  let last;
  for(let i=0;i<10;i++) {
    try {
      for(const origin of ['https://xguardgate.com','https://api.xguardgate.com']) {
        const catalog=await (await probe(origin,'/api/intelligence/v1/catalog',200)).json();
        assert.equal(catalog.price.unit_price,'0.001');
        const head=await probe(origin,'/fact/npm/react/latest-version',402,{method:'HEAD'}); assert.ok(head.headers.has('payment-required')); assert.equal(await head.text(),'');
        await probe(origin,'/admin/paid-revenue',401);
      }
      const b=await probe('https://api.xguardgate.com','/api/intelligence/v1/batch',402,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({facts:Array(100).fill('npm/react/latest-version')})});
      const offer=await b.json();assert.equal(offer.accepts[0].amount,'100000');assert.equal(offer.accepts[0].network,'eip155:8453');
      last=null;break;
    } catch(e) {last=e;if(i<9) await wait(5000);}
  }
  if(last) throw last;
  console.log(JSON.stringify({verified_version:candidate,apex_and_api:true,private_admin:true,batch_atomic:'100000',money_moved:false}));
} finally {
  // Return to a single active version so the ordinary deploy workflow can take its next snapshot.
  const now=active();
  if(now.some(v=>v.version_id===candidate) && now.every(v=>v.version_id===control || v.version_id===candidate))
    wrangler('versions','deploy',control+'@100','--yes','--message','End isolated paid API canary');
  const after=active();assert.equal(after.length,1);assert.equal(after[0].version_id,control);assert.equal(Number(after[0].percentage),100);
  if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\nPaid-only candidate '+candidate+' received 0% of normal traffic. The deployment returned to '+control+' at 100%.\n');
}
