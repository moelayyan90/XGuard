// A Sandbox deploy must not mutate production. This guard only reads Cloudflare.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim().replace(/^Bearer\s+/i,'').replace(/^"|"$/g,'').trim();
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && /^[a-f0-9]{32}$/i.test(account||''),'Provider credentials unavailable');
const [mode,path]=process.argv.slice(2); assert.ok(['snapshot','verify'].includes(mode)&&path,'Require a snapshot or verify path');
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/xguard-mainnet/deployments`,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
assert.ok(response.ok,`Production deployment visibility unavailable (${response.status})`);
const data=await response.json(),current=data.result?.deployments?.[0]?.versions;
assert.ok(data.success&&current?.length===1&&current[0].percentage===100,'Require one stable production version');
const value={version_id:current[0].version_id,percentage:100};
if(mode==='snapshot')writeFileSync(path,JSON.stringify(value));
else assert.deepEqual(value,JSON.parse(readFileSync(path,'utf8')),'Sandbox workflow changed production');
console.log(JSON.stringify({production_guard:mode,production_version:value.version_id,production_mutations:0,real_payments:0}));
