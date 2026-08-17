const PORTAL_VERSION = "0.5.0";
const PORTAL_CACHE = "public, max-age=300, stale-while-revalidate=3600";

export function portalDesignResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const origin = url.origin;

  if (url.pathname === "/") {
    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("text/html")) return null;
    return htmlResponse(request, landingPage(origin));
  }

  if (url.pathname === "/docs" || url.pathname === "/quickstart") {
    return htmlResponse(request, docsPage(origin));
  }

  return null;
}

function htmlResponse(request: Request, html: string): Response {
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Cache-Control": PORTAL_CACHE,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

function landingPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f7f7f5">
  <title>XGuard — Safe payment execution</title>
  <meta name="description" content="A simple safety layer for payment execution: replay protection, finality checks, settlement truth and machine discovery.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Primary navigation">
      <a class="brand" href="/" aria-label="XGuard home"><img src="/favicon.svg" width="30" height="30" alt=""><span>XGuard</span></a>
      <div class="nav-links">
        <a href="#how">How it works</a>
        <a href="/docs">Docs</a>
        <a href="/status">Status</a>
        <a href="https://github.com/moelayyan90/XGuard">GitHub</a>
        <a class="nav-cta" href="#start">Get API key</a>
      </div>
    </nav>
  </header>

  <main>
    <section class="wrap hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="live-dot"></span>Live on Base mainnet</div>
        <h1>Safe payment execution,<br>without the extra complexity.</h1>
        <p class="hero-lead">XGuard adds a clear safety boundary around payment verification and settlement. Your app keeps its normal flow; XGuard handles replay control, finality and settlement truth.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#start">Create an API key</a>
          <a class="button button-secondary" href="/docs">Read the docs</a>
        </div>
        <p class="hero-note">No monthly plan. Prepaid usage. One key to get started.</p>
      </div>

      <aside class="summary-card" aria-label="XGuard summary">
        <div class="summary-head">
          <div><span class="summary-label">XGuard</span><strong>Production</strong></div>
          <span class="live-pill"><i></i>Operational</span>
        </div>
        <dl class="summary-list">
          <div><dt>Protocol</dt><dd>x402 v2</dd></div>
          <div><dt>Network</dt><dd>Base</dd></div>
          <div><dt>Asset</dt><dd>USDC</dd></div>
          <div><dt>Attempt fee</dt><dd>$0.04</dd></div>
        </dl>
        <a class="summary-link" href="/status">View live status <span>→</span></a>
      </aside>
    </section>

    <section id="how" class="wrap section">
      <div class="section-heading">
        <p class="kicker">How it works</p>
        <h2>Three steps. Nothing hidden.</h2>
        <p>XGuard is designed to sit in the path without making the payment path harder to understand.</p>
      </div>

      <div class="steps">
        <article class="step"><span class="step-number">1</span><h3>Send the normal request</h3><p>Your application sends its standard x402 v2 payment payload and requirements.</p></article>
        <article class="step"><span class="step-number">2</span><h3>XGuard checks the risky parts</h3><p>Replay state, merchant identity, concurrency, route health, finality and settlement truth are checked.</p></article>
        <article class="step"><span class="step-number">3</span><h3>Receive a clear outcome</h3><p>The execution result comes back with the safety and settlement metadata your application needs.</p></article>
      </div>
    </section>

    <section id="start" class="soft-section">
      <div class="wrap start-grid">
        <div class="start-copy">
          <p class="kicker">Start</p>
          <h2>Create your production API key.</h2>
          <p>Give the application a name. The live key is shown once and this page does not persist it.</p>
          <div class="register-box">
            <label for="merchant-name">Application or merchant name</label>
            <div class="input-row"><input id="merchant-name" maxlength="80" autocomplete="off" placeholder="my-payment-app"><button id="register-button" type="button">Create key</button></div>
            <pre id="register-output">Your API key will appear here.</pre>
            <small>Store the key immediately. XGuard stores only its hash.</small>
          </div>
        </div>

        <aside class="quick-card">
          <p class="card-kicker">Quick start</p>
          <ol>
            <li><span>1</span><p><b>Create a key</b>Register your application above.</p></li>
            <li><span>2</span><p><b>Fund usage</b>Add prepaid USDC service balance.</p></li>
            <li><span>3</span><p><b>Send traffic</b>Use the key for verify and settle requests.</p></li>
          </ol>
          <pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-payment-app"}'</code></pre>
          <a href="/docs">Open the full integration guide →</a>
        </aside>
      </div>
    </section>

    <section class="wrap section resources-section">
      <div class="section-heading compact"><p class="kicker">Developer access</p><h2>The useful links, in one place.</h2></div>
      <div class="resource-grid">
        ${resourceCard("Docs", "Integration guide", "Registration, funding, authentication and settlement examples.", "/docs")}
        ${resourceCard("API", "OpenAPI 3.1", "Machine-readable API contract for clients and tooling.", "/openapi.json")}
        ${resourceCard("MCP", "MCP server", "Remote MCP discovery metadata and the XGuard tool surface.", "/.well-known/mcp/server.json")}
        ${resourceCard("x402", "Facilitator manifest", "Canonical discovery metadata for x402 integrations.", "/.well-known/x402/facilitator.json")}
        ${resourceCard("Discover", "Bazaar resources", "Paid HTTP APIs and MCP resources cataloged by XGuard.", "/discovery/resources")}
        ${resourceCard("Live", "Runtime status", "Current gateway, facilitator and settlement state.", "/status")}
      </div>
    </section>

    <section class="wrap pricing">
      <div><p class="kicker">Pricing</p><h2>Simple usage pricing.</h2><p class="pricing-copy">The production payment path uses a fixed <strong>$0.04 attempt fee</strong> once an authenticated, parseable economic request is accepted. Idempotent retries do not add another attempt fee.</p></div>
      <div class="price-card"><span>Accepted economic attempt</span><strong>$0.04</strong><p>Prepaid usage · no monthly subscription</p><a class="button button-primary" href="#start">Create an API key</a></div>
    </section>
  </main>

  <footer><div class="wrap footer-grid"><a class="brand" href="/"><img src="/favicon.svg" width="26" height="26" alt=""><span>XGuard</span></a><p>Safe payment execution infrastructure.</p><div><a href="/docs">Docs</a><a href="/status">Status</a><a href="/llms.txt">LLMs</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div></div></footer>
  ${registrationScript()}
</body>
</html>`;
}

function docsPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f7f7f5">
  <title>XGuard Docs — Quick Start</title>
  <meta name="description" content="Integrate XGuard with an x402 v2 application on Base mainnet.">
  <link rel="canonical" href="${origin}/docs">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header"><nav class="wrap nav" aria-label="Primary navigation"><a class="brand" href="/"><img src="/favicon.svg" width="30" height="30" alt=""><span>XGuard</span></a><div class="nav-links"><a href="/">Home</a><a href="/status">Status</a><a href="/openapi.json">OpenAPI</a><a href="/.well-known/mcp/server.json">MCP</a></div></nav></header>

  <main class="wrap docs-layout">
    <aside class="docs-nav">
      <p>Quick start</p>
      <a href="#register"><span>1</span>Register</a><a href="#balance"><span>2</span>Check balance</a><a href="#topup"><span>3</span>Fund balance</a><a href="#verify"><span>4</span>Verify</a><a href="#settle"><span>5</span>Settle</a>
      <p>Reference</p>
      <a href="/openapi.json">OpenAPI</a><a href="/supported">Supported</a><a href="/.well-known/x402/facilitator.json">x402 manifest</a><a href="/.well-known/mcp/server.json">MCP manifest</a>
    </aside>

    <article class="docs-body">
      <p class="kicker">XGuard ${PORTAL_VERSION} · Mainnet</p>
      <h1>Integrate XGuard</h1>
      <p class="docs-lead">Base URL: <code>${origin}</code>. Use the live API key returned during registration as a Bearer token.</p>

      ${docSection("register", "1", "Register your application", `<p>Create a merchant identity and receive the API key once.</p><pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-payment-app"}'</code></pre><p>The response contains <code>apiKey</code>, merchant metadata and the XGuard treasury address. Store the key immediately.</p>`)}
      ${docSection("balance", "2", "Check service balance", `<pre><code>curl ${origin}/v1/balance \\
  -H 'authorization: Bearer xg_live_YOUR_KEY'</code></pre>`)}
      ${docSection("topup", "3", "Fund the prepaid service balance", `<p>Create a top-up intent. The response tells you the exact native USDC amount on Base, treasury address, expiry and claim token. After sending that exact amount, claim it with the transaction hash.</p><pre><code>curl -X POST ${origin}/v1/topups/intents \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"amountUsd":"1.00"}'</code></pre><pre><code>curl -X POST ${origin}/v1/topups/claim \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"claimToken":"TOKEN_FROM_INTENT","transactionHash":"0x..."}'</code></pre>`)}
      ${docSection("verify", "4", "Verify an x402 v2 payment", `<p>Send the canonical x402 v2 facilitator envelope.</p><pre><code>curl -X POST ${origin}/verify \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre>`)}
      ${docSection("settle", "5", "Settle through XGuard", `<p>Use the same canonical x402 v2 envelope. XGuard adds replay protection, concurrency protection, routed execution, finality handling and settlement truth metadata.</p><pre><code>curl -X POST ${origin}/settle \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre><div class="note"><b>Attempt fee</b><span>$0.04 once per authenticated, parseable economic attempt. Downstream failure does not refund the attempt fee. Idempotent retries do not add another fee.</span></div>`)}

      <section class="doc-section"><div class="doc-index">Ref</div><div class="doc-content"><h2>Machine integration</h2><div class="endpoint-list">${endpoint("x402 facilitator manifest", "/.well-known/x402/facilitator.json")}${endpoint("Agent Card", "/.well-known/agent-card.json")}${endpoint("MCP server metadata", "/.well-known/mcp/server.json")}${endpoint("OpenAPI", "/openapi.json")}${endpoint("Bazaar resources", "/discovery/resources")}</div></div></section>
    </article>
  </main>

  <footer><div class="wrap footer-grid"><a class="brand" href="/"><img src="/favicon.svg" width="26" height="26" alt=""><span>XGuard</span></a><p>Safe payment execution infrastructure.</p><div><a href="/">Home</a><a href="/status">Status</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div></div></footer>
</body>
</html>`;
}

function resourceCard(label: string, title: string, description: string, href: string): string {
  return `<a class="resource-card" href="${href}"><span class="resource-label">${label}</span><h3>${title}</h3><p>${description}</p><b>→</b></a>`;
}

function docSection(id: string, index: string, title: string, content: string): string {
  return `<section id="${id}" class="doc-section"><div class="doc-index">${index}</div><div class="doc-content"><h2>${title}</h2>${content}</div></section>`;
}

function endpoint(name: string, path: string): string {
  return `<a href="${path}"><span>${name}</span><code>${path}</code><b>→</b></a>`;
}

function registrationScript(): string {
  return `<script>
  (function(){
    var button=document.getElementById('register-button');
    var input=document.getElementById('merchant-name');
    var output=document.getElementById('register-output');
    if(!button||!input||!output)return;
    button.addEventListener('click',async function(){
      var name=input.value.trim();
      if(!name){output.textContent='Enter an application or merchant name first.';return;}
      button.disabled=true;button.textContent='Creating...';output.textContent='Creating live XGuard credentials...';
      try{
        var response=await fetch('/v1/register',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({name:name})});
        var data=await response.json();
        if(!response.ok)throw new Error(data.error||data.message||('HTTP '+response.status));
        output.textContent=JSON.stringify({apiKey:data.apiKey,merchant:data.merchant,treasury:data.treasury,warning:data.warning},null,2);
      }catch(error){output.textContent='Registration failed: '+(error&&error.message?error.message:'unknown error');}
      finally{button.disabled=false;button.textContent='Create key';}
    });
  })();
  </script>`;
}

function styles(): string {
  return `<style>
  :root{color-scheme:light;--bg:#f7f7f5;--surface:#fff;--soft:#f0f0ed;--text:#202124;--muted:#6f7278;--subtle:#90949b;--line:#e5e3de;--line2:#d5d2cb;--orange:#f48120;--orange2:#d9680b;--orange-soft:#fff1e4;--green:#2da44e;--sans:"Segoe UI Variable Text","Segoe UI","Helvetica Neue",Arial,sans-serif;--mono:"Cascadia Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}a{color:inherit}.wrap{width:min(1120px,calc(100% - 48px));margin-inline:auto}
  .site-header{position:sticky;top:0;z-index:30;background:rgba(247,247,245,.94);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.nav{height:68px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:720;letter-spacing:-.01em}.brand img{display:block;border-radius:8px}.brand span{font-size:16px}.nav-links{display:flex;align-items:center;gap:24px}.nav-links a,.footer-grid a{color:#5f6268;text-decoration:none;font-size:13px;font-weight:560}.nav-links a:hover,.footer-grid a:hover{color:var(--text)}.nav-links .nav-cta{padding:9px 13px;border-radius:8px;background:var(--text);color:#fff}.nav-links .nav-cta:hover{background:#34363a;color:#fff}
  .hero{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.65fr);gap:78px;align-items:center;padding:112px 0 104px}.eyebrow,.kicker{color:var(--orange2);font-size:13px;font-weight:670;letter-spacing:.01em}.eyebrow{display:inline-flex;align-items:center;gap:8px;margin-bottom:24px}.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #e6f5ea}h1,h2,h3{margin-top:0;text-wrap:balance;letter-spacing:-.035em}.hero h1{max-width:760px;margin-bottom:24px;font-size:clamp(48px,6.1vw,76px);line-height:1.03;font-weight:650}.hero-lead{max-width:680px;margin:0;color:var(--muted);font-size:19px;line-height:1.65}.hero-actions{display:flex;gap:10px;margin-top:34px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 17px;border-radius:9px;text-decoration:none;font-size:13px;font-weight:650;border:1px solid transparent;transition:.15s ease}.button-primary{background:var(--orange);color:#fff;border-color:var(--orange)}.button-primary:hover{background:var(--orange2);border-color:var(--orange2)}.button-secondary{background:var(--surface);border-color:var(--line2);color:var(--text)}.button-secondary:hover{border-color:#bcb8b0}.hero-note{margin:16px 0 0;color:var(--subtle);font-size:12px}
  .summary-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 10px 30px rgba(32,33,36,.05)}.summary-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 15px}.summary-head>div{display:grid;gap:2px}.summary-label{color:var(--subtle);font-size:11px}.summary-head strong{font-size:15px}.live-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border-radius:999px;background:#edf8f0;color:#27753a;font-size:11px;font-weight:650}.live-pill i{width:6px;height:6px;border-radius:50%;background:var(--green)}.summary-list{margin:0;border:1px solid var(--line);border-radius:11px;overflow:hidden}.summary-list div{display:flex;justify-content:space-between;gap:24px;padding:13px 14px;border-bottom:1px solid var(--line);background:#fbfaf7}.summary-list div:last-child{border-bottom:0}.summary-list dt{color:var(--muted);font-size:12px}.summary-list dd{margin:0;font:600 12px var(--mono);color:#35373b}.summary-link{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;color:#55585e;text-decoration:none;font-size:12px;font-weight:600}.summary-link:hover{color:var(--orange2)}
  .section{padding:92px 0}.section-heading{max-width:720px;margin-bottom:40px}.section-heading.compact{max-width:620px}.kicker{margin:0 0 12px}.section-heading h2,.start-copy h2,.pricing h2{margin-bottom:14px;font-size:clamp(34px,4vw,48px);line-height:1.08;font-weight:640}.section-heading>p:last-child,.start-copy>p:last-of-type,.pricing-copy{margin:0;color:var(--muted);font-size:16px}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.step{padding:26px;background:var(--surface);border:1px solid var(--line);border-radius:14px}.step-number{display:grid;place-items:center;width:30px;height:30px;margin-bottom:45px;border-radius:9px;background:var(--orange-soft);color:var(--orange2);font-size:12px;font-weight:750}.step h3{margin-bottom:9px;font-size:20px;font-weight:650}.step p{margin:0;color:var(--muted);font-size:14px}
  .soft-section{background:var(--soft);border-block:1px solid var(--line)}.start-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,.72fr);gap:76px;padding:92px 0}.register-box{margin-top:28px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:14px}.register-box label{display:block;margin-bottom:8px;color:#53565b;font-size:12px;font-weight:620}.input-row{display:grid;grid-template-columns:1fr auto;gap:8px}.input-row input{min-width:0;height:44px;padding:0 13px;border:1px solid var(--line2);border-radius:9px;background:#fff;color:var(--text);font:14px var(--sans);outline:none}.input-row input:focus{border-color:var(--orange);box-shadow:0 0 0 3px var(--orange-soft)}.input-row button{height:44px;padding:0 16px;border:0;border-radius:9px;background:var(--orange);color:#fff;font:650 13px var(--sans);cursor:pointer}.input-row button:hover{background:var(--orange2)}.input-row button:disabled{opacity:.55;cursor:default}.register-box pre,.quick-card pre,.docs-body pre{margin:14px 0 0;padding:14px 15px;border:1px solid #292c31;border-radius:10px;background:#181a1f;color:#e7e8ea;overflow:auto;white-space:pre;font:12px/1.7 var(--mono)}.register-box small{display:block;margin-top:10px;color:var(--subtle);font-size:11px}.quick-card{align-self:start;padding:22px;background:var(--surface);border:1px solid var(--line);border-radius:14px}.card-kicker{margin:0 0 16px;color:var(--muted);font-size:12px;font-weight:650}.quick-card ol{list-style:none;margin:0;padding:0}.quick-card li{display:grid;grid-template-columns:32px 1fr;gap:11px;padding:13px 0;border-bottom:1px solid var(--line)}.quick-card li:first-child{padding-top:0}.quick-card li>span{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--orange-soft);color:var(--orange2);font-size:11px;font-weight:720}.quick-card li p{margin:0;color:var(--muted);font-size:12px}.quick-card li b{display:block;margin-bottom:1px;color:var(--text);font-size:13px}.quick-card pre{margin:18px 0 12px}.quick-card>a{color:var(--orange2);text-decoration:none;font-size:12px;font-weight:650}
  .resources-section{padding-bottom:98px}.resource-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.resource-card{position:relative;min-height:190px;padding:22px 22px 42px;background:var(--surface);border:1px solid var(--line);border-radius:13px;text-decoration:none;transition:.15s ease}.resource-card:hover{transform:translateY(-1px);border-color:#d2cec6;box-shadow:0 8px 24px rgba(32,33,36,.04)}.resource-label{color:var(--orange2);font-size:11px;font-weight:700}.resource-card h3{margin:24px 0 7px;font-size:19px;font-weight:650}.resource-card p{margin:0;color:var(--muted);font-size:13px}.resource-card>b{position:absolute;right:20px;bottom:16px;color:#999b9f;font-size:16px;font-weight:500}
  .pricing{display:grid;grid-template-columns:1fr minmax(320px,.55fr);gap:80px;align-items:center;padding:24px 0 105px}.pricing-copy{max-width:660px}.price-card{padding:25px;background:var(--surface);border:1px solid var(--line);border-radius:14px}.price-card>span{color:var(--muted);font-size:12px}.price-card>strong{display:block;margin:7px 0 8px;font-size:48px;line-height:1;font-weight:650;letter-spacing:-.045em}.price-card>p{margin:0 0 19px;color:var(--subtle);font-size:12px}.price-card .button{width:100%}
  footer{padding:26px 0 34px;border-top:1px solid var(--line);background:#f3f3f0}.footer-grid{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center}.footer-grid p{margin:0;text-align:center;color:var(--subtle);font-size:11px}.footer-grid>div{display:flex;justify-content:flex-end;gap:18px}
  .docs-layout{display:grid;grid-template-columns:210px minmax(0,760px);gap:72px;padding:74px 0 110px}.docs-nav{position:sticky;top:94px;height:max-content}.docs-nav p{margin:18px 10px 7px;color:#94979d;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.docs-nav p:first-child{margin-top:0}.docs-nav a{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;color:#686b71;text-decoration:none;font-size:12px}.docs-nav a:hover{background:#efefec;color:var(--text)}.docs-nav a span{display:grid;place-items:center;width:19px;height:19px;border-radius:6px;background:#ecebe7;color:#777a80;font-size:9px}.docs-body>h1{margin:0 0 18px;font-size:clamp(46px,6vw,66px);line-height:1;font-weight:650;letter-spacing:-.045em}.docs-lead{margin:0 0 52px;color:var(--muted);font-size:16px}.docs-lead code,.doc-content code{font-family:var(--mono)}.doc-section{display:grid;grid-template-columns:62px minmax(0,1fr);padding:42px 0;border-top:1px solid var(--line)}.doc-index{padding-top:5px;color:var(--orange2);font-size:11px;font-weight:700}.doc-content h2{margin:0 0 13px;font-size:29px;line-height:1.15;font-weight:640}.doc-content p{margin:0 0 16px;color:var(--muted)}.doc-content pre{margin:18px 0}.note{display:grid;grid-template-columns:120px 1fr;gap:18px;margin-top:20px;padding:15px 16px;border:1px solid #f0d2b6;border-radius:10px;background:#fff8f0}.note b{font-size:12px}.note span{color:#6e665e;font-size:12px}.endpoint-list{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--surface)}.endpoint-list a{display:grid;grid-template-columns:1fr auto 18px;gap:16px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line);text-decoration:none}.endpoint-list a:last-child{border-bottom:0}.endpoint-list a:hover{background:#fbfaf7}.endpoint-list span{font-size:13px}.endpoint-list code{color:#898c92;font-size:10px}.endpoint-list b{color:#a3a5aa;font-weight:500}
  @media(max-width:900px){.hero,.start-grid,.pricing{grid-template-columns:1fr;gap:42px}.hero{padding:82px 0 76px}.summary-card{max-width:600px}.steps,.resource-grid{grid-template-columns:1fr 1fr}.docs-layout{grid-template-columns:1fr}.docs-nav{display:none}}
  @media(max-width:680px){.wrap{width:min(100% - 28px,1120px)}.nav{height:62px}.nav-links a:not(.nav-cta){display:none}.hero{padding:62px 0 58px}.hero h1{font-size:44px}.hero-lead{font-size:16px}.hero-actions{flex-direction:column;align-items:stretch}.steps,.resource-grid{grid-template-columns:1fr}.section{padding:68px 0}.start-grid{padding:68px 0}.input-row{grid-template-columns:1fr}.pricing{padding:12px 0 74px}.footer-grid{grid-template-columns:1fr;gap:18px;text-align:center}.footer-grid>div{justify-content:center}.doc-section{grid-template-columns:1fr;gap:10px;padding:35px 0}.doc-index{padding:0}.note{grid-template-columns:1fr;gap:6px}.endpoint-list a{grid-template-columns:1fr 18px}.endpoint-list code{grid-column:1/-1;grid-row:2}}
  </style>`;
}
