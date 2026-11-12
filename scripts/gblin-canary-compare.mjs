// Requires an explicit GBLIN-provided fixture. Never discovers a substitute
// paid route, forwards payment authority or submits a valid settlement.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const banned = /authorization|cookie|payment|signature|token|api[-_]?key|secret|x-xguard-credit/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const headersObject = headers => Object.fromEntries([...headers].map(([k,v])=>[k.toLowerCase(),v]));
function endpoint(value, host) {
  const url = new URL(value);
  assert.equal(url.protocol,'https:');assert.equal(url.hostname,host);assert.ok(!url.username&&!url.password&&!url.hash);
  for(const[name]of url.searchParams)assert.equal(banned.test(name),false,'no credentials or payment authority in URLs');
  assert.ok(!/\/(?:settle|capture|transfer|withdraw|approve)(?:\/|$)/i.test(url.pathname),'no execution/payment route as a challenge fixture'); return url.href;
}
export function validateFixture(input) {
  assert.equal(input?.provided_by,'gblinproject','a GBLIN-provided fixture is required');
  assert.equal(input.non_promised,true);assert.equal(input.bazaar_indexed,false);assert.equal(input.hash_pinned,false);assert.equal(input.unpaid_request,true);
  assert.match(input.source_comment,/^https:\/\/github\.com\/moelayyan90\/XGuard\/issues\/211#issuecomment-\d+$/);
  const direct=endpoint(input.direct_url,'mcp.gblin.digital'),through=endpoint(input.through_xguard_url,'api.xguardgate.com');
  assert.ok(['GET','POST'].includes(input.request?.method));
  const headers=new Headers(input.request.headers||{});for(const[name]of headers)assert.equal(banned.test(name),false,'payment authority and credentials are prohibited');
  const body=input.request.body;
  assert.ok(body===undefined||typeof body==='string'&&Buffer.byteLength(body)<=32768);
  if(input.request.method==='GET')assert.ok(body===undefined);
  if(body)assert.ok(!/"[^"\r\n]*(?:payment|signature|authorization|token|secret|key)[^"\r\n]*"\s*:/i.test(body),'no signed or spend-authorizing request fixture');
  const expected=Buffer.from(input.expected_402_body_base64||'','base64');assert.ok(expected.length>0&&expected.length<=131072);
  assert.equal(expected.toString('base64'),input.expected_402_body_base64,'canonical exact expected bytes');
  assert.ok(input.expected_headers&&typeof input.expected_headers==='object'&&!Array.isArray(input.expected_headers));
  for(const value of Object.values(input.expected_headers))assert.equal(typeof value,'string');
  const directFacilitator=endpoint(input.direct_facilitator,'mcp.gblin.digital'),xguardFacilitator=endpoint(input.xguard_facilitator,'api.xguardgate.com');
  return {input,direct,through,headers,expected,directFacilitator,xguardFacilitator};
}
async function bounded(response) {
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(reader)while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){await reader.cancel();throw Error('response too large');}chunks.push(value);}
  return Buffer.concat(chunks);
}
export async function compareCanary(fixture,fetcher=fetch) {
  const f=validateFixture(fixture),captures={direct:[],through:[]};
  const request=async(url,options)=>{
    const started=performance.now();const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
    const body=await bounded(r);return{status:r.status,headers:headersObject(r.headers),body_base64:body.toString('base64'),body_sha256:digest(body),elapsed_ms:performance.now()-started};
  };
  for(let i=0;i<3;i++)for(const[name,url]of[['direct',f.direct],['through',f.through]]) {
    const result=await request(url,{method:f.input.request.method,headers:f.headers,...(f.input.request.body===undefined?{}:{body:f.input.request.body})});
    captures[name].push(result);assert.equal(result.status,402,'anonymous challenge status');
    assert.equal(result.body_base64,f.expected.toString('base64'),'exact golden 402 bytes');
    for(const[name,value]of Object.entries(f.input.expected_headers))assert.equal(result.headers[name.toLowerCase()],value,'required header '+name);
  }
  for(const header of ['content-type','payment-required','www-authenticate','cache-control']) {
    const expected=captures.direct[0].headers[header];
    for(const sample of [...captures.direct,...captures.through])assert.equal(sample.headers[header],expected,'challenge header fidelity: '+header);
  }
  const protocol={};
  for(const[name,base]of[['direct',f.directFacilitator],['xguard',f.xguardFacilitator]]) {
    const prefix=base.replace(/\/$/,'');
    const supported=await request(prefix+'/supported',{method:'GET'});assert.equal(supported.status,200);
    const kinds=JSON.parse(Buffer.from(supported.body_base64,'base64').toString()).kinds;assert.ok(Array.isArray(kinds));
    protocol[name]={supported};
    for(const path of ['/verify','/settle']) {
      const result=await request(prefix+path,{method:'POST',headers:{'content-type':'application/json','user-agent':'XGuard-GBLIN-unsigned-canary/1.0'},body:'{}'});
      assert.ok([400,401,403,422].includes(result.status),'empty unsigned financial request must be rejected');
      protocol[name][path]=result;
    }
  }
  const errorStatusMatch=['/verify','/settle'].every(path=>protocol.direct[path].status===protocol.xguard[path].status);
  return {observed_at:new Date().toISOString(),result:'challenge_passed_protocol_captured',source_comment:f.input.source_comment,challenge_byte_fidelity:true,protocol_error_status_match:errorStatusMatch,captures,protocol,
    scope:'Only fixture-provided anonymous challenge bytes, required headers, status/error captures, latency and unsigned protocol rejection. Successful paid verification/settlement is NOT established. A matching challenge alone does not prove internal facilitator traversal.',
    financial_settlements_submitted:0,payment_authority_forwarded:false,recipient_asset_price_modified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv[2])throw Error('GBLIN route + exact fixture required. No default canary route exists.');
  const result=await compareCanary(JSON.parse(readFileSync(process.argv[2],'utf8')));
  writeFileSync(process.env.GBLIN_CANARY_REPORT||'gblin-canary-evidence.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
