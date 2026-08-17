const PORTAL_VERSION = "0.6.0";
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
  <meta name="theme-color" content="#ffffff">
  <title>XGuard — Payment execution safety</title>
  <meta name="description" content="A compact safety layer for x402 payment verification and settlement on Base.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Primary navigation">
      <a class="brand" href="/" aria-label="XGuard home"><img src="/favicon.svg" width="28" height="28" alt=""><span>XGuard</span></a>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="/docs">Docs</a>
        <a href="/status">Status</a>
        <a href="https://github.com/moelayyan90/XGuard">GitHub</a>
        <a class="nav-cta" href="#start">Get started</a>
      </div>
    </nav>
  </header>

  <main>
    <section class="wrap hero">
      <div class="hero-main">
        <div class="status-line"><span></span>Live on Base mainnet</div>
        <h1>A safer way to run x402 payments.</h1>
        <p class="hero-lead">XGuard sits between a payment request and execution. It checks replay state, concurrency, finality and settlement truth — then returns one clear outcome.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#start">Create API key</a>
          <a class="button button-quiet" href="/docs">View documentation <span>→</span></a>
        </div>
      </div>

      <div class="facts" aria-label="XGuard production facts">
        <div><span>Protocol</span><strong>x402 v2</strong></div>
        <div><span>Network</span><strong>Base</strong></div>
        <div><span>Asset</span><strong>USDC</strong></div>
        <div><span>Usage</span><strong>$0.04 / attempt</strong></div>
      </div>
    </section>

    <section id="product" class="wrap product-section">
      <div class="section-title">
        <span>What it does</span>
        <h2>One small layer around the risky part.</h2>
        <p>XGuard does not replace your payment flow. It makes execution easier to trust and easier to inspect.</p>
      </div>

      <div class="capability-list">
        ${capability("01", "Replay protection", "Stops the same economic intent from being executed twice.")}
        ${capability("02", "Concurrency control", "Coordinates simultaneous requests so only one execution owns the payment path.")}
        ${capability("03", "Finality checks", "Separates a submitted transaction from one that is actually confirmed.")}
        ${capability("04", "Settlement truth", "Returns machine-readable settlement state instead of forcing your app to infer it.")}
      </div>
    </section>

    <section class="flow-section">
      <div class="wrap flow">
        <div class="flow-copy">
          <span class="section-label">How it works</span>
          <h2>Request in. Decision out.</h2>
          <p>The integration stays intentionally boring. Your application sends the payment envelope it already understands.</p>
        </div>
        <div class="flow-steps" aria-label="Payment flow">
          <div><b>1</b><span>Payment request</span></div>
          <i>→</i>
          <div class="flow-focus"><b>2</b><span>XGuard checks</span></div>
          <i>→</i>
          <div><b>3</b><span>Clear outcome</span></div>
        </div>
      </div>
    </section>

    <section id="start" class="wrap start-section">
      <div class="start-copy">
        <span class="section-label">Get started</span>
        <h2>Create a production key.</h2>
        <p>Name the application. XGuard returns the live key once and stores only its hash.</p>
      </div>

      <div class="register-panel">
        <label for="merchant-name">Application name</label>
        <div class="input-row">
          <input id="merchant-name" maxlength="80" autocomplete="off" placeholder="my-payment-app">
          <button id="register-button" type="button">Create key</button>
        </div>
        <pre id="register-output">Your API key will appear here.</pre>
        <small>Store the key immediately. It cannot be recovered later.</small>
      </div>
    </section>

    <section class="wrap code-section">
      <div class="code-copy">
        <span class="section-label">Quick start</span>
        <h2>Three calls are enough to begin.</h2>
        <p>Create a key, fund the prepaid balance, then send verify or settle traffic.</p>
        <a href="/docs">Read the integration guide →</a>
      </div>
      <pre class="code-block"><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-payment-app"}'</code></pre>
    </section>

    <section class="wrap resource-section">
      <div class="section-title compact">
        <span>Reference</span>
        <h2>Everything useful, without a dashboard.</h2>
      </div>
      <div class="resource-list">
        ${resourceLink("Documentation", "Integration guide", "/docs")}
        ${resourceLink("OpenAPI 3.1", "Machine-readable API contract", "/openapi.json")}
        ${resourceLink("MCP server", "Remote MCP discovery metadata", "/.well-known/mcp/server.json")}
        ${resourceLink("x402 manifest", "Facilitator discovery metadata", "/.well-known/x402/facilitator.json")}
        ${resourceLink("Runtime status", "Current gateway and settlement state", "/status")}
      </div>
    </section>

    <section class="wrap pricing">
      <div>
        <span class="section-label">Pricing</span>
        <h2>Usage only.</h2>
      </div>
      <div class="price-line"><strong>$0.04</strong><span>per authenticated, parseable economic attempt</span></div>
      <p>No monthly subscription. Prepaid balance. Idempotent retries do not add another attempt fee.</p>
    </section>
  </main>

  <footer>
    <div class="wrap footer-grid">
      <a class="brand" href="/"><img src="/favicon.svg" width="24" height="24" alt=""><span>XGuard</span></a>
      <p>Payment execution safety for x402.</p>
      <div><a href="/docs">Docs</a><a href="/status">Status</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div>
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
  <meta name="theme-color" content="#ffffff">
  <title>XGuard Docs — Quick start</title>
  <meta name="description" content="Integrate XGuard with an x402 v2 application on Base mainnet.">
  <link rel="canonical" href="${origin}/docs">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${styles()}
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Primary navigation">
      <a class="brand" href="/"><img src="/favicon.svg" width="28" height="28" alt=""><span>XGuard</span></a>
      <div class="nav-links"><a href="/">Home</a><a href="/status">Status</a><a href="/openapi.json">OpenAPI</a><a href="/.well-known/mcp/server.json">MCP</a></div>
    </nav>
  </header>

  <main class="wrap docs-layout">
    <aside class="docs-nav">
      <p>Quick start</p>
      <a href="#register">Register</a>
      <a href="#balance">Check balance</a>
      <a href="#topup">Fund balance</a>
      <a href="#verify">Verify</a>
      <a href="#settle">Settle</a>
      <p>Reference</p>
      <a href="/openapi.json">OpenAPI</a>
      <a href="/supported">Supported</a>
      <a href="/.well-known/x402/facilitator.json">x402 manifest</a>
      <a href="/.well-known/mcp/server.json">MCP manifest</a>
    </aside>

    <article class="docs-body">
      <div class="docs-eyebrow">XGuard ${PORTAL_VERSION} · Mainnet</div>
      <h1>Quick start</h1>
      <p class="docs-lead">Base URL <code>${origin}</code>. Use the live API key returned during registration as a Bearer token.</p>

      ${docSection("register", "01", "Register your application", `<p>Create a merchant identity and receive the API key once.</p><pre><code>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-payment-app"}'</code></pre><p>The response contains <code>apiKey</code>, merchant metadata and the XGuard treasury address. Store the key immediately.</p>`)}
      ${docSection("balance", "02", "Check service balance", `<pre><code>curl ${origin}/v1/balance \\
  -H 'authorization: Bearer xg_live_YOUR_KEY'</code></pre>`)}
      ${docSection("topup", "03", "Fund the prepaid balance", `<p>Create a top-up intent. The response returns the exact native USDC amount on Base, treasury address, expiry and claim token. After sending that amount, claim it with the transaction hash.</p><pre><code>curl -X POST ${origin}/v1/topups/intents \\
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
      ${docSection("settle", "05", "Settle through XGuard", `<p>Use the same canonical x402 v2 envelope. XGuard adds replay protection, concurrency control, routed execution, finality handling and settlement truth metadata.</p><pre><code>curl -X POST ${origin}/settle \\
  -H 'authorization: Bearer xg_live_YOUR_KEY' \\
  -H 'content-type: application/json' \\
  -d @x402-request.json</code></pre><div class="note"><b>Attempt fee</b><span>$0.04 once per authenticated, parseable economic attempt. Idempotent retries do not add another fee.</span></div>`)}

      <section class="doc-section">
        <div class="doc-index">Ref</div>
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
      <a class="brand" href="/"><img src="/favicon.svg" width="24" height="24" alt=""><span>XGuard</span></a>
      <p>Payment execution safety for x402.</p>
      <div><a href="/">Home</a><a href="/status">Status</a><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div>
    </div>
  </footer>
</body>
</html>`;
}

function capability(index: string, title: string, description: string): string {
  return `<article class="capability"><span>${index}</span><h3>${title}</h3><p>${description}</p></article>`;
}

function resourceLink(title: string, description: string, href: string): string {
  return `<a class="resource-row" href="${href}"><div><strong>${title}</strong><span>${description}</span></div><b>→</b></a>`;
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
      if(!name){output.textContent='Enter an application name first.';return;}
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
  :root{
    color-scheme:light;
    --bg:#ffffff;
    --soft:#f7f8fa;
    --surface:#ffffff;
    --text:#111827;
    --muted:#667085;
    --subtle:#98a2b3;
    --line:#e6e9ee;
    --line-strong:#d7dce3;
    --accent:#2563eb;
    --accent-dark:#1d4ed8;
    --accent-soft:#eff6ff;
    --green:#16a34a;
    --sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif;
    --mono:"SFMono-Regular","Cascadia Mono","Roboto Mono",Consolas,monospace;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .wrap{width:min(1080px,calc(100% - 48px));margin-inline:auto}
  .site-header{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.92);border-bottom:1px solid rgba(230,233,238,.9);backdrop-filter:blur(14px)}
  .nav{height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px}
  .brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;font-weight:700;letter-spacing:-.02em}
  .brand img{display:block;border-radius:7px}
  .brand span{font-size:15px}
  .nav-links{display:flex;align-items:center;gap:24px}
  .nav-links a,.footer-grid a{color:#606978;text-decoration:none;font-size:13px;font-weight:540}
  .nav-links a:hover,.footer-grid a:hover{color:var(--text)}
  .nav-links .nav-cta{padding:8px 12px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;color:var(--text)}
  .nav-links .nav-cta:hover{border-color:#b9c0ca;background:var(--soft)}

  .hero{padding:116px 0 72px}
  .hero-main{max-width:820px}
  .status-line{display:inline-flex;align-items:center;gap:9px;margin-bottom:24px;color:#576071;font-size:13px;font-weight:560}
  .status-line span{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #ecfdf3}
  h1,h2,h3{margin-top:0;text-wrap:balance}
  .hero h1{max-width:820px;margin-bottom:24px;font-size:clamp(50px,6vw,72px);line-height:1.02;font-weight:680;letter-spacing:-.055em}
  .hero-lead{max-width:720px;margin:0;color:var(--muted);font-size:19px;line-height:1.65}
  .hero-actions{display:flex;align-items:center;gap:18px;margin-top:34px}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;text-decoration:none;font-size:13px;font-weight:650}
  .button-primary{padding:0 17px;border-radius:8px;background:var(--text);color:#fff}
  .button-primary:hover{background:#263142}
  .button-quiet{color:#4f5b6c}
  .button-quiet:hover{color:var(--accent)}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);margin-top:88px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .facts div{display:grid;gap:3px;padding:18px 18px 19px 0;border-right:1px solid var(--line)}
  .facts div:not(:first-child){padding-left:20px}
  .facts div:last-child{border-right:0}
  .facts span{color:var(--subtle);font-size:11px}
  .facts strong{font-size:13px;font-weight:650}

  .product-section{padding:104px 0 110px}
  .section-title{max-width:680px;margin-bottom:46px}
  .section-title.compact{margin-bottom:28px}
  .section-title>span,.section-label,.docs-eyebrow{display:block;margin-bottom:12px;color:var(--accent);font-size:12px;font-weight:650}
  .section-title h2,.flow-copy h2,.start-copy h2,.code-copy h2,.pricing h2{margin-bottom:14px;font-size:clamp(34px,4vw,48px);line-height:1.08;font-weight:650;letter-spacing:-.04em}
  .section-title p,.flow-copy p,.start-copy p,.code-copy p{margin:0;color:var(--muted);font-size:16px}
  .capability-list{border-top:1px solid var(--line)}
  .capability{display:grid;grid-template-columns:80px minmax(220px,.7fr) 1fr;gap:24px;align-items:start;padding:26px 0;border-bottom:1px solid var(--line)}
  .capability>span{color:var(--subtle);font:500 11px var(--mono)}
  .capability h3{margin:0;font-size:18px;font-weight:630;letter-spacing:-.02em}
  .capability p{margin:0;color:var(--muted);font-size:14px;max-width:560px}

  .flow-section{background:var(--soft);border-block:1px solid var(--line)}
  .flow{display:grid;grid-template-columns:.7fr 1.3fr;gap:78px;align-items:center;padding:88px 0}
  .flow-steps{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:12px}
  .flow-steps>div{display:grid;gap:8px;min-height:110px;padding:18px;border:1px solid var(--line-strong);border-radius:10px;background:#fff}
  .flow-steps b{font:600 11px var(--mono);color:var(--subtle)}
  .flow-steps span{align-self:end;font-size:13px;font-weight:620}
  .flow-steps i{color:#a5adba;font-style:normal}
  .flow-steps .flow-focus{border-color:#b8ccfb;background:var(--accent-soft)}
  .flow-steps .flow-focus b{color:var(--accent)}

  .start-section{display:grid;grid-template-columns:.72fr 1.28fr;gap:76px;align-items:start;padding:110px 0 94px}
  .register-panel{padding:0}
  .register-panel label{display:block;margin-bottom:8px;color:#4d5969;font-size:12px;font-weight:600}
  .input-row{display:grid;grid-template-columns:1fr auto;gap:8px}
  .input-row input{min-width:0;height:46px;padding:0 13px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;color:var(--text);font:14px var(--sans);outline:none}
  .input-row input:focus{border-color:#84a9ff;box-shadow:0 0 0 3px var(--accent-soft)}
  .input-row button{height:46px;padding:0 17px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:650 13px var(--sans);cursor:pointer}
  .input-row button:hover{background:var(--accent-dark)}
  .input-row button:disabled{opacity:.55;cursor:default}
  .register-panel pre,.docs-body pre,.code-block{margin:14px 0 0;padding:15px 16px;border:1px solid #202938;border-radius:9px;background:#111827;color:#e5e7eb;overflow:auto;white-space:pre;font:12px/1.7 var(--mono)}
  .register-panel small{display:block;margin-top:10px;color:var(--subtle);font-size:11px}

  .code-section{display:grid;grid-template-columns:.75fr 1.25fr;gap:78px;align-items:center;padding:0 0 110px}
  .code-copy a{display:inline-block;margin-top:20px;color:var(--accent);text-decoration:none;font-size:13px;font-weight:620}
  .code-copy a:hover{text-decoration:underline}
  .code-block{margin:0}

  .resource-section{padding:0 0 105px}
  .resource-list{border-top:1px solid var(--line)}
  .resource-row{display:flex;align-items:center;justify-content:space-between;gap:30px;padding:20px 0;border-bottom:1px solid var(--line);text-decoration:none}
  .resource-row>div{display:grid;grid-template-columns:180px 1fr;gap:24px;align-items:center}
  .resource-row strong{font-size:14px;font-weight:620}
  .resource-row span{color:var(--muted);font-size:13px}
  .resource-row>b{color:#a0a7b3;font-size:16px;font-weight:500}
  .resource-row:hover strong,.resource-row:hover>b{color:var(--accent)}

  .pricing{display:grid;grid-template-columns:.6fr .8fr 1fr;gap:46px;align-items:start;padding:36px 0 100px;border-top:1px solid var(--line)}
  .pricing h2{margin:0;font-size:34px}
  .price-line{display:grid;gap:5px}
  .price-line strong{font-size:34px;font-weight:650;letter-spacing:-.04em}
  .price-line span,.pricing>p{margin:0;color:var(--muted);font-size:13px}
  footer{padding:27px 0 34px;border-top:1px solid var(--line);background:#fff}
  .footer-grid{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center}
  .footer-grid p{margin:0;text-align:center;color:var(--subtle);font-size:11px}
  .footer-grid>div{display:flex;justify-content:flex-end;gap:18px}

  .docs-layout{display:grid;grid-template-columns:190px minmax(0,760px);gap:82px;padding:80px 0 110px}
  .docs-nav{position:sticky;top:88px;height:max-content}
  .docs-nav p{margin:20px 0 8px;color:#a0a7b3;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
  .docs-nav p:first-child{margin-top:0}
  .docs-nav a{display:block;padding:6px 0;color:#667085;text-decoration:none;font-size:12px}
  .docs-nav a:hover{color:var(--accent)}
  .docs-body>h1{margin:0 0 18px;font-size:clamp(46px,6vw,64px);line-height:1;font-weight:670;letter-spacing:-.05em}
  .docs-lead{margin:0 0 54px;color:var(--muted);font-size:16px}
  .docs-lead code,.doc-content code{font-family:var(--mono)}
  .doc-section{display:grid;grid-template-columns:62px minmax(0,1fr);padding:42px 0;border-top:1px solid var(--line)}
  .doc-index{padding-top:5px;color:var(--accent);font:600 11px var(--mono)}
  .doc-content h2{margin:0 0 13px;font-size:28px;line-height:1.15;font-weight:640;letter-spacing:-.03em}
  .doc-content p{margin:0 0 16px;color:var(--muted)}
  .doc-content pre{margin:18px 0}
  .note{display:grid;grid-template-columns:120px 1fr;gap:18px;margin-top:20px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .note b{font-size:12px}
  .note span{color:var(--muted);font-size:12px}
  .endpoint-list{border-top:1px solid var(--line)}
  .endpoint-list a{display:grid;grid-template-columns:1fr auto 18px;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line);text-decoration:none}
  .endpoint-list a:hover span,.endpoint-list a:hover b{color:var(--accent)}
  .endpoint-list span{font-size:13px}
  .endpoint-list code{color:#9098a6;font-size:10px}
  .endpoint-list b{color:#a3a9b4;font-weight:500}

  @media(max-width:900px){
    .flow,.start-section,.code-section,.pricing{grid-template-columns:1fr;gap:38px}
    .flow-steps{max-width:680px}
    .capability{grid-template-columns:55px 1fr}
    .capability p{grid-column:2}
    .pricing{gap:24px}
    .docs-layout{grid-template-columns:1fr}
    .docs-nav{display:none}
  }
  @media(max-width:680px){
    .wrap{width:min(100% - 28px,1080px)}
    .nav{height:60px}
    .nav-links a:not(.nav-cta){display:none}
    .hero{padding:72px 0 52px}
    .hero h1{font-size:44px}
    .hero-lead{font-size:16px}
    .hero-actions{align-items:flex-start;flex-direction:column;gap:14px}
    .facts{grid-template-columns:1fr 1fr;margin-top:60px}
    .facts div:nth-child(2){border-right:0}
    .facts div:nth-child(-n+2){border-bottom:1px solid var(--line)}
    .facts div:nth-child(3){padding-left:0}
    .product-section{padding:76px 0}
    .capability{grid-template-columns:42px 1fr;gap:14px}
    .flow{padding:72px 0}
    .flow-steps{grid-template-columns:1fr}
    .flow-steps i{transform:rotate(90deg);justify-self:center}
    .start-section{padding:78px 0 70px}
    .input-row{grid-template-columns:1fr}
    .code-section{padding-bottom:76px}
    .resource-section{padding-bottom:76px}
    .resource-row>div{grid-template-columns:1fr;gap:3px}
    .pricing{padding-bottom:74px}
    .footer-grid{grid-template-columns:1fr;gap:18px;text-align:center}
    .footer-grid>div{justify-content:center}
    .doc-section{grid-template-columns:1fr;gap:9px;padding:34px 0}
    .doc-index{padding:0}
    .note{grid-template-columns:1fr;gap:6px}
    .endpoint-list a{grid-template-columns:1fr 18px}
    .endpoint-list code{grid-column:1/-1;grid-row:2}
  }
  </style>`;
}
