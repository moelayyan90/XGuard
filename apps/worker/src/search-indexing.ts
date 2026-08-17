const XGUARD_VERSION = "0.4.0";
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

export function searchIndexResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const origin = url.origin;

  if (url.pathname === "/") {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      return typedResponse(request, landingPage(origin), "text/html; charset=utf-8");
    }
    return jsonResponse(request, rootMetadata(origin));
  }

  if (url.pathname === "/docs" || url.pathname === "/quickstart") {
    return typedResponse(request, docsPage(origin), "text/html; charset=utf-8");
  }

  if (url.pathname === "/sitemap.xml") {
    return typedResponse(request, sitemap(origin), "application/xml; charset=utf-8");
  }

  if (url.pathname === "/robots.txt") {
    return typedResponse(request, robots(origin), "text/plain; charset=utf-8");
  }

  return null;
}

function rootMetadata(origin: string): Record<string, unknown> {
  return {
    name: "XGuard",
    title: "XGuard — x402 Economic Firewall & Facilitator Safety Gateway",
    version: XGUARD_VERSION,
    protocol: "x402-v2",
    mode: "mainnet",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    price: {
      amount: "0.002",
      currency: "USD",
      event: "successful_billable_settlement",
      model: "merchant_prepaid_service_balance",
    },
    endpoints: {
      docs: "/docs",
      register: "/v1/register",
      balance: "/v1/balance",
      topUpIntent: "/v1/topups/intents",
      topUpClaim: "/v1/topups/claim",
      supported: "/supported",
      verify: "/verify",
      settle: "/settle",
      status: "/status",
    },
    discovery: {
      provider: `${origin}/.well-known/x402/facilitator.json`,
      agentCard: `${origin}/.well-known/agent-card.json`,
      agentMarket: `${origin}/.well-known/agent-market.json`,
      mcp: `${origin}/mcp`,
      mcpManifest: `${origin}/.well-known/mcp/server.json`,
      bazaarResources: `${origin}/discovery/resources`,
      bazaarSearch: `${origin}/discovery/search`,
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
      llmsFull: `${origin}/llms-full.txt`,
      sitemap: `${origin}/sitemap.xml`,
    },
    repository: "https://github.com/moelayyan90/XGuard",
  };
}

function landingPage(origin: string): string {
  const title = "XGuard — x402 Economic Firewall";
  const description =
    "Hosted x402 v2 settlement-safety gateway for Base mainnet USDC with replay protection, finality verification, settlement truth and machine discovery.";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "XGuard",
    applicationCategory: "DeveloperApplication",
    softwareVersion: XGUARD_VERSION,
    operatingSystem: "Web",
    description,
    url: origin,
    codeRepository: "https://github.com/moelayyan90/XGuard",
    offers: {
      "@type": "Offer",
      price: "0.002",
      priceCurrency: "USD",
      description: "Per successful billable settlement; no subscription.",
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07090d">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate" type="application/json" href="${origin}/.well-known/x402/facilitator.json" title="XGuard x402 provider metadata">
  <script type="application/ld+json">${jsonLd}</script>
  ${styles()}
</head>
<body>
  <header class="topbar">
    <nav class="shell nav">
      <a class="brand" href="/"><img src="/favicon.svg" width="34" height="34" alt=""><b>XGUARD</b></a>
      <div class="navlinks"><a href="#how">How it works</a><a href="/docs">Docs</a><a href="/status">Status</a><a href="/openapi.json">OpenAPI</a><a class="pill" href="#start">Get API key</a></div>
    </nav>
  </header>

  <main>
    <section class="shell hero">
      <div class="eyebrow"><i></i> LIVE · BASE MAINNET · x402 v2</div>
      <h1>Stop unsafe settlements<br><span>before money moves.</span></h1>
      <p>${escapeHtml(description)} XGuard stays on the payment path so your application can keep speaking standard x402 while the gateway enforces economic safety.</p>
      <div class="actions"><a class="button primary" href="#start">Start in minutes</a><a class="button secondary" href="/docs">Read the docs</a></div>
      <div class="metrics"><div><strong>$0.002</strong><small>successful settlement</small></div><div><strong>$0</strong><small>failed / malformed</small></div><div><strong>Base</strong><small>mainnet USDC</small></div><div><strong>No subscription</strong><small>prepaid usage balance</small></div></div>
    </section>

    <section class="ticker"><div class="shell ticker-grid"><span>REPLAY PROTECTION</span><span>FINALITY VERIFICATION</span><span>SETTLEMENT TRUTH</span><span>MCP DISCOVERY</span><span>BAZAAR DISCOVERY</span></div></section>

    <section id="how" class="shell section">
      <div class="heading"><label>HOW IT WORKS</label><h2>One guarded path between intent and settlement.</h2><p>Your application sends the canonical x402 v2 envelope. XGuard protects the execution path and records billable usage only when the operation earns it.</p></div>
      <div class="flow"><article><em>01</em><h3>Your app</h3><p>Creates the normal x402 payment payload and requirements.</p></article><b>→</b><article class="hot"><em>02</em><h3>XGuard</h3><p>Checks replay state, identity, health, concurrency and settlement truth.</p></article><b>→</b><article><em>03</em><h3>Settlement</h3><p>Routes execution and verifies the result before final accounting.</p></article></div>
    </section>

    <section id="start" class="shell section start">
      <div><label>GET STARTED</label><h2>Create a live API key.</h2><p class="muted">Registration calls the same production XGuard API that developers will use. This page does not persist the returned credential.</p>
        <div class="register"><span>Application / merchant name</span><div class="inputrow"><input id="merchant-name" maxlength="80" autocomplete="off" placeholder="my-x402-app"><button id="register-button" type="button">Create API key</button></div><pre id="register-output">Your API key will appear here.</pre><small>Store the key immediately. XGuard stores only its hash.</small></div>
      </div>
      <div class="quick"><div class="quick-head"><b>Quick start</b><a href="/docs">Full docs →</a></div><ol><li><b>1</b> Create API key</li><li><b>2</b> Fund prepaid service balance</li><li><b>3</b> Send verify / settle traffic</li></ol><pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-x402-app"}'</code></pre><a class="more" href="/docs#settle">Continue to settlement example →</a></div>
    </section>

    <section class="shell section"><div class="heading"><label>DEVELOPER SURFACE</label><h2>Human-ready and machine-discoverable.</h2></div><div class="cards">
      <a href="/docs"><mark>DOC</mark><h3>Developer Docs</h3><p>Registration, funding, authentication and x402 request examples.</p></a>
      <a href="/openapi.json"><mark>API</mark><h3>OpenAPI 3.1</h3><p>Machine-readable API contract for tooling and SDK generation.</p></a>
      <a href="/.well-known/mcp/server.json"><mark>MCP</mark><h3>MCP Server</h3><p>Remote MCP discovery metadata and tool interface.</p></a>
      <a href="/.well-known/x402/facilitator.json"><mark>402</mark><h3>x402 Manifest</h3><p>Canonical facilitator discovery metadata for integrations.</p></a>
      <a href="/discovery/resources"><mark>BZR</mark><h3>Bazaar</h3><p>Discover paid HTTP APIs and MCP resources cataloged by XGuard.</p></a>
      <a href="/status"><mark>LIVE</mark><h3>Status</h3><p>Current gateway, facilitator, settlement and accounting status.</p></a>
    </div></section>

    <section class="shell section pricing"><div><label>PRICING</label><h2>Pay when XGuard delivers value.</h2><p class="muted">No monthly plan is required for the settlement safety path.</p></div><div class="price"><strong><sup>$</sup>0.002</strong><p>per successful billable settlement</p><ul><li>Failed settlement: $0</li><li>Malformed request: $0</li><li>Duplicate / replayed charge: $0</li><li>Prepaid service balance</li></ul><a class="button primary full" href="#start">Create API key</a></div></section>
  </main>

  <footer><div class="shell footer"><a class="brand" href="/"><img src="/favicon.svg" width="30" height="30" alt=""><b>XGUARD</b></a><span>Economic safety infrastructure for x402.</span><div><a href="/docs">Docs</a><a href="/status">Status</a><a href="/llms.txt">LLMs</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div></div></footer>

  <script>
  (function(){
    var button=document.getElementById('register-button');
    var input=document.getElementById('merchant-name');
    var output=document.getElementById('register-output');
    if(!button||!input||!output)return;
    button.addEventListener('click',async function(){
      var name=input.value.trim();
      if(!name){output.textContent='Enter an application or merchant name first.';return;}
      button.disabled=true;button.textContent='Creating…';output.textContent='Creating live XGuard credentials…';
      try{
        var response=await fetch('/v1/register',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({name:name})});
        var data=await response.json();
        if(!response.ok)throw new Error(data.error||data.message||('HTTP '+response.status));
        output.textContent=JSON.stringify({apiKey:data.apiKey,merchant:data.merchant,treasury:data.treasury,warning:data.warning},null,2);
      }catch(error){output.textContent='Registration failed: '+(error&&error.message?error.message:'unknown error');}
      finally{button.disabled=false;button.textContent='Create API key';}
    });
  })();
  </script>
</body>
</html>`;
}

function docsPage(origin: string): string {
  const title = "XGuard Docs — Quick Start";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07090d"><title>${escapeHtml(title)}</title><meta name="description" content="Integrate XGuard with an x402 v2 application on Base mainnet."><link rel="canonical" href="${origin}/docs"><link rel="icon" type="image/svg+xml" href="/favicon.svg">${styles()}</head>
<body><header class="topbar"><nav class="shell nav"><a class="brand" href="/"><img src="/favicon.svg" width="34" height="34" alt=""><b>XGUARD</b></a><div class="navlinks"><a href="/">Home</a><a href="/status">Status</a><a href="/openapi.json">OpenAPI</a><a href="/.well-known/mcp/server.json">MCP</a></div></nav></header>
<main class="shell docs"><aside><label>QUICK START</label><a href="#register">1. Register</a><a href="#balance">2. Check balance</a><a href="#topup">3. Fund balance</a><a href="#verify">4. Verify</a><a href="#settle">5. Settle</a><label>REFERENCE</label><a href="/openapi.json">OpenAPI</a><a href="/supported">Supported</a><a href="/.well-known/x402/facilitator.json">x402 manifest</a><a href="/.well-known/mcp/server.json">MCP manifest</a></aside>
<article class="docbody"><div class="eyebrow"><i></i> XGUARD ${XGUARD_VERSION} · MAINNET</div><h1>Integrate XGuard</h1><p class="lead">Base URL: <code>${origin}</code>. Use the live API key returned during registration as a Bearer token.</p>
<section id="register"><label>STEP 1</label><h2>Register your application</h2><p>Create a merchant identity and receive the API key once.</p><pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-x402-app"}'</code></pre><p>The response contains <code>apiKey</code>, merchant metadata and the XGuard treasury address. Store the key immediately.</p></section>
<section id="balance"><label>STEP 2</label><h2>Check service balance</h2><pre><code>curl ${origin}/v1/balance \\
  -H 'authorization: Bearer xg_live_YOUR_KEY'</code></pre></section>
<section id="topup"><label>STEP 3</label><h2>Fund the prepaid service balance</h2><p>Create a top-up intent. The response tells you the exact native USDC amount on Base, treasury address, expiry and claim token. After sending that exact amount, claim it with the transaction hash.</p><pre><code>curl -X POST ${origin}/v1/topups/intents \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"amountUsd":"1.00"}'</code></pre><pre><code>curl -X POST ${origin}/v1/topups/claim \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"claimToken":"TOKEN_FROM_INTENT","transactionHash":"0x..."}'</code></pre></section>
<section id="verify"><label>STEP 4</label><h2>Verify an x402 v2 payment</h2><p>Send the canonical x402 v2 facilitator envelope.</p><pre><code>curl -X POST ${origin}/verify \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre></section>
<section id="settle"><label>STEP 5</label><h2>Settle through XGuard</h2><p>Use the same canonical x402 v2 envelope. XGuard adds replay protection, concurrency protection, routed execution, finality handling and settlement truth metadata.</p><pre><code>curl -X POST ${origin}/settle \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre><div class="note"><b>Settlement fee:</b> $0.002 for a successful billable settlement. Failed, malformed and duplicate traffic is not earned settlement revenue.</div></section>
<section><label>DISCOVERY</label><h2>Machine integration</h2><div class="endpoints"><a href="/.well-known/x402/facilitator.json"><b>x402 facilitator manifest</b><code>/.well-known/x402/facilitator.json</code></a><a href="/.well-known/agent-card.json"><b>Agent Card</b><code>/.well-known/agent-card.json</code></a><a href="/.well-known/mcp/server.json"><b>MCP server metadata</b><code>/.well-known/mcp/server.json</code></a><a href="/openapi.json"><b>OpenAPI</b><code>/openapi.json</code></a><a href="/discovery/resources"><b>Bazaar resources</b><code>/discovery/resources</code></a></div></section>
</article></main><footer><div class="shell footer"><a class="brand" href="/"><img src="/favicon.svg" width="30" height="30" alt=""><b>XGUARD</b></a><span>Economic safety infrastructure for x402.</span><div><a href="/">Home</a><a href="/status">Status</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div></div></footer></body></html>`;
}

function styles(): string {
  return `<style>
  :root{color-scheme:dark;--bg:#07090d;--panel:#0c1117;--line:#202936;--text:#f5f7fa;--muted:#98a5b5;--red:#ff2633;--green:#39d98a;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--sans:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -10%,rgba(255,38,51,.11),transparent 34%),var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.topbar{position:sticky;top:0;z-index:20;background:rgba(7,9,13,.86);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.06)}.nav{height:72px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;letter-spacing:.08em}.brand img{border-radius:8px}.navlinks{display:flex;gap:24px;align-items:center}.navlinks a,.footer a{font-size:14px;color:#b7c0cd;text-decoration:none}.navlinks a:hover,.footer a:hover{color:#fff}.navlinks .pill{padding:8px 12px;border:1px solid #394554;border-radius:8px;color:#fff}.hero{text-align:center;padding:105px 0 75px}.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid #27303c;border-radius:999px;background:#0c1016;font-size:11px;font-weight:800;letter-spacing:.14em}.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 14px var(--green)}.hero h1{font-size:clamp(50px,7vw,88px);line-height:.98;letter-spacing:-.055em;margin:28px 0}.hero h1 span{color:var(--red)}.hero>p{max-width:790px;margin:0 auto;color:#a8b3c1;font-size:18px}.actions{display:flex;justify-content:center;gap:12px;margin:34px 0 54px}.button{display:inline-flex;justify-content:center;align-items:center;padding:12px 18px;border-radius:9px;text-decoration:none;font-size:14px;font-weight:800}.primary{background:var(--red);color:#fff}.secondary{border:1px solid #2d3846;background:#10151d;color:#fff}.full{width:100%}.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:rgba(13,17,23,.7)}.metrics div{padding:22px;border-right:1px solid var(--line)}.metrics div:last-child{border:0}.metrics strong,.metrics small{display:block}.metrics small{color:var(--muted);font-size:11px;margin-top:4px}.ticker{border-block:1px solid #171f29;background:#090d12}.ticker-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:15px 0;text-align:center;font-size:10px;letter-spacing:.13em;color:#667283}.section{padding:90px 0}.heading{max-width:760px;margin-bottom:40px}label,.heading label,.start>div>label,.pricing>div>label,.docbody section label{font-size:11px;font-weight:900;letter-spacing:.16em;color:#b7c0cd}.heading h2,.start h2,.pricing h2,.docbody>h1{font-size:clamp(35px,4vw,54px);line-height:1.08;letter-spacing:-.035em;margin:10px 0 15px}.heading p,.muted,.lead{color:var(--muted)}.flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:14px}.flow article{min-height:200px;border:1px solid var(--line);border-radius:13px;background:#0b1016;padding:26px}.flow article.hot{border-color:#66262b}.flow em{font:normal 12px var(--mono);color:var(--red)}.flow h3{margin:20px 0 8px}.flow p{color:var(--muted);font-size:14px}.flow>b{color:#465260}.start{display:grid;grid-template-columns:1fr 1fr;gap:55px}.register,.quick,.price{border:1px solid var(--line);border-radius:14px;background:linear-gradient(#0e131a,#090d12)}.register{padding:23px;margin-top:24px}.register>span{font-size:12px;font-weight:800}.inputrow{display:flex;gap:8px;margin-top:9px}.inputrow input{flex:1;min-width:0;background:#070a0f;color:#fff;border:1px solid #2a3442;border-radius:8px;padding:12px}.inputrow button{background:var(--red);border:0;border-radius:8px;color:#fff;font-weight:800;padding:0 15px;cursor:pointer}.inputrow button:disabled{opacity:.6}.register pre,.quick pre,.docbody pre{white-space:pre;overflow:auto;background:#06090d;border:1px solid #1c2530;border-radius:8px;padding:14px;color:#d7e0ea;font:12px/1.6 var(--mono)}.register small{color:#6f7c8d}.quick{overflow:hidden}.quick-head{display:flex;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--line);font-size:12px}.quick-head a,.more{color:#bbc6d4;text-decoration:none}.quick ol{list-style:none;padding:18px;margin:0}.quick li{margin:10px 0;color:#c7d0db}.quick li b{display:inline-grid;place-items:center;width:23px;height:23px;margin-right:8px;border-radius:50%;background:#151c25;font-size:10px}.quick pre{margin:0 18px 16px}.more{display:block;padding:0 18px 18px;font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.cards>a{color:inherit;text-decoration:none;border:1px solid var(--line);border-radius:12px;background:#0b1016;padding:22px}.cards>a:hover{border-color:#3b4858}.cards mark{background:#180d10;color:var(--red);border:1px solid #3b2227;border-radius:6px;padding:5px 7px;font:800 10px var(--mono)}.cards h3{margin:18px 0 6px}.cards p{color:var(--muted);font-size:13px;margin:0}.pricing{display:grid;grid-template-columns:1fr 410px;gap:60px;align-items:center}.price{padding:30px}.price>strong{font-size:62px;letter-spacing:-.05em}.price sup{font-size:22px;color:var(--red)}.price>p{color:var(--muted)}.price ul{list-style:none;padding:0;margin:24px 0}.price li{padding:9px 0;border-top:1px solid #1d2631;font-size:13px}.price li:before{content:"✓";color:var(--green);margin-right:8px}footer{border-top:1px solid #171f29;padding:28px 0}.footer{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center}.footer>span{text-align:center;color:#697586;font-size:12px}.footer>div{display:flex;justify-content:flex-end;gap:17px}.docs{display:grid;grid-template-columns:210px minmax(0,780px);gap:70px;padding:70px 0 100px}.docs aside{position:sticky;top:105px;height:max-content;display:flex;flex-direction:column;gap:8px}.docs aside label{margin-top:12px;color:#5e6a79}.docs aside a{color:#97a3b2;text-decoration:none;font-size:13px}.docbody>h1{font-size:54px;margin:20px 0 10px}.docbody section{padding:50px 0;border-top:1px solid #1a232d}.docbody section:first-of-type{margin-top:40px}.docbody section h2{font-size:29px;margin:8px 0 10px}.docbody section p{color:#a3aebb}.docbody code{font-family:var(--mono)}.note{border-left:3px solid var(--red);background:#0d1218;padding:15px 17px;color:#b7c1cd;font-size:13px}.endpoints{display:grid;gap:8px}.endpoints a{display:flex;justify-content:space-between;gap:20px;padding:14px 15px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:#dce3eb;background:#0a0f15}.endpoints code{color:#728095;font-size:11px}@media(max-width:900px){.navlinks a:not(.pill){display:none}.metrics{grid-template-columns:1fr 1fr}.ticker-grid{grid-template-columns:1fr 1fr}.flow{grid-template-columns:1fr}.flow>b{transform:rotate(90deg);text-align:center}.start,.pricing{grid-template-columns:1fr}.cards{grid-template-columns:1fr 1fr}.docs{grid-template-columns:1fr}.docs aside{display:none}}@media(max-width:620px){.shell{width:min(100% - 24px,1180px)}.nav{height:64px}.hero{padding-top:70px}.hero h1{font-size:48px}.actions{flex-direction:column}.metrics,.ticker-grid,.cards{grid-template-columns:1fr}.inputrow{flex-direction:column}.inputrow button{padding:12px}.footer{grid-template-columns:1fr;gap:16px;text-align:center}.footer>div{justify-content:center}.endpoints a{flex-direction:column;gap:4px}}
  </style>`;
}

function sitemap(origin: string): string {
  const paths = ["/", "/docs", "/.well-known/x402/facilitator.json", "/.well-known/agent-card.json", "/.well-known/agent-market.json", "/.well-known/mcp/server.json", "/discovery/resources", "/openapi.json", "/llms.txt", "/llms-full.txt"];
  const urls = paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function robots(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n\n# Developer entrypoint\n# ${origin}/docs\n# ${origin}/openapi.json\n\n# Machine-readable discovery\n# ${origin}/.well-known/x402/facilitator.json\n# ${origin}/.well-known/agent-card.json\n# ${origin}/.well-known/agent-market.json\n# ${origin}/.well-known/mcp/server.json\n# ${origin}/mcp\n# ${origin}/discovery/resources\n# ${origin}/discovery/search?query=x402\n# ${origin}/llms.txt\n# ${origin}/llms-full.txt\n`;
}

function jsonResponse(request: Request, value: unknown): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value, null, 2), { status: 200, headers: publicHeaders("application/json; charset=utf-8") });
}

function typedResponse(request: Request, value: string, contentType: string): Response {
  return new Response(request.method === "HEAD" ? null : value, { status: 200, headers: publicHeaders(contentType) });
}

function publicHeaders(contentType: string): Headers {
  return new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": CACHE_CONTROL, "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", "&apos;");
}
