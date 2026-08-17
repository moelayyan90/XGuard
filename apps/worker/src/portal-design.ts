const PORTAL_VERSION = "0.4.0";
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
  <meta name="theme-color" content="#0b0c0e">
  <title>XGuard — x402 Economic Safety Infrastructure</title>
  <meta name="description" content="Economic safety infrastructure for x402 settlement on Base mainnet. Replay protection, finality verification, settlement truth and machine discovery.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Primary navigation">
      <a class="brand" href="/" aria-label="XGuard home">
        <img src="/favicon.svg" width="30" height="30" alt="">
        <span>XGUARD</span>
      </a>
      <div class="nav-links">
        <a href="#system">System</a>
        <a href="/docs">Docs</a>
        <a href="/status">Status</a>
        <a href="/openapi.json">OpenAPI</a>
        <a class="nav-cta" href="#start">Get API key</a>
      </div>
    </nav>
  </header>

  <main>
    <section class="wrap hero">
      <div class="hero-copy">
        <div class="section-tag"><span>01</span><b>ECONOMIC SAFETY / x402</b></div>
        <h1>Settlement infrastructure<br>with a hard safety boundary.</h1>
        <p class="hero-lead">XGuard sits on the x402 payment path and verifies the conditions that matter before settlement is treated as final.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#start">Create API key</a>
          <a class="button button-quiet" href="/docs">Read integration docs</a>
        </div>
      </div>

      <div class="system-panel" aria-label="XGuard system summary">
        <div class="panel-head">
          <span>PRODUCTION / MAINNET</span>
          <span class="status"><i></i>LIVE</span>
        </div>
        <dl class="system-list">
          <div><dt>Protocol</dt><dd>x402 v2</dd></div>
          <div><dt>Network</dt><dd>Base / eip155:8453</dd></div>
          <div><dt>Asset</dt><dd>USDC</dd></div>
          <div><dt>Settlement fee</dt><dd>$0.002</dd></div>
          <div><dt>Failed / malformed</dt><dd>$0</dd></div>
        </dl>
        <div class="panel-foot">PREPAID USAGE · NO SUBSCRIPTION</div>
      </div>
    </section>

    <div class="signal-strip" aria-label="Core protections">
      <div class="wrap signal-grid">
        <span>REPLAY CONTROL</span>
        <span>FINALITY CHECK</span>
        <span>SETTLEMENT TRUTH</span>
        <span>MCP DISCOVERY</span>
        <span>BAZAAR INDEX</span>
      </div>
    </div>

    <section id="system" class="wrap section-block">
      <div class="section-intro">
        <div class="section-tag"><span>02</span><b>SYSTEM PATH</b></div>
        <h2>A short path. Clear responsibility at every step.</h2>
        <p>XGuard does not replace x402. It adds a controlled execution boundary around verification, settlement and accounting.</p>
      </div>

      <div class="process-grid">
        <article class="process-card">
          <div class="icon-box" aria-hidden="true">${icon("terminal")}</div>
          <div class="process-number">01 / REQUEST</div>
          <h3>Canonical input</h3>
          <p>Your application sends the normal x402 v2 payment payload and requirements.</p>
        </article>
        <article class="process-card process-active">
          <div class="icon-box" aria-hidden="true">${icon("shield")}</div>
          <div class="process-number">02 / XGUARD</div>
          <h3>Economic boundary</h3>
          <p>Replay state, merchant identity, concurrency, health and settlement truth are checked.</p>
        </article>
        <article class="process-card">
          <div class="icon-box" aria-hidden="true">${icon("check")}</div>
          <div class="process-number">03 / RESULT</div>
          <h3>Verified outcome</h3>
          <p>Execution is routed and finalized before billable accounting is considered earned.</p>
        </article>
      </div>
    </section>

    <section id="start" class="section-band">
      <div class="wrap start-grid">
        <div>
          <div class="section-tag"><span>03</span><b>START</b></div>
          <h2>Create a production API key.</h2>
          <p class="muted">This form calls the live XGuard registration endpoint. The returned key is displayed once and is not persisted by this page.</p>

          <div class="register-box">
            <label for="merchant-name">APPLICATION / MERCHANT NAME</label>
            <div class="input-row">
              <input id="merchant-name" maxlength="80" autocomplete="off" placeholder="my-x402-app">
              <button id="register-button" type="button">Create key</button>
            </div>
            <pre id="register-output">Your API key will appear here.</pre>
            <small>Store it immediately. XGuard stores only its hash.</small>
          </div>
        </div>

        <div class="quick-panel">
          <div class="panel-title">
            <span>QUICK START</span>
            <a href="/docs">FULL DOCS ↗</a>
          </div>
          <div class="quick-step"><b>01</b><span>Create a merchant identity and API key.</span></div>
          <div class="quick-step"><b>02</b><span>Fund the prepaid service balance.</span></div>
          <div class="quick-step"><b>03</b><span>Send verify and settlement traffic.</span></div>
          <pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-x402-app"}'</code></pre>
          <a class="text-link" href="/docs#settle">Continue to settlement example ↗</a>
        </div>
      </div>
    </section>

    <section class="wrap section-block">
      <div class="section-intro compact">
        <div class="section-tag"><span>04</span><b>DEVELOPER SURFACE</b></div>
        <h2>Everything important has a direct endpoint.</h2>
      </div>

      <div class="resource-grid">
        ${resourceCard("book", "DOCS", "Developer docs", "Registration, funding, authentication and settlement examples.", "/docs")}
        ${resourceCard("code", "API", "OpenAPI 3.1", "Machine-readable contract for tooling, clients and SDK generation.", "/openapi.json")}
        ${resourceCard("nodes", "MCP", "MCP server", "Remote MCP discovery metadata and the XGuard tool interface.", "/.well-known/mcp/server.json")}
        ${resourceCard("route", "402", "x402 manifest", "Canonical facilitator discovery metadata for integrations.", "/.well-known/x402/facilitator.json")}
        ${resourceCard("search", "BZR", "Bazaar discovery", "Paid HTTP APIs and MCP resources cataloged by XGuard.", "/discovery/resources")}
        ${resourceCard("pulse", "LIVE", "Runtime status", "Gateway, facilitator, settlement and accounting state.", "/status")}
      </div>
    </section>

    <section class="wrap pricing-section">
      <div class="pricing-copy">
        <div class="section-tag"><span>05</span><b>PRICING</b></div>
        <h2>Charge follows delivered value.</h2>
        <p>No monthly plan is required for the settlement safety path.</p>
      </div>
      <div class="price-table">
        <div class="price-main"><span>SUCCESSFUL BILLABLE SETTLEMENT</span><strong>$0.002</strong></div>
        <div><span>FAILED SETTLEMENT</span><b>$0</b></div>
        <div><span>MALFORMED REQUEST</span><b>$0</b></div>
        <div><span>DUPLICATE / REPLAY</span><b>$0</b></div>
        <a class="button button-primary" href="#start">Create API key</a>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap footer-grid">
      <a class="brand" href="/"><img src="/favicon.svg" width="28" height="28" alt=""><span>XGUARD</span></a>
      <p>Economic safety infrastructure for x402.</p>
      <div><a href="/docs">Docs</a><a href="/status">Status</a><a href="/llms.txt">LLMs</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div>
    </div>
  </footer>

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
  <meta name="theme-color" content="#0b0c0e">
  <title>XGuard Docs — Quick Start</title>
  <meta name="description" content="Integrate XGuard with an x402 v2 application on Base mainnet.">
  <link rel="canonical" href="${origin}/docs">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Primary navigation">
      <a class="brand" href="/"><img src="/favicon.svg" width="30" height="30" alt=""><span>XGUARD</span></a>
      <div class="nav-links"><a href="/">Home</a><a href="/status">Status</a><a href="/openapi.json">OpenAPI</a><a href="/.well-known/mcp/server.json">MCP</a></div>
    </nav>
  </header>

  <main class="wrap docs-layout">
    <aside class="docs-nav">
      <div class="docs-nav-title">QUICK START</div>
      <a href="#register"><span>01</span>Register</a>
      <a href="#balance"><span>02</span>Check balance</a>
      <a href="#topup"><span>03</span>Fund balance</a>
      <a href="#verify"><span>04</span>Verify</a>
      <a href="#settle"><span>05</span>Settle</a>
      <div class="docs-nav-title">REFERENCE</div>
      <a href="/openapi.json">OpenAPI</a>
      <a href="/supported">Supported</a>
      <a href="/.well-known/x402/facilitator.json">x402 manifest</a>
      <a href="/.well-known/mcp/server.json">MCP manifest</a>
    </aside>

    <article class="docs-body">
      <div class="section-tag"><span>DOC</span><b>XGUARD ${PORTAL_VERSION} / MAINNET</b></div>
      <h1>Integrate XGuard</h1>
      <p class="docs-lead">Base URL: <code>${origin}</code>. Use the live API key returned during registration as a Bearer token.</p>

      ${docSection("register", "01", "Register your application", `<p>Create a merchant identity and receive the API key once.</p><pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-x402-app"}'</code></pre><p>The response contains <code>apiKey</code>, merchant metadata and the XGuard treasury address. Store the key immediately.</p>`)}

      ${docSection("balance", "02", "Check service balance", `<pre><code>curl ${origin}/v1/balance \\
  -H 'authorization: Bearer xg_live_YOUR_KEY'</code></pre>`)}

      ${docSection("topup", "03", "Fund the prepaid service balance", `<p>Create a top-up intent. The response tells you the exact native USDC amount on Base, treasury address, expiry and claim token. After sending that exact amount, claim it with the transaction hash.</p><pre><code>curl -X POST ${origin}/v1/topups/intents \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"amountUsd":"1.00"}'</code></pre><pre><code>curl -X POST ${origin}/v1/topups/claim \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d '{"claimToken":"TOKEN_FROM_INTENT","transactionHash":"0x..."}'</code></pre>`)}

      ${docSection("verify", "04", "Verify an x402 v2 payment", `<p>Send the canonical x402 v2 facilitator envelope.</p><pre><code>curl -X POST ${origin}/verify \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre>`)}

      ${docSection("settle", "05", "Settle through XGuard", `<p>Use the same canonical x402 v2 envelope. XGuard adds replay protection, concurrency protection, routed execution, finality handling and settlement truth metadata.</p><pre><code>curl -X POST ${origin}/settle \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre><div class="note"><b>Settlement fee</b><span>$0.002 for a successful billable settlement. Failed, malformed and duplicate traffic is not earned settlement revenue.</span></div>`)}

      <section class="doc-section">
        <div class="doc-index">REF</div>
        <div class="doc-content">
          <h2>Machine integration</h2>
          <div class="endpoint-list">
            ${endpoint("x402 facilitator manifest", "/.well-known/x402/facilitator.json")}
            ${endpoint("Agent Card", "/.well-known/agent-card.json")}
            ${endpoint("MCP server metadata", "/.well-known/mcp/server.json")}
            ${endpoint("OpenAPI", "/openapi.json")}
            ${endpoint("Bazaar resources", "/discovery/resources")}
          </div>
        </div>
      </section>
    </article>
  </main>

  <footer>
    <div class="wrap footer-grid">
      <a class="brand" href="/"><img src="/favicon.svg" width="28" height="28" alt=""><span>XGUARD</span></a>
      <p>Economic safety infrastructure for x402.</p>
      <div><a href="/">Home</a><a href="/status">Status</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div>
    </div>
  </footer>
</body>
</html>`;
}

function resourceCard(
  iconName: IconName,
  label: string,
  title: string,
  description: string,
  href: string,
): string {
  return `<a class="resource-card" href="${href}"><div class="resource-top"><span class="icon-box" aria-hidden="true">${icon(iconName)}</span><b>${label}</b></div><h3>${title}</h3><p>${description}</p><span class="resource-arrow">↗</span></a>`;
}

function docSection(
  id: string,
  index: string,
  title: string,
  content: string,
): string {
  return `<section id="${id}" class="doc-section"><div class="doc-index">${index}</div><div class="doc-content"><h2>${title}</h2>${content}</div></section>`;
}

function endpoint(name: string, path: string): string {
  return `<a href="${path}"><span>${name}</span><code>${path}</code><b>↗</b></a>`;
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

type IconName =
  | "terminal"
  | "shield"
  | "check"
  | "book"
  | "code"
  | "nodes"
  | "route"
  | "search"
  | "pulse";

function icon(name: IconName): string {
  const paths: Record<IconName, string> = {
    terminal: '<path d="m4 7 4 4-4 4"/><path d="M10 17h6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 2.7 7.4 7 9 4.3-1.6 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 1.7 1.7 3.7-4"/>',
    check: '<path d="M20 11.2V12a8 8 0 1 1-4.7-7.3"/><path d="m9 11 3 3L21 5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/>',
    code: '<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
    nodes: '<rect x="3" y="4" width="6" height="5"/><rect x="15" y="15" width="6" height="5"/><path d="M9 6.5h4a3 3 0 0 1 3 3V15"/><path d="M15 17.5h-4a3 3 0 0 1-3-3V9"/>',
    route: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h3a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name]}</svg>`;
}

function styles(): string {
  return `<style>
  :root{
    color-scheme:dark;
    --bg:#0b0c0e;
    --panel:#101216;
    --panel-2:#14171c;
    --line:#292d34;
    --line-strong:#3a4049;
    --text:#f2f3f5;
    --muted:#949ba6;
    --quiet:#69717d;
    --red:#f23b45;
    --green:#5fd09a;
    --sans:"Aptos","Segoe UI Variable","Segoe UI",Helvetica,Arial,sans-serif;
    --display:"Arial Narrow","Aptos Display","Segoe UI Variable Display","Segoe UI",Helvetica,Arial,sans-serif;
    --mono:"Cascadia Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .wrap{width:min(1160px,calc(100% - 48px));margin-inline:auto}
  .site-header{position:sticky;top:0;z-index:30;background:rgba(11,12,14,.96);border-bottom:1px solid var(--line)}
  .nav{height:64px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none}
  .brand img{display:block;border-radius:2px}
  .brand span{font:800 14px/1 var(--sans);letter-spacing:.15em}
  .nav-links{display:flex;align-items:center;gap:26px}
  .nav-links a,.footer-grid a{color:#b1b6be;text-decoration:none;font-size:13px}
  .nav-links a:hover,.footer-grid a:hover{color:#fff}
  .nav-links .nav-cta{border:1px solid var(--line-strong);padding:8px 11px;color:#fff;background:#111318}

  .hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(360px,.75fr);gap:72px;align-items:end;padding:108px 0 82px}
  .section-tag{display:inline-grid;grid-template-columns:auto auto;align-items:stretch;border:1px solid var(--line);font:700 10px/1 var(--mono);letter-spacing:.12em;color:#aeb4bd;margin-bottom:25px}
  .section-tag span{padding:8px 9px;color:var(--red);border-right:1px solid var(--line);background:#111318}
  .section-tag b{padding:8px 10px;font-weight:700}
  h1,h2,h3{font-family:var(--display);font-weight:760;text-wrap:balance}
  .hero h1{max-width:800px;margin:0;font-size:clamp(46px,6vw,76px);line-height:1.01;letter-spacing:-.045em}
  .hero-lead{max-width:690px;margin:27px 0 0;color:#a8aeb7;font-size:18px;line-height:1.6}
  .hero-actions{display:flex;gap:10px;margin-top:34px}
  .button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border-radius:2px;border:1px solid var(--line-strong);text-decoration:none;font-size:13px;font-weight:750;letter-spacing:.01em}
  .button-primary{background:var(--red);border-color:var(--red);color:#fff}
  .button-primary:hover{background:#ff4c55;border-color:#ff4c55}
  .button-quiet{background:#111318;color:#e5e7ea}
  .button-quiet:hover{border-color:#555c66}

  .system-panel{border:1px solid var(--line);background:#0e1013}
  .panel-head,.panel-foot,.panel-title{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font:700 10px/1 var(--mono);letter-spacing:.1em;color:#7f8792}
  .panel-head{border-bottom:1px solid var(--line)}
  .panel-foot{border-top:1px solid var(--line);color:#69717d}
  .status{display:inline-flex;align-items:center;gap:7px;color:#a9d9c3}
  .status i{width:6px;height:6px;background:var(--green);display:block}
  .system-list{margin:0}
  .system-list div{display:grid;grid-template-columns:1fr auto;gap:20px;padding:14px;border-bottom:1px solid #20242a}
  .system-list div:last-child{border-bottom:0}
  .system-list dt{color:#858c96;font-size:12px}
  .system-list dd{margin:0;color:#f1f2f4;font:600 12px var(--mono);text-align:right}

  .signal-strip{border-block:1px solid var(--line);background:#0e1013}
  .signal-grid{display:grid;grid-template-columns:repeat(5,1fr)}
  .signal-grid span{padding:14px 12px;border-right:1px solid var(--line);font:650 9px/1 var(--mono);letter-spacing:.12em;text-align:center;color:#737b86}
  .signal-grid span:first-child{border-left:1px solid var(--line)}

  .section-block{padding:92px 0}
  .section-intro{max-width:780px;margin-bottom:42px}
  .section-intro.compact{max-width:700px}
  .section-intro h2,.start-grid h2,.pricing-copy h2{margin:0;font-size:clamp(34px,4.2vw,52px);line-height:1.05;letter-spacing:-.035em}
  .section-intro p,.pricing-copy p,.muted{max-width:700px;color:var(--muted);font-size:16px;margin:18px 0 0}

  .process-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line)}
  .process-card{position:relative;min-height:270px;padding:28px;border-right:1px solid var(--line);background:#0e1013}
  .process-card:last-child{border-right:0}
  .process-active{background:#111316}
  .process-active:before{content:"";position:absolute;top:-1px;left:-1px;right:-1px;height:2px;background:var(--red)}
  .icon-box{width:38px;height:38px;display:inline-grid;place-items:center;border:1px solid var(--line-strong);color:#b8bec7;background:#0d0f12}
  .icon-box svg{width:19px;height:19px}
  .process-number{margin-top:52px;font:650 10px var(--mono);letter-spacing:.1em;color:#666e79}
  .process-card h3{font-size:23px;margin:8px 0 9px;letter-spacing:-.02em}
  .process-card p{margin:0;color:var(--muted);font-size:14px}

  .section-band{border-block:1px solid var(--line);background:#0e1013}
  .start-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.8fr);gap:70px;padding:88px 0}
  .register-box{margin-top:30px;border:1px solid var(--line);padding:20px;background:#0b0c0e}
  .register-box label{display:block;color:#8c939d;font:650 10px var(--mono);letter-spacing:.11em}
  .input-row{display:grid;grid-template-columns:1fr auto;margin-top:9px}
  .input-row input{min-width:0;height:43px;border:1px solid var(--line-strong);border-right:0;border-radius:0;background:#101216;color:#fff;padding:0 12px;font:13px var(--sans);outline:none}
  .input-row input:focus{border-color:#666d77}
  .input-row button{height:43px;border:1px solid var(--red);border-radius:0;background:var(--red);color:#fff;padding:0 16px;font:750 12px var(--sans);cursor:pointer}
  .input-row button:disabled{opacity:.55;cursor:default}
  .register-box pre,.quick-panel pre,.docs-body pre{margin:14px 0 0;border:1px solid #262a31;border-radius:0;background:#090a0c;padding:14px;overflow:auto;white-space:pre;color:#d4d8de;font:12px/1.7 var(--mono)}
  .register-box small{display:block;margin-top:10px;color:#6d7580;font-size:11px}
  .quick-panel{align-self:start;border:1px solid var(--line);background:#0b0c0e}
  .panel-title{border-bottom:1px solid var(--line)}
  .panel-title a{color:#9ca3ad;text-decoration:none}
  .quick-step{display:grid;grid-template-columns:46px 1fr;border-bottom:1px solid #22262c;min-height:54px;align-items:center}
  .quick-step b{height:100%;display:grid;place-items:center;border-right:1px solid #22262c;color:var(--red);font:600 11px var(--mono)}
  .quick-step span{padding:0 14px;color:#c0c5cc;font-size:13px}
  .quick-panel pre{margin:16px}
  .text-link{display:block;padding:0 16px 17px;color:#aab1ba;text-decoration:none;font-size:12px}

  .resource-grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-left:1px solid var(--line)}
  .resource-card{position:relative;min-height:215px;padding:22px;text-decoration:none;background:#0e1013;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
  .resource-card:hover{background:#12151a}
  .resource-top{display:flex;align-items:center;justify-content:space-between}
  .resource-top b{color:#6e7681;font:650 10px var(--mono);letter-spacing:.1em}
  .resource-card h3{font-size:21px;margin:29px 0 8px}
  .resource-card p{max-width:290px;margin:0;color:var(--muted);font-size:13px}
  .resource-arrow{position:absolute;right:20px;bottom:17px;color:#646c77;font:14px var(--mono)}

  .pricing-section{display:grid;grid-template-columns:1fr minmax(390px,.75fr);gap:80px;align-items:start;padding:95px 0 105px}
  .price-table{border:1px solid var(--line);background:#0e1013}
  .price-table>div{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 16px;border-bottom:1px solid var(--line)}
  .price-table span{color:#787f8a;font:650 9px var(--mono);letter-spacing:.1em}
  .price-table b{font:600 12px var(--mono)}
  .price-table .price-main{display:block;padding:22px 16px}
  .price-main strong{display:block;margin-top:8px;font:760 50px/1 var(--display);letter-spacing:-.04em}
  .price-table .button{margin:14px;width:calc(100% - 28px)}

  footer{border-top:1px solid var(--line);padding:25px 0 32px;background:#090a0c}
  .footer-grid{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center}
  .footer-grid p{text-align:center;color:#68707b;font-size:11px;margin:0}
  .footer-grid>div{display:flex;justify-content:flex-end;gap:18px}

  .docs-layout{display:grid;grid-template-columns:220px minmax(0,790px);gap:76px;padding:72px 0 110px}
  .docs-nav{position:sticky;top:94px;height:max-content;border-top:1px solid var(--line)}
  .docs-nav-title{padding:15px 10px 9px;color:#606873;font:650 9px var(--mono);letter-spacing:.12em}
  .docs-nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;color:#9ca3ad;text-decoration:none;font-size:12px;border-left:1px solid transparent}
  .docs-nav a:hover{color:#fff;border-left-color:var(--red);background:#0f1115}
  .docs-nav a span{color:#5e6670;font:10px var(--mono)}
  .docs-body>h1{font-size:clamp(46px,6vw,68px);line-height:1;letter-spacing:-.045em;margin:0 0 18px}
  .docs-lead{color:#a0a7b0;font-size:16px;margin-bottom:58px}
  .docs-lead code,.doc-content code{font-family:var(--mono)}
  .doc-section{display:grid;grid-template-columns:72px minmax(0,1fr);border-top:1px solid var(--line);padding:48px 0}
  .doc-index{color:#646c76;font:650 10px var(--mono);letter-spacing:.1em;padding-top:8px}
  .doc-content h2{font-size:30px;line-height:1.12;letter-spacing:-.025em;margin:0 0 14px}
  .doc-content p{color:#9da4ad;margin:0 0 16px}
  .doc-content pre{margin:18px 0}
  .note{display:grid;grid-template-columns:150px 1fr;border:1px solid var(--line);border-left:2px solid var(--red);margin-top:20px;padding:14px 16px;background:#0e1013}
  .note b{font-size:12px}
  .note span{color:#9ca3ad;font-size:12px}
  .endpoint-list{border-top:1px solid var(--line)}
  .endpoint-list a{display:grid;grid-template-columns:1fr auto 22px;gap:18px;align-items:center;padding:13px 12px;border-bottom:1px solid var(--line);text-decoration:none;background:#0e1013}
  .endpoint-list a:hover{background:#12151a}
  .endpoint-list span{font-size:13px}
  .endpoint-list code{color:#737b86;font-size:10px}
  .endpoint-list b{color:#666e79;font:12px var(--mono)}

  @media(max-width:900px){
    .hero,.start-grid,.pricing-section{grid-template-columns:1fr;gap:44px}
    .hero{padding-top:78px}
    .system-panel{max-width:620px}
    .signal-grid{grid-template-columns:repeat(3,1fr)}
    .signal-grid span{border-bottom:1px solid var(--line)}
    .process-grid,.resource-grid{grid-template-columns:1fr 1fr}
    .process-card:nth-child(2){border-right:0}
    .process-card:last-child{grid-column:1/-1;border-top:1px solid var(--line)}
    .docs-layout{grid-template-columns:1fr}
    .docs-nav{display:none}
  }
  @media(max-width:650px){
    .wrap{width:min(100% - 28px,1160px)}
    .nav{height:60px}
    .nav-links a:not(.nav-cta){display:none}
    .hero{padding:62px 0 58px}
    .hero h1{font-size:43px}
    .hero-lead{font-size:16px}
    .hero-actions{flex-direction:column;align-items:stretch}
    .signal-grid,.process-grid,.resource-grid{grid-template-columns:1fr}
    .signal-grid span{border-left:1px solid var(--line)}
    .process-card,.process-card:nth-child(2){border-right:0;border-bottom:1px solid var(--line)}
    .process-card:last-child{grid-column:auto;border-top:0;border-bottom:0}
    .section-block{padding:68px 0}
    .start-grid{padding:66px 0}
    .input-row{grid-template-columns:1fr}
    .input-row input{border-right:1px solid var(--line-strong);border-bottom:0}
    .pricing-section{padding:70px 0}
    .price-table{min-width:0}
    .footer-grid{grid-template-columns:1fr;gap:18px;text-align:center}
    .footer-grid>div{justify-content:center}
    .doc-section{grid-template-columns:1fr;gap:12px;padding:38px 0}
    .doc-index{padding:0}
    .note{grid-template-columns:1fr;gap:7px}
    .endpoint-list a{grid-template-columns:1fr 18px}
    .endpoint-list code{grid-column:1/-1;grid-row:2}
  }
  </style>`;
}
