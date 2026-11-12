import { writeFileSync } from 'node:fs';
import { auditStability } from './c2sp-stability-contract.mjs';

const overrides = process.env.CANDIDATE_WORKER_ID;
if (overrides && !/^[a-f0-9-]{36}$/.test(overrides)) throw Error('Invalid candidate Worker ID');
const get = url => fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
  'user-agent': 'XGuard-C2SP-ReadOnly-Audit/1.0 (+https://github.com/moelayyan90/XGuard/issues/211)', 'cache-control': 'no-cache',
  ...(overrides && new URL(url).hostname === 'api.xguardgate.com' ? { 'Cloudflare-Workers-Version-Overrides': 'xguard-mainnet=' + overrides } : {}),
} });
let evidence;
for(let attempt = 1; attempt <= 3; attempt++) {
  try { evidence = await auditStability({ get, requireStatus: process.env.C2SP_REQUIRE_HISTORY_STATUS !== 'false', expectedTag: process.env.EXPECTED_XGUARD_TAG }); break; }
  catch(error) { evidence = { result:'failed', observed_at:new Date().toISOString(), attempt, error:String(error.message), mode:'GET-only', financial_settlements_submitted:0 }; if(attempt < 3) await new Promise(resolve=>setTimeout(resolve,1000*attempt)); }
}
writeFileSync(process.env.C2SP_STABILITY_REPORT || 'c2sp-stability-evidence.json', JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
if(evidence.result !== 'passed')process.exitCode = 1;
