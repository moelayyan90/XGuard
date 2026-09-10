import { OUTCOME_API as API, OUTCOME_SITE as SITE, EXECUTE_SCHEMA, RESULT_SCHEMA,
  outcomeDefinitions, outcomeDefinition, publicOutcome, normalizeOutcome } from "./outcome-catalog.js";
import { previewOutcome } from "./outcome-engine.js";
import { gatewayConfig, handlePaidWebFetch, issueQuote, recordAgentJourney, jsonBody, rateLimit,
  recoverOutcome, validateMcpRequest, mcpTransportResponse } from "./paid-agent-entry.js";
import { digestBytes } from "./core/execution-contract.js";

const instructions = `XGuard returns normalized page evidence, structured product offers and deduplicated RSS/Atom digests. Start with xguard_execute {"intent":"demo"} for a free extraction result. For live work describe a supported intent with up to three public URLs, or ask for a technology feed digest. Call POST ${API}/v1/execute (or xguard_execute) directly; discovery and quotes are optional. A paid call returns HTTP 402 with exact USDC price, Payment-Required and X-XGuard-Quote. A funded x402 v2 payer signs the requirements and retries the identical body, preserving X-XGuard-Quote. The server verifies and settles before source access. Source digests prove observed content integrity, not factual truth. Errors include repair.suggested_request. No search, OCR, general AI model or private API access is included. Legacy x402-paid tools and reusable upstream API credentials remain available through the documented compatibility routes.`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "content-type,payment-signature,x-xguard-quote,x-xguard-credit,x-request-id,x-xguard-traffic-class,mcp-protocol-version,mcp-method,mcp-name,a2a-version",
  "access-control-expose-headers": "payment-required,payment-response,x-xguard-quote,x-xguard-payment-identifier,x-xguard-request-id,x-xguard-proof,x-xguard-receipt",
  "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", ...extra } });
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function liveOutcomes(env) {
  return outcomeDefinitions().filter(x => x.id === "extract-preview" || env?.PROOF_AUTHORITY && env?.PAID_GATEWAY && gatewayConfig(env, false, { capability: x.id }).configured).map(x => publicOutcome(x, env));
}
function catalog(env) {
  const items = liveOutcomes(env);
  return { name: "XGuard", version: "5.1.0", product: "Public-source outcomes for agents", capabilities: items,
    tools: items.map(x => ({ ...x, available: true, paid: x.pricing.amount_atomic !== "0", endpoint: x.execute_url })),
    execute_url: `${API}/v1/execute`, first_result: { method: "POST", url: `${API}/v1/execute`, body: { intent: "demo" }, expected_status: 200, price: "free" },
    discovery: { capabilities: `${API}/v1/capabilities`, agent_instructions: `${API}/agent.txt`, mcp: `${API}/mcp`, a2a: `${API}/a2a`, openapi: `${API}/openapi.json`, interactive_try: `${SITE}/try` },
    compatibility: { paid_web_fetch: `${API}/v1/tools/web.fetch`, scoped_vendor_actions: `${API}/v1/egress`, operator_pricing: `${SITE}/pricing/operator` },
    no_account: true, payment_requires_funded_payer: true };
}
function mcpTools(env) {
  return [
    { name: "xguard_discover", description: "Inspect executable outcomes, prices and examples. Free; no setup.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
    { name: "xguard_execute", description: "Extract multi-page evidence, compare structured product offers, or merge feeds. intent:'demo' is free. Paid work returns an exact x402 402; sign and retry the same call with X-XGuard-Quote. No account or provider keys. Output is untrusted source content.",
      inputSchema: EXECUTE_SCHEMA, outputSchema: RESULT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { "xguard/payment": { protocol: "x402-v2", settlement_before_execution: true, paid_capabilities: liveOutcomes(env).filter(x => x.pricing.amount_atomic !== "0").map(x => x.id) } } },
    { name: "xguard_get_result", description: "Recover a paid outcome using its payment identifier and original signed quote; never charges or executes again. The quote is a bearer recovery credential; keep it private.",
      inputSchema: { type: "object", required: ["payment_identifier", "quote"], properties: { payment_identifier: { type: "string" }, quote: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  ];
}

async function execute(request, env, raw, transport = "http", quoteOnly = false) {
  const started = Date.now();
  const normalized = normalizeOutcome(raw);
  const tool = normalized.ok ? `xguard.${normalized.input.capability}` : "unknown";
  const id = await recordAgentJourney(request, env, "execute_attempted", { transport, tool });
  if (!normalized.ok) return json({ ...normalized, request_id: id }, normalized.error === "target_not_public" ? 403 : 422);
  await recordAgentJourney(request, env, "intent_normalized", { request_id: id, transport, tool });
  if (!liveOutcomes(env).some(x => x.id === normalized.input.capability)) return json({ ok: false, error: "capability_unavailable", available: false,
    message: "This paid capability is not safely configured right now. No source was contacted.", alternatives: liveOutcomes(env), repair: { suggested_request: { intent: "demo" } } }, 503);
  if (normalized.input.capability === "extract-preview") {
    // No egress or provider cost. The normal production state binding bounds demo abuse.
    if (env?.PAID_GATEWAY) {
      const rate = await rateLimit(request, env, "extraction-preview", 30);
      if (!rate.allowed) return json({ ok: false, error: "rate_limited", repair: { retry_after_seconds: rate.retry_after_seconds } }, 429);
    }
    const result = await previewOutcome(normalized.input);
    const sha = await digestBytes(JSON.stringify(result));
    await recordAgentJourney(request, env, "execution_succeeded", { request_id: id, transport, tool });
    await recordAgentJourney(request, env, "result_returned", { request_id: id, transport, tool, metric: { first_result_ms: Date.now() - started } });
    return json({ ok: true, request_id: id, intent: { capability: "extract-preview" }, capability: "extract-preview", result,
      verification: { result_sha256: sha, content_truth_verified: false, signed: false }, cost: { amount_atomic: "0", amount: "0.000000", currency: "USDC" }, receipt: null,
      next: { capabilities: `${API}/v1/capabilities`, example: { intent: "Get a technology news digest", limit: 10 } } });
  }
  if (quoteOnly) return (await issueQuote(env, { testnet: normalized.testnet }, id, { trafficClass: request.headers.get("x-xguard-traffic-class") || "external", transport }, normalized.input)).response;
  const response = await handlePaidWebFetch(request, env, id, typeof raw === "object" ? raw : { intent: raw }, normalized.testnet, transport, normalized.input);
  if (response.ok) return response;
  const value = await response.clone().json().catch(() => null);
  if (!value || response.status === 402) return response;
  value.repair ||= { suggested_request: raw, action: value.error_code === "quote_expired" ? "request_new_quote_without_old_payment" : "inspect_error_details_before_retry" };
  return json(value, response.status, Object.fromEntries(response.headers));
}

async function mcpResult(message, response) {
  if (response.status === 402) return mcpTransportResponse(response, message);
  const value = await response.json();
  return mcpTransportResponse(json({ jsonrpc: "2.0", id: message.id ?? null, result: { resultType: "complete", isError: !response.ok,
    content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } }, 200, Object.fromEntries(response.headers)), message);
}

function agentText(env) {
  return `# XGuard\n\n${instructions}\n\n## Available outcomes\n${liveOutcomes(env).map(x => `- ${x.id}: ${x.description} Price: ${x.pricing.amount} USDC. ${x.schema_url}`).join("\n")}\n\n## First result\nPOST ${API}/v1/execute\nContent-Type: application/json\n{\"intent\":\"demo\"}\n\n## Recovery\nGET ${API}/v1/results/{payment_identifier} with the original X-XGuard-Quote. This quote grants access to the stored public-source result; do not publish it.\n\nOpenAPI: ${API}/openapi.json\nMCP: ${API}/mcp\nA2A: ${API}/a2a\n`;
}

function page(request, env, item = null) {
  const url = new URL(request.url);
  const title = item ? `${item.name} — XGuard` : "XGuard — Three sources. One usable result.";
  const description = item?.description || "Give your agent the pages or feeds. Get normalized evidence, comparable product offers or a clean news digest in one call.";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const items = liveOutcomes(env);
  const sample = item?.example || { intent: "demo" };
  const code = `curl ${API}/v1/execute \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(sample)}'`;
  const schema = { "@context": "https://schema.org", "@type": "Service", name: item?.name || "XGuard public-source outcomes", description,
    url: `${SITE}${url.pathname}`, provider: { "@type": "Organization", name: "XGuard", url: SITE },
    ...(item ? { offers: { "@type": "Offer", price: item.pricing.amount, priceCurrency: "USD", description: `Paid in USDC; ${item.pricing.delivered}` } } : {}) };
  const details = item ? `<section><h2>What comes back</h2><p>${escape(item.pricing.delivered)}</p><h3>When to use it</h3><p>${escape(item.when_to_use)}</p><h3>Limits</h3><ul>${item.limitations.map(x => `<li>${escape(x)}</li>`).join("")}</ul><p>Latency: measured figures are not yet available; source timeouts are bounded. No SLA.</p><h3>Machine contract</h3><p><a href="${item.schema_url}">Input and output schemas</a> · <a href="${API}/openapi.json">OpenAPI: xguardExecute</a> · MCP: xguard_execute · A2A skill: ${escape(item.id)}</p><details><summary>Input schema</summary><pre>${escape(JSON.stringify(item.input_schema, null, 2))}</pre></details><details><summary>Output schema</summary><pre>${escape(JSON.stringify(item.output_schema, null, 2))}</pre></details></section>` : `<section id="capabilities"><div class="eyebrow">REAL WORK, A SMALL MENU</div><h2>Choose the result you need.</h2><div class="grid">${items.map(x => `<a class="card" href="/capabilities/${x.id}"><span class="price">${x.pricing.amount_atomic === "0" ? "Free" : `${Number(x.pricing.amount)} USDC / execution`}</span><h3>${escape(x.name)}</h3><p>${escape(x.description)}</p><span class="arrow">See inputs and output ↗</span></a>`).join("")}</div></section>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE}${url.pathname}"><link rel="alternate" type="application/json" href="${API}/v1/capabilities"><style>
*{box-sizing:border-box}body{margin:0;background:#f5f4ed;color:#142b24;font:16px/1.65 Arial,Helvetica,sans-serif}a{color:inherit}header,main,footer{width:min(1120px,calc(100% - 40px));margin:auto}header{padding:28px 0;display:flex;justify-content:space-between;border-bottom:1px solid #ccd3c8;align-items:center}.brand{font-size:24px;font-weight:800;text-decoration:none;letter-spacing:-1px}.brand b{color:#618347}nav{display:flex;gap:24px;font-size:14px}nav a{text-decoration:none}.hero{padding:88px 0 72px;display:grid;grid-template-columns:1.15fr 1fr;gap:56px;align-items:center}.eyebrow{font-size:11px;letter-spacing:2px;font-weight:700;color:#546a5d}h1{font-size:clamp(42px,6vw,76px);line-height:1.02;letter-spacing:-4px;margin:22px 0}h2{font-size:34px;line-height:1.2;letter-spacing:-1px}h3{font-size:21px;line-height:1.3}p{color:#4e6056}.lead{font-size:19px;max-width:530px}.button,button{display:inline-block;border:0;border-radius:6px;background:#214c3b;color:white;padding:14px 20px;font:600 14px Arial;cursor:pointer;text-decoration:none}.sub{font-size:12px;margin-top:16px}.terminal{background:#17382b;color:#edf2dd;padding:26px;border-radius:12px;box-shadow:0 18px 45px #17382b16}.terminal .eyebrow{color:#b3c594}pre{white-space:pre-wrap;word-break:break-word;font:13px/1.8 monospace;max-height:440px;overflow:auto}.terminal p{color:#b8cabc}.terminal button{background:#d7e7b5;color:#193d2e}section{padding:44px 0;border-top:1px solid #ccd3c8}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.card{text-decoration:none;border:1px solid #cdd4c8;border-radius:10px;padding:25px;background:#ffffff70}.card:hover{border-color:#6c8c5a;background:#fff}.price{font-size:12px;font-weight:700;color:#537440}.arrow{font-size:13px;font-weight:bold}.note{background:#e9eddf;padding:22px;border-radius:8px}.flows{display:grid;grid-template-columns:repeat(3,1fr);gap:25px}.flows span{font-size:12px;color:#60774c}footer{font-size:12px;color:#66756c;padding:28px 0 50px;border-top:1px solid #ccd3c8}textarea{width:100%;min-height:120px;background:#fbfcf7;border:1px solid #bdcbb1;border-radius:6px;padding:12px;font-family:monospace}details{margin:20px 0}summary{cursor:pointer}#result{margin-top:20px}#status{font-size:13px;color:#d7e7b5}a:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid #809f59;outline-offset:4px}@media(max-width:740px){.hero{grid-template-columns:1fr;padding:50px 0;gap:28px}h1{letter-spacing:-2px}.grid,.flows{grid-template-columns:1fr}nav{gap:12px}header,main,footer{width:calc(100% - 32px)}}
</style><script nonce="${nonce}" type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script></head><body><header><a class="brand" href="/">XGuard<b>●</b></a><nav><a href="/#capabilities">Outcomes</a><a href="/pricing">Pricing</a><a href="/developers">Developers</a><a href="/try">Try free</a></nav></header><main><div class="hero"><div><div class="eyebrow">PUBLIC SOURCES → USABLE OUTPUT</div><h1>${item ? escape(item.name) : "Three sources.<br>One usable result."}</h1><p class="lead">${escape(description)}</p><a class="button" href="/try">Try extraction free</a><p class="sub">No account. No API key. ${item ? `${escape(item.pricing.amount)} USDC per execution.` : "Pay only when you request live source execution."}</p></div><div class="terminal"><div class="eyebrow">${item ? "ONE REQUEST TO START" : "YOUR FIRST RESULT · FREE"}</div><pre>${escape(code)}</pre><button id="demo">Run free extraction</button><p id="status" role="status" aria-live="polite">The demo runs the real parser on labelled sample HTML.</p><pre id="result" hidden></pre></div></div>${details}<section><h2>Less work between intent and result.</h2><div class="flows"><div><span>01 / DESCRIBE</span><h3>Tell us the outcome.</h3><p>Send pages, product URLs or feeds. For a technology digest, the source set is already provided.</p></div><div><span>02 / AUTHORIZE</span><h3>See the exact price.</h3><p>A paid request returns a signed 402. Your funded x402 client authorizes that request and retries it automatically.</p></div><div><span>03 / USE</span><h3>Get a consistent answer.</h3><p>Receive normalized records, coverage, source digests and a signed receipt. Identical paid retries recover the stored outcome.</p></div></div><p class="note">A signed source digest records what was observed. It does not prove that an article is true, a merchant price is current at checkout, or multiple pages are independent sources.</p></section><section><h2>Bring your agent.</h2><p>REST: <a href="${API}/openapi.json">POST /v1/execute</a> · MCP: <a href="${API}/mcp">xguard_execute</a> · <a href="${API}/.well-known/agent-card.json">A2A skills</a> · <a href="${API}/agent.txt">Short agent instructions</a></p><details><summary>JavaScript and Python examples</summary><pre>${escape(`// JavaScript: free first result\nconst response = await fetch('${API}/v1/execute', {\n  method: 'POST', headers: {'content-type': 'application/json'},\n  body: JSON.stringify({intent: 'demo'})\n});\nconsole.log(await response.json());\n\n# Python: free first result\nimport requests\nprint(requests.post('${API}/v1/execute', json={'intent': 'demo'}).json())`)}</pre></details><p><a href="/install/cursor.json">Cursor</a> · <a href="/install/vscode.json">VS Code</a> · <a href="/install/claude-code.json">Claude Code</a> · <a href="/install/codex.toml">Codex configuration</a></p><p class="sub">Installing an MCP server does not supply a funded wallet. Advanced scoped vendor actions and operator credits remain at <a href="/pricing/operator">operator pricing</a>.</p></section></main><footer>XGuard · <a href="/agent.txt">Agent guide</a> · <a href="/security">Security</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="https://github.com/moelayyan90/XGuard">Source on GitHub</a></footer><script nonce="${nonce}">const button=document.getElementById('demo'),status=document.getElementById('status'),result=document.getElementById('result');button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Extracting sample HTML…';try{const response=await fetch('${API}/v1/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'demo'})});const data=await response.json();if(!response.ok)throw new Error(data.message||data.error||'Request failed');status.textContent='Extraction complete · free · no external source calls';result.hidden=false;result.textContent=JSON.stringify(data,null,2);}catch(error){status.textContent=String(error.message);}finally{button.disabled=false;}});</script></body></html>`;
  return new Response(html, { headers: { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "x-robots-tag": "index, follow",
    "content-security-policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${API}; img-src 'self' data:; form-action 'none'` } });
}

export async function handleOutcomeRoute(request, env, ctx) {
  const url = new URL(request.url);
  const read = ["GET", "HEAD"].includes(request.method);
  if (request.method === "OPTIONS" && ["/v1/execute", "/mcp", "/a2a"].includes(url.pathname)) return new Response(null, { status: 204, headers: cors });
  if (read && url.pathname === "/v1/capabilities") {
    await recordAgentJourney(request, env, "discovery_seen", { surface: "capabilities" });
    return json(catalog(env), 200, { "cache-control": "public, max-age=60" });
  }
  const capMatch = url.pathname.match(/^\/(?:v1\/capabilities|capabilities)\/([^/]+)$/);
  if (read && capMatch) {
    const item = liveOutcomes(env).find(x => x.id === capMatch[1]);
    if (!item) return json({ available: false, error: "capability_unavailable", alternatives: liveOutcomes(env), closest_capabilities: liveOutcomes(env).map(x => x.id), request_capability: `${API}/v1/capabilities` }, 404);
    await recordAgentJourney(request, env, "capability_viewed", { tool: `xguard.${item.id}`, surface: "capability_detail" });
    return url.pathname.startsWith("/v1/") ? json(item, 200, { "cache-control": "public, max-age=60" }) : page(request, env, item);
  }
  if (read && ["/agent.txt", "/llms.txt", "/skill.md"].includes(url.pathname)) return new Response(agentText(env), { headers: { ...cors, "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" } });
  if (read && url.pathname === "/sitemap.xml") return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/try", "/pricing", "/developers", "/connect", "/agent.txt", "/.well-known/mcp/server-card.json", ...liveOutcomes(env).map(x => `/capabilities/${x.id}`)].map(x => `<url><loc>${SITE}${x}</loc></url>`).join("")}</urlset>`, { headers: { ...cors, "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=60" } });
  if (read && url.pathname === "/v1/pricing") return json({ version: "5.1.0", capabilities: liveOutcomes(env).map(x => ({ id: x.id, ...x.pricing })), execution_url: `${API}/v1/execute`, quote_optional: `${API}/v1/pricing/quote`, payment: "x402-v2", first_result: { intent: "demo" } });
  if (read && url.hostname !== "api.xguardgate.com" && ["/", "/try", "/pricing", "/developers", "/connect"].includes(url.pathname)) {
    await recordAgentJourney(request, env, "discovery_seen", { surface: "public_page" }); return page(request, env);
  }
  if (request.method === "POST" && ["/v1/execute", "/v1/pricing/quote"].includes(url.pathname)) {
    const parsed = await jsonBody(request.clone());
    if (parsed.error) return json({ ok: false, error: parsed.error, message: "Send bounded valid JSON.", repair: { suggested_request: { intent: "demo" } } }, parsed.error === "payload_too_large" ? 413 : 400);
    if (url.pathname === "/v1/pricing/quote" && !parsed.value?.intent && !parsed.value?.capability) return null;
    return execute(request, env, parsed.value, "http", url.pathname.endsWith("quote"));
  }
  const resultMatch = url.pathname.match(/^\/v1\/results\/([^/]+)$/);
  if (read && resultMatch) return recoverOutcome(env, resultMatch[1], request.headers.get("x-xguard-quote"), `xgr_${crypto.randomUUID().replaceAll("-", "")}`);
  if (read && ["/mcp", "/.well-known/mcp/server-card.json", "/.well-known/xguard-tools.json"].includes(url.pathname)) return json({ name: "XGuard Universal Paid AI Agent + Secretless Gateway", version: "5.1.0",
    serverInfo: { name: "XGuard Universal Paid AI Agent + Secretless Gateway", version: "5.1.0" }, authentication: { required: false, schemes: [] },
    execution_chokepoint: { tool: "xguard_execute", url: `${API}/v1/execute`, settlement_before_execution: true, free_preview: "extract-preview" },
    endpoint: `${API}/mcp`, transport: "streamable-http", tools: mcpTools(env), instructions, resources: [], prompts: [], capabilities: liveOutcomes(env) });
  if (request.method === "POST" && url.pathname === "/mcp") {
    const parsed = await jsonBody(request.clone(), 32768);
    if (parsed.error) return json({ jsonrpc: "2.0", id: null, error: { code: parsed.error === "invalid_json" ? -32700 : -32600, message: parsed.error } }, 400);
    const message = parsed.value;
    const invalid = validateMcpRequest(request, message); if (invalid) return invalid;
    if (message.method === "tools/list") {
      await recordAgentJourney(request, env, "discovery_seen", { transport: "mcp", surface: "tools_list" });
      return mcpTransportResponse(json({ jsonrpc: "2.0", id: message.id ?? null, result: { tools: mcpTools(env), resultType: "complete", ttlMs: 60000, cacheScope: "public" } }), message);
    }
    if (message.method === "tools/call") {
      if (message.params?.name === "xguard_execute") return mcpResult(message, await execute(request, env, message.params.arguments, "mcp"));
      if (message.params?.name === "xguard_discover") return mcpResult(message, json(catalog(env)));
      if (message.params?.name === "xguard_get_result") return mcpResult(message, await recoverOutcome(env, message.params.arguments?.payment_identifier, message.params.arguments?.quote, `xgr_${crypto.randomUUID().replaceAll("-", "")}`));
    }
  }
  if (request.method === "POST" && url.pathname === "/a2a") {
    const parsed = await jsonBody(request.clone(), 32768);
    if (parsed.error) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: parsed.error } }, 400);
    const message = parsed.value;
    if (message?.method !== "SendMessage") return null;
    if (request.headers.get("a2a-version") && !["1.0", "1.0.0"].includes(request.headers.get("a2a-version"))) return null;
    const incoming = message.params?.message;
    if (message.jsonrpc !== "2.0" || !["string", "number"].includes(typeof message.id) || incoming?.role !== "ROLE_USER" || !incoming.messageId || !Array.isArray(incoming.parts) || incoming.parts.length !== 1) return json({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32602, message: "Send one ROLE_USER message part with messageId." } }, 400);
    let raw = incoming.parts[0].data ?? incoming.parts[0].text;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch {} }
    if (raw?.action && !["xguard_execute", "execute", ...outcomeDefinitions().map(x => x.id)].includes(raw.action) && !raw.intent) return null;
    const response = await execute(request, env, raw, "a2a");
    const value = await response.json();
    return json({ jsonrpc: "2.0", id: message.id, result: { message: { messageId: crypto.randomUUID(), role: "ROLE_AGENT", parts: [{ data: value }] }, status: response.status === 402 ? "INPUT_REQUIRED" : response.ok ? "COMPLETED" : "FAILED" } }, response.status, { ...Object.fromEntries(response.headers), "a2a-version": "1.0.0" });
  }
  return null;
}

export async function decorateOutcomeResponse(request, response, env) {
  const path = new URL(request.url).pathname;
  if (!response.ok || request.method === "HEAD" || !["/", "/openapi.json", "/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a", "/mcp", "/.well-known/ai-plugin.json", "/.well-known/payment-manifest"].includes(path) || !(response.headers.get("content-type") || "").includes("json")) return response;
  const body = await response.json();
  if (path === "/" && body.discovery) { body.description = "Normalized page evidence, product offers and feed digests from public sources, in one intent call."; Object.assign(body, { first_result: catalog(env).first_result, execution_url: `${API}/v1/execute` }); Object.assign(body.discovery, { agent_instructions: `${API}/agent.txt`, capabilities: `${API}/v1/capabilities` }); }
  if (path === "/mcp" && body.result) body.result.instructions = instructions;
  if (path === "/.well-known/payment-manifest") {
    body.primary_execution = `${API}/v1/execute`;
    body.resources = [...liveOutcomes(env).filter(x => x.pricing.amount_atomic !== "0").map(x => ({
      tool: `xguard.${x.id}`, capability: x.id, resource: `${API}/v1/execute`, method: "POST", price_atomic: x.pricing.amount_atomic,
      currency: "USDC", network: "eip155:8453", payment_identifier_required: true, settlement_before_execution: true,
      first_call_creates_quote: true, quote_optional: true, will_return: x.pricing.delivered,
    })), ...(body.resources || []).map(x => ({ ...x, compatibility: true }))];
  }
  const card = path === "/a2a" ? body.agent_card : ["/.well-known/agent-card.json", "/.well-known/agent.json"].includes(path) ? body : null;
  if (card) {
    card.description = "Execute public-source outcomes: multi-page extraction, structured product offers, and deduplicated feed digests. Free extraction preview; exact x402 price before live execution.";
    card.skills = liveOutcomes(env).map(x => ({ id: x.id, name: x.name, description: x.description, tags: [x.id, "execution", "public-sources"], examples: [JSON.stringify(x.example)], inputModes: ["application/json", "text/plain"], outputModes: ["application/json"] }));
    card.capabilities ||= {}; card.capabilities.extensions = [{ uri: `${API}/.well-known/payment-manifest`, description: "x402 v2 paid outcome execution", required: false, params: { direct_execution: `${API}/v1/execute`, quote_optional: true, challenge_status: 402, challenge_header: "Payment-Required", quote_header: "X-XGuard-Quote", retry_header: "Payment-Signature", settlement_before_execution: true } }];
  }
  if (path === "/.well-known/ai-plugin.json") { body.description_for_human = "One call for normalized page evidence, structured product offers or a deduplicated feed digest."; body.description_for_model = instructions; }
  if (path === "/openapi.json") {
    body.openapi = "3.1.0";
    body.info.description = "Describe a supported outcome. Receive normalized results or an exact x402 price, then authorize and retry the same request. Start with intent:demo for free.";
    body.tags = [{ name: "Outcomes", description: "Primary intent execution" }, ...(body.tags || []).filter(x => x.name !== "Outcomes")];
    const responses = { "200": { description: "Normalized outcome with integrity metadata and receipt", content: { "application/json": { schema: RESULT_SCHEMA } } }, "402": { description: "Exact x402 payment requirement; preserve X-XGuard-Quote and retry identical input with Payment-Signature", headers: { "Payment-Required": { schema: { type: "string" } }, "X-XGuard-Quote": { schema: { type: "string" } } } }, "403": { description: "Unsafe target or recovery credential" }, "422": { description: "Self-describing repair.suggested_request" }, "429": { description: "Rate limit" }, "502": { description: "No usable source; execution credit retained" }, "503": { description: "Payment unavailable or settlement awaiting reconciliation" } };
    body.paths = { "/v1/execute": { post: { operationId: "xguardExecute", tags: ["Outcomes"], summary: "Execute a public-source outcome", security: [], requestBody: { required: true, content: { "application/json": { schema: EXECUTE_SCHEMA, example: { intent: "demo" } } } }, parameters: ["X-XGuard-Quote", "Payment-Signature", "X-XGuard-Credit"].map(name => ({ name, in: "header", required: false, schema: { type: "string" } })), responses } }, ...body.paths };
    body.paths["/v1/capabilities"] = { get: { tags: ["Outcomes"], summary: "List executable outcomes and exact pricing", responses: { "200": { description: "Capabilities with input/output schemas and examples" } } } };
    body.paths["/v1/capabilities/{id}"] = { get: { tags: ["Outcomes"], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Executable capability" }, "404": { description: "Unavailable with alternatives" } } } };
    body.paths["/v1/results/{payment_identifier}"] = { get: { tags: ["Outcomes"], parameters: [{ in: "path", name: "payment_identifier", required: true, schema: { type: "string" } }, { in: "header", name: "X-XGuard-Quote", required: true, schema: { type: "string" } }], responses: { "200": responses["200"], "202": { description: "Pending or credited operation; no reexecution" }, "403": responses["403"], "404": { description: "Unknown operation" } } } };
    body.paths["/v1/pricing"] = { get: { tags: ["Outcomes"], responses: { "200": { description: "Exact per-execution outcome pricing" } } } };
    body.paths["/v1/pricing/quote"].post.requestBody.content["application/json"].schema = { anyOf: [EXECUTE_SCHEMA, body.paths["/v1/pricing/quote"].post.requestBody.content["application/json"].schema] };
  }
  const h = new Headers(response.headers); h.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, headers: h });
}
