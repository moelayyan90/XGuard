import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { checkProduction } from './paid-intelligence-production.mjs';

const sha=process.env.DEPLOY_SHA;
assert.match(sha||'',/^[a-f0-9]{40}$/);
const tag='git-'+sha.slice(0,12);
const relayConfig='apps/relay/wrangler.jsonc';
const credential=(process.env.CLOUDFLARE_API_TOKEN||'').trim().replace(/^Bearer\s+/i,'').replace(/^"(.*)"$/,'$1');
assert.ok(credential && process.env.CLOUDFLARE_ACCOUNT_ID);
const releaseEnv={...process.env,CLOUDFLARE_API_TOKEN:credential,WRANGLER_SEND_METRICS:'false'};
const run=(command,args,env=releaseEnv)=>execFileSync(command,args,{env,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const wr=(...args)=>run('apps/relay/node_modules/.bin/wrangler',[...args,'--config',relayConfig]);
const git=(...args)=>run('git',args);
const versions=()=>JSON.parse(wr('deployments','list','--json')).at(-1).versions;
const view=id=>JSON.parse(wr('versions','view',id,'--json'));
function single() {
  const active=versions();
  assert.equal(active.length,1,'Concurrent or unfinished Cloudflare release');
  assert.equal(Number(active[0].percentage),100);
  return active[0].version_id;
}

const control=single();
const priorTag=view(control).annotations?.['workers/tag'];
assert.match(priorTag||'',/^git-[a-f0-9]{12,40}$/);
const previous=git('rev-parse',priorTag.slice(4)+'^{commit}');
git('merge-base','--is-ancestor',previous,sha);
const state=JSON.parse(git('show',previous+':apps/relay/deployment-state.json'));
assert.ok(state.payment_state_version>=7 && state.payment_state_write_version>=7,'Deploy a compatible paid writer first');
const guard=JSON.parse(run('node',['scripts/durable-object-deploy-guard.mjs',previous,sha]));
assert.ok(guard.rollbackAllowed && guard.isolated,'Use a separate durable migration before this gradual release');
assert.ok(git('show',sha+':'+relayConfig).includes('"main": "src/paid-only-entry.js"'));
if (!git('show',previous+':'+relayConfig).includes('"main": "src/paid-only-entry.js"'))
  run('node',['scripts/live-capacity-preflight.mjs'],{...releaseEnv,PREVIOUS_WORKER_ID:control});
const privateFiles=git('diff','--name-only',previous,sha,'--','apps/settlement-gateway')
  .split('\n').filter(f=>f && !f.startsWith('apps/settlement-gateway/test/'));
if(privateFiles.length) {
  assert.deepEqual(privateFiles,['apps/settlement-gateway/xguard-gateway.ts']);
  run('node',['scripts/deploy-settlement-provider-update.mjs'],{...releaseEnv,PREVIOUS_GIT_REF:previous});
}
async function retry(fn,count=5) {
  for(let i=1;;i++) {
    try { return await fn(); } catch(e) {
      if(i>=count) throw e;
      console.log('Release verification retry',i,String(e.message).slice(0,220));
      await wait(6000);
    }
  }
}
const evidence=async(candidate,full)=>{
  const observed=await checkProduction({candidate,tag,full});
  const report=run('node',['scripts/c2sp-stability-audit.mjs'],{
    ...releaseEnv,EXPECTED_XGUARD_TAG:tag,...(candidate?{CANDIDATE_WORKER_ID:candidate}:{}),
  });
  assert.equal(JSON.parse(report).result,'passed');
  console.log(JSON.stringify({...observed,gblin_witness:'verified'}));
  return observed;
};
if (previous===sha) {
  await retry(()=>evidence(undefined,true));
} else {
  assert.equal(single(),control);
  const output=wr('versions','upload','--tag',tag,'--message','XGuard paid-only release '+sha);
  const candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/)?.[1];
  assert.ok(candidate && candidate!==control);
  assert.equal(view(candidate).annotations?.['workers/tag'],tag);
  let changed=false;
  function deploy(percent) {
    assert.ok(versions().every(v=>[control,candidate].includes(v.version_id)),'A different deployment is already active');
    changed=true;
    const args=percent===100?[candidate+'@100']:[control+'@'+(100-percent),candidate+'@'+percent];
    wr('versions','deploy',...args,'--yes','--message','Paid intelligence '+percent+'% verification');
  }
  try {
    deploy(0);
    await retry(()=>evidence(candidate,true));
    deploy(5);
    await wait(60000);
    await retry(()=>evidence(candidate,false));
    deploy(100);
    await wait(30000);
    await retry(()=>evidence(undefined,true));
    assert.equal(single(),candidate);
    if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\nVerified paid entry on apex and API, 0% → 5% → 100%. Version '+candidate+'. Previous version '+control+'. No payment was submitted.\n');
  } catch(e) {
    if(changed && versions().every(v=>[control,candidate].includes(v.version_id))) {
      wr('versions','deploy',control+'@100','--yes','--message','Restore prior XGuard release after failed paid-contract checks');
      assert.equal(single(),control);
      await retry(async()=>{
        const r=await fetch('https://api.xguardgate.com/api/intelligence/v1/catalog',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(12000)});
        assert.equal(r.headers.get('x-xguard-worker-version-id'),control);
        assert.equal(r.status,200);
        assert.equal((await r.json()).new_payments_enabled,true);
      });
      console.log('Restored and verified previous active Worker',control);
    }
    throw e;
  }
}
