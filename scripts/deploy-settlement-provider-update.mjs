import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const dir='apps/settlement-gateway';
const previous=process.env.PREVIOUS_GIT_REF, sha=process.env.DEPLOY_SHA;
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const files=git('diff','--name-only',previous,sha,'--',dir).split('\n').filter(path=>path && !path.startsWith(dir+'/test/'));
if (!files.length || files.length!==1 || files[0]!==dir+'/xguard-gateway.ts') process.exit(0);
// Only this provider-only change can deploy independently of the public reader.
function businessStateUnchanged(oldRef,newRef) {
  const before=git('show',oldRef+':'+dir+'/xguard-gateway.ts'), after=git('show',newRef+':'+dir+'/xguard-gateway.ts');
  const pre=s=>s.slice(0,s.indexOf('async function '+(s.includes('async function callProvider')?'availableBaseProvider':'xpay')+'(')).split('const PUBLIC_BASE_RAILS')[0].trim();
  assert.ok(pre(before).includes('class XGuardState') && pre(before)===pre(after),'Financial storage, authentication or routing changed; coordinate a separate release.');
  const from=s=>s.slice(s.indexOf('function baseClient('),s.indexOf('      const checked = await xpay(')>=0?s.indexOf('      const checked = await xpay('):s.indexOf('      const selectedProvider = await availableBaseProvider('));
  assert.ok(from(before).includes('async function paidRead') && from(before)===from(after),'Receipt confirmation or order claim changed.');
  const tail=s=>s.slice(s.indexOf('      const verified = (checked.isValid')).replace(/await (?:xpay\(env, |callProvider\(env, selectedProvider, )"settle", payment\)/g,'SETTLE_SAME_PROVIDER').replace('        base_facilitator: await availableBaseProvider(),\n','');
  assert.equal(tail(before),tail(after),'Durable settlement or recovery changed.');
}
function isOriginMigration(oldRef,newRef) {
  const file = ':'+dir+'/xguard-gateway.ts';
  const before=git('show',oldRef+file), after=git('show',newRef+file);
  if (before.includes('async function factOriginProtocol(') || !after.includes('async function factOriginProtocol(')) return false;
  const previousStart='async function prepareFacts(env: Env, r: Route): Promise<string> {';
  const nextStart='async function factOriginProtocol(env: Env) {';
  const end='  if (origin.status !== 200 ||';
  function checkedSource(source, start) {
    const a=source.indexOf(start), b=source.indexOf(end,a);
    assert.ok(a>=0 && b>a,'Expected the isolated origin read');
    return (source.slice(0,a) + source.slice(b))
      .replace('Fetcher & { readSettlementFact(id: string): Promise<Response> }','Fetcher')
      .replace('        fact_origin: await factOriginProtocol(env),\n','');
  }
  assert.equal(checkedSource(before,previousStart),checkedSource(after,nextStart),'Only the private source read and its catalog readiness may change.');
  return true;
}
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim().replace(/^Bearer\s+/i,'').replace(/^"(.*)"$/,'$1');
const wr=(...args)=>execFileSync('node_modules/.bin/wrangler',[...args,'--config','wrangler.jsonc'],{cwd:dir,encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:token,WRANGLER_SEND_METRICS:'false'},maxBuffer:5000000});
const deployments=()=>JSON.parse(wr('deployments','list','--json')).at(-1).versions;
const active=deployments();
assert.equal(active.length,1);assert.equal(Number(active[0].percentage),100);
const prior=active[0].version_id;
const tag=id=>JSON.parse(wr('versions','view',id,'--json')).annotations?.['workers/tag'];
const priorTag=tag(prior);assert.match(priorTag,/^git-[a-f0-9]{12,40}$/);
const priorRef=git('rev-parse',priorTag.slice(4)+'^{commit}');
const tree=git('rev-parse',sha+':'+dir);
if (git('rev-parse',priorRef+':'+dir)!==tree) {
  const privateFiles=git('diff','--name-only',priorRef,sha,'--',dir).split('\n').filter(path=>path&&!path.startsWith(dir+'/test/'));
  assert.deepEqual(privateFiles,[dir+'/xguard-gateway.ts'],'The private Worker has additional undeployed runtime changes.');
  const originMigration=isOriginMigration(priorRef,sha);
  if (!originMigration) businessStateUnchanged(priorRef,sha);
  const output=wr('versions','upload','--tag','git-'+sha.slice(0,12),'--message','Compatible private settlement update');
  const candidate=output.match(/Worker Version ID:\s*([0-9a-f-]{36})/)?.[1];
  assert.ok(candidate && candidate!==prior);
  async function check(expected, override) {
    for(let attempt=0;attempt<8;attempt++) {
      try {
        const r=await fetch('https://xguardgate.com/api/gateway/v1/catalog',{headers:{accept:'application/json','cache-control':'no-cache',...(override?{'cloudflare-workers-version-overrides':'xguard-settlement-gateway="'+expected+'"'}:{})},signal:AbortSignal.timeout(9000)});
        assert.equal(r.status,200);const catalog=await r.json();
        assert.ok(['https://facilitator.xpay.sh','https://facilitator.payai.network'].includes(catalog.base_facilitator));
        if (originMigration) assert.equal(catalog.fact_origin,'private-worker-rpc-v1');
        return;
      } catch(e) {if(attempt===7)throw e;await wait(3000);}
    }
  }
  try {
    wr('versions','deploy',prior+'@100',candidate+'@0','--yes','--message','Test private settlement compatibility');
    await check(candidate,true);
    wr('versions','deploy',candidate+'@100','--yes','--message','Promote verified private settlement');
    await check(candidate,false);
    assert.equal(deployments()[0].version_id,candidate);
    assert.equal(tag(candidate),'git-'+sha.slice(0,12));
  } catch(e) {wr('versions','deploy',prior+'@100','--yes','--message','Restore previous private settlement');throw e;}
}
appendFileSync(process.env.GITHUB_OUTPUT,'verified_tree='+tree+'\n');
console.log(JSON.stringify({worker:'xguard-settlement-gateway',verified_tree:tree,payments_submitted:0}));
