import { BASE, SERVICES, price } from './catalog.js';
export const ROOT = '/api/intelligence/v1';
export const TITLE = 'XGuard Paid Intelligence';
export const MCP = BASE + '/mcp', A2A = BASE + '/a2a';
export const toolName = d => 'xguard.' + d.route.replaceAll('-','_');
export function catalog() {
  return { name:TITLE, price:price(), services:SERVICES.map(d => ({ id:d.route, name:d.name, description:d.description, method:'POST', endpoint:BASE+'/'+d.route, input_schema:d.schema })),
    payment:{ protocol:'x402 v2 exact', network:'eip155:8453', asset:'USDC', first_request:'POST the input. Preserve Idempotency-Key and X-XGuard-Quote from HTTP 402.', retry:'Sign the exact requirements and retry the identical operation with Payment-Signature. Recover a pending result with the original quote.', recovery:BASE+'/results/{payment_identifier}', public_key:BASE+'/proof-key' },
    existing_witness_agreement:{origin:'gblin.digital/receipts-log',scope:'Previously agreed C2SP witnessing. A new paid rate requires the partner’s acceptance.',discussion:'https://github.com/moelayyan90/XGuard/issues/211'},
    transports:{ mcp:MCP, a2a:A2A, openapi:BASE+'/openapi.json', setup:BASE+'/install' } };
}
export function connections() {
  const name = 'xguard-intelligence';
  return { mcp:MCP, a2a_agent_card:BASE+'/.well-known/agent-card.json', openapi:BASE+'/openapi.json',
    codex:'codex mcp add '+name+' --url '+MCP,
    claude_code:'claude mcp add --transport http '+name+' '+MCP,
    gemini_cli:'gemini mcp add --transport http '+name+' '+MCP,
    vscode:{ servers:{[name]:{type:'http',url:MCP}} }, cursor:{ mcpServers:{[name]:{url:MCP}} },
    chatgpt:{transport:'remote MCP',url:MCP,setup:'Add the URL through the custom app settings available in your workspace.'},
    github_action:'moelayyan90/XGuard/integrations/intelligence',
    buyer:'https://github.com/moelayyan90/XGuard/tree/main/integrations/intelligence',
    payment:'Discovery needs no signature. Paid calls require an x402-capable buyer and an explicit spending policy. Client setup alone does not authorize spending.' };
}
export function openApi() {
  const responses = { '200':{description:'Settled result with signed receipt and Payment-Response header'}, '402':{description:'Payment required or rejected',headers:{'Payment-Required':{schema:{type:'string'}}}},'503':{description:'Unavailable or settlement pending. Use the original recovery credentials.'} };
  return { openapi:'3.1.0', info:{title:TITLE,version:'1.0.0'}, servers:[{url:BASE}], paths:Object.fromEntries(SERVICES.map(d => ['/'+d.route,{post:{operationId:d.id.replaceAll('-','_'),summary:d.name,description:d.description,parameters:[
    {in:'header',name:'Idempotency-Key',schema:{type:'string',minLength:8,maxLength:128}},{in:'header',name:'Payment-Signature',schema:{type:'string'}},{in:'header',name:'X-XGuard-Quote',schema:{type:'string'}}],
    requestBody:{required:true,content:{'application/json':{schema:d.schema}}},responses,'x-x402':price()}}])) };
}
export function card() {
  return { name:TITLE, description:'Evidence-backed technical decisions, priced per successful operation.', version:'1.0.0',
    provider:{organization:'XGuard',url:'https://xguardgate.com'}, documentationUrl:BASE+'/catalog', supportedInterfaces:[{url:A2A,protocolBinding:'JSONRPC',protocolVersion:'1.0'}],
    capabilities:{streaming:false,pushNotifications:false,extendedAgentCard:false}, defaultInputModes:['application/json'],defaultOutputModes:['application/json'],
    skills:SERVICES.map(d => ({id:toolName(d),name:d.name,description:d.description,tags:['paid','x402'],inputModes:['application/json'],outputModes:['application/json']})) };
}
export function toolsList() {
  return {tools:SERVICES.map(d => ({ name:toolName(d),title:d.name,description:d.description + ' USD 0.001 per atomic result.',inputSchema:{type:'object',...d.schema},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},_meta:{'xguard/payment':price()} }))};
}
export function landing() {
  return htmlPage('XGuard Paid Intelligence', '<h1>XGuard</h1><p>Paid intelligence for developers and AI agents.</p><p>USD 0.001 per successful atomic operation. A batch of 100 costs USD 0.100. Payments settle in USDC on Base.</p><p><a href="'+BASE+'/catalog">Services and payment instructions</a> · <a href="'+BASE+'/openapi.json">OpenAPI</a> · <a href="'+BASE+'/.well-known/agent-card.json">Agent card</a> · <a href="/open-verifier">Open verifier</a></p>');
}

function htmlPage(title, content) {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><main>'+content+'</main></html>',
    {headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
}

export function openVerifierLanding() {
  const source = 'https://github.com/moelayyan90/XGuard/tree/main/packages/agent-verifier';
  const files = 'https://github.com/moelayyan90/XGuard/blob/main/packages/agent-verifier';
  return htmlPage('XGuard Open Verifier', [
    '<h1>XGuard Open Verifier</h1>',
    '<p>Check what a paid API is asking your agent to spend. Run the verifier locally with Node.js 24 and a public key you trust for that API.</p>',
    '<p>The verifier checks a signed x402 offer and a merchant receipt. Its MCP tools let an agent inspect both. The operator can approve one specific request and enforce a rolling spending limit before a wallet signs.</p>',
    '<h2>Try it offline</h2><p>From the repository root, run <code>npm run verifier:demo</code>. The demo uses a sample merchant and shows what happens when an approval is reused.</p>',
    '<p><a href="'+source+'">Get the Apache-2.0 source and operator guide</a> · <a href="'+files+'/goose.yaml">Open the goose recipe</a></p>',
    '<p><a href="'+files+'/RELEASE.md">Install version 1.0.0 and reproduce the goose and Pydantic AI tests</a> · <a href="'+files+'/PROFILE.md">Read the signing policy and recovery guide</a></p>',
    '<h2>XGuard paid API</h2><p>See the <a href="'+BASE+'/catalog">service catalog and prices</a> for the hosted API.</p>',
  ].join(''));
}
