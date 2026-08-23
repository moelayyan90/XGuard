const VERSION = "3.0.0";

export function siteHtml() {
  return page(
    "XGuard Email Shield — Stop fake signups automatically",
    `<section class="hero"><div class="pill">EMAIL SHIELD · SELF-SERVICE</div><h1>Stop fake emails<br>before they enter.</h1><p>XGuard runs automatically inside signup, checkout and form workflows. Reject disposable, malformed and non-routable addresses before they cost you money.</p><div class="actions"><button id="keyBtn">Get 100 free checks</button><a class="secondary" href="/docs">API docs</a><a class="secondary" href="https://github.com/moelayyan90/XGuard/releases/latest/download/xguard-email-shield.zip">WordPress plugin</a></div><div id="keyBox" class="keybox hidden"></div></section><section class="grid"><article><strong>Syntax</strong><span>Reject malformed addresses instantly.</span></article><article><strong>DNS / MX</strong><span>Verify that the domain has a real mail route.</span></article><article><strong>Disposable</strong><span>Block temporary-email infrastructure.</span></article><article><strong>Workflow-native</strong><span>Install once; configured emails are checked automatically.</span></article></section><section class="demo"><h2>One endpoint</h2><pre><code>curl https://api.xguardgate.com/v1/verify \\
  -H "Authorization: Bearer xg_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com"}'</code></pre></section><section id="pricing" class="pricing"><div><span>Usage pricing</span><h2>$0.003</h2><p>per email check · no monthly subscription</p></div><div><span>Free start</span><h2>100 checks</h2><p>Generate a key instantly. No sales call.</p></div></section>`,
    `<script>const b=document.getElementById('keyBtn'),x=document.getElementById('keyBox');b.onclick=async()=>{b.disabled=true;b.textContent='Creating…';try{const r=await fetch('/v1/keys/free',{method:'POST'}),j=await r.json();x.classList.remove('hidden');if(r.ok){x.innerHTML='<b>Your API key</b><code>'+j.apiKey+'</code><small>Copy it now. It cannot be recovered.</small>';localStorage.setItem('xguard_api_key',j.apiKey)}else{x.textContent=j.error||'Could not create key'}}catch{x.textContent='Network error';x.classList.remove('hidden')}finally{b.disabled=false;b.textContent='Get 100 free checks'}};</script>`
  );
}

export function docsHtml() {
  return page("XGuard Email Shield Docs", `<section class="docs"><h1>Email Shield API</h1><p>Base URL: <code>https://api.xguardgate.com</code></p><h2>Create a free key</h2><pre><code>POST /v1/keys/free</code></pre><h2>Verify</h2><pre><code>POST /v1/verify\nAuthorization: Bearer xg_live_...\nContent-Type: application/json\n\n{"email":"user@example.com"}</code></pre><h2>Decision model</h2><p><code>accept</code>: syntax and mail routing passed with no known disposable/typo risk. <code>review</code>: role address, typo, or transient DNS uncertainty. <code>reject</code>: deterministic failure such as malformed syntax, disposable domain, Null MX or no mail route.</p><p>Mailbox deliverability remains <code>unknown</code> unless a mailbox-verification upstream is explicitly enabled.</p><h2>Batch</h2><pre><code>POST /v1/verify/batch\n{"emails":["a@example.com","b@example.com"]}</code></pre><p>Maximum 100 addresses per request.</p></section>`);
}

export function privacyHtml() {
  return page("XGuard Privacy", `<section class="docs"><h1>Privacy</h1><p>XGuard does not store submitted email addresses. API keys are stored only as SHA-256 hashes. Aggregated usage stores key prefixes, daily check counts and reject counts.</p></section>`);
}

export function openApi(origin) {
  return {
    openapi: "3.1.0",
    info: { title: "XGuard Email Shield API", version: VERSION, description: "Self-service email risk verification for automated signup, checkout and form workflows." },
    servers: [{ url: origin.includes("api.") ? origin : "https://api.xguardgate.com" }],
    paths: {
      "/v1/keys/free": { post: { summary: "Create a free API key", responses: { "201": { description: "Created" } } } },
      "/v1/verify": { post: { summary: "Verify one email", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } } }, responses: { "200": { description: "Verification result" }, "402": { description: "Insufficient credits" } } } },
      "/v1/verify/batch": { post: { summary: "Verify up to 100 emails", security: [{ bearerAuth: [] }], responses: { "200": { description: "Batch results" } } } },
      "/v1/usage": { get: { summary: "Get key usage", security: [{ bearerAuth: [] }], responses: { "200": { description: "Usage" } } } }
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
  };
}

function page(title, body, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="XGuard Email Shield automatically blocks risky email signups."><style>${css()}</style></head><body><nav><b><a href="/">XGUARD</a></b><div><a href="/docs">Docs</a><a href="/#pricing">Pricing</a></div></nav><main>${body}</main><footer>© 2026 XGuard · Email Shield API</footer>${script}</body></html>`;
}

function css() {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;background:#080a0d;color:#f5f7f8;color-scheme:dark}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}nav{max-width:1180px;margin:auto;padding:28px 24px;display:flex;justify-content:space-between;align-items:center}nav b{letter-spacing:.18em}nav div{display:flex;gap:24px;color:#a9b1ba}main{max-width:1180px;margin:auto;padding:70px 24px}.hero{max-width:850px;padding:40px 0 90px}.pill{display:inline-block;border:1px solid #2b3037;border-radius:999px;padding:8px 12px;font-size:12px;letter-spacing:.12em;color:#aab3be}.hero h1{font-size:clamp(54px,8vw,106px);line-height:.9;letter-spacing:-.055em;margin:28px 0}.hero p{font-size:20px;line-height:1.55;color:#a9b1ba;max-width:720px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}button,.secondary{border:0;border-radius:10px;padding:14px 18px;font-weight:700;font-size:15px}button{background:#d8ff3e;color:#111;cursor:pointer}.secondary{border:1px solid #30363d}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid article,.pricing>div{border:1px solid #242a31;border-radius:18px;padding:24px;background:#0c0f13}.grid strong{display:block;font-size:20px;margin-bottom:45px}.grid span,.pricing p,.docs p{color:#8f99a5}.demo{padding:100px 0}.demo h2,.pricing h2,.docs h1{font-size:42px;letter-spacing:-.03em}pre{overflow:auto;background:#0d1117;border:1px solid #252b33;border-radius:14px;padding:22px;color:#d8ff3e;line-height:1.55}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pricing h2{font-size:58px;margin:10px 0}.keybox{margin-top:18px;padding:18px;border:1px solid #d8ff3e;border-radius:12px;max-width:680px}.keybox code{display:block;overflow-wrap:anywhere;margin:10px 0;color:#d8ff3e}.hidden{display:none}.docs{max-width:900px}.docs h2{margin-top:50px}.docs p{line-height:1.7}.docs code{color:#d8ff3e}footer{max-width:1180px;margin:auto;padding:70px 24px;color:#6d7681}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}.pricing{grid-template-columns:1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}.actions{flex-direction:column}.hero p{font-size:17px}}`;
}
