import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFixture,compareCanary } from './gblin-canary-compare.mjs';
const bytes=JSON.stringify({x402Version:2,accepts:[{scheme:'exact',network:'eip155:8453',asset:'fixture_asset',payTo:'fixture_merchant',amount:'50000'}]});
// These paths exist only inside a fake fetcher; never submit them to production.
const fixture={provided_by:'gblinproject',source_comment:'https://github.com/moelayyan90/XGuard/issues/211#issuecomment-1',non_promised:true,bazaar_indexed:false,hash_pinned:false,unpaid_request:true,
  direct_url:'https://mcp.gblin.digital/fixture-only-not-a-real-route',through_xguard_url:'https://api.xguardgate.com/fixture-only-not-a-real-route',
  request:{method:'GET'},expected_402_body_base64:Buffer.from(bytes).toString('base64'),expected_headers:{'content-type':'application/json','payment-required':'fixture-wire'},
  direct_facilitator:'https://mcp.gblin.digital/fixture-facilitator',xguard_facilitator:'https://api.xguardgate.com'};
test('no missing, protected, credentialed or signed fixture can trigger a canary',async()=>{
  for(const patch of [{provided_by:'unknown'},{bazaar_indexed:true},{hash_pinned:true},{non_promised:false},{unpaid_request:false},{through_xguard_url:'https://evil.test/'},{request:{method:'GET',headers:{'Payment-Signature':'secret'}}},{request:{method:'POST',body:'{"signature":"spend"}'}},{direct_url:'https://mcp.gblin.digital/settle'}])assert.throws(()=>validateFixture({...fixture,...patch}));
});
test('only exact unpaid bytes and unsigned rejection probes are sent',async()=>{
  const seen=[];const fetcher=async(url,init)=>{
    seen.push({url,init});assert.equal(init.redirect,'error');
    if(url.endsWith('/supported'))return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453'}]});
    if(url.endsWith('/verify')||url.endsWith('/settle')){assert.equal(init.body,'{}');return Response.json({error:'missing_payment_payload'},{status:400});}
    assert.equal(init.method,'GET');assert.equal(init.body,undefined);return new Response(bytes,{status:402,headers:{'content-type':'application/json','payment-required':'fixture-wire'}});
  };
  const result=await compareCanary(fixture,fetcher);assert.equal(result.challenge_byte_fidelity,true);assert.equal(result.financial_settlements_submitted,0);assert.equal(seen.length,12);
});
test('a changed recipient, asset, amount, status or required header fails comparison',async()=>{
  for(const failure of ['payTo','asset','amount','status','header']) {
    let calls=0;const fetcher=async()=>{calls++;const body=JSON.parse(bytes);if(['payTo','asset','amount'].includes(failure))body.accepts[0][failure]='changed';return new Response(JSON.stringify(body),{status:failure==='status'?200:402,headers:{'content-type':'application/json','payment-required':failure==='header'?'changed':'fixture-wire'}});};
    await assert.rejects(compareCanary(fixture,fetcher));assert.equal(calls,1);
  }
});
