const GITHUB = "https://github.com/moelayyan90/XGuard";
const BAM = "https://bam.dev/";
const ACE_DISCUSSION = "https://forum.bam.dev/t/brainstorming-paths-to-ace-on-bam/28";

const SPEC = Object.freeze({
  name: "XGuard ACE",
  status: "bam-early-access-candidate",
  purpose: "Deterministic stale-quote protection for opt-in Solana applications on BAM",
  primitive: "application-speed-bump",
  policy: {
    default: "normal-path",
    enrolled_program: "delay-unless-explicit-top-level-bypass-marker",
    cpi_or_indirect_reference: "delay",
    composition: "maximum-delay-wins",
    delay_range_ms: [10, 50]
  },
  critical_path_ai: false,
  telemetry_collection: false,
  repository: GITHUB,
  bam: BAM,
  design_basis: ACE_DISCUSSION
});

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff"
    }
  });
}

function html() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard ACE — Deterministic Stale-Quote Protection for BAM</title>
<meta name="description" content="XGuard ACE is a deterministic application speed-bump policy engine designed for BAM Application Controlled Execution on Solana.">
<style>
:root{color-scheme:dark;--bg:#08090b;--panel:#111318;--line:#252a33;--text:#f4f6f8;--muted:#9ba4b1;--accent:#b7ff4a;--max:1120px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}main,nav,footer{width:min(calc(100% - 40px),var(--max));margin:auto}nav{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-weight:800;letter-spacing:.08em}.tag{font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);border:1px solid #385018;padding:7px 10px;border-radius:999px}.hero{padding:110px 0 76px;max-width:900px}h1{font-size:clamp(46px,7vw,92px);line-height:.95;letter-spacing:-.055em;margin:0 0 28px}.lead{font-size:clamp(19px,2.2vw,27px);color:var(--muted);max-width:760px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 0 90px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px}.card b{display:block;font-size:18px;margin-bottom:9px}.card p{margin:0;color:var(--muted)}.flow{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:70px 0}.flow pre{white-space:pre-wrap;margin:0;font:clamp(14px,1.8vw,20px)/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8dde5}.status{padding:80px 0}.status h2{font-size:34px;margin:0 0 16px}.status p{color:var(--muted);max-width:760px}.links{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.btn{display:inline-block;text-decoration:none;border:1px solid var(--line);padding:11px 15px;border-radius:10px}.primary{background:var(--accent);color:#101408;border-color:var(--accent);font-weight:750}footer{padding:30px 0 50px;color:var(--muted);border-top:1px solid var(--line)}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:72px}nav .tag{display:none}}
</style>
</head>
<body>
<nav><div class="brand">XGUARD / ACE</div><div class="tag">BAM EARLY-ACCESS CANDIDATE</div></nav>
<main>
<section class="hero"><h1>Protect market makers from stale-quote flow.</h1><p class="lead">A deterministic ACE policy engine for BAM: enrolled applications can delay protected taker flow while explicitly marked maker, oracle, liquidation, or health-critical instructions stay on the fast path.</p></section>
<section class="grid">
<div class="card"><b>Opt-in only</b><p>Unknown programs remain on BAM's normal scheduling path. XGuard only applies rules to explicitly enrolled applications.</p></div>
<div class="card"><b>Deterministic</b><p>No LLM or probabilistic model in the critical path. The same transaction and policy always produce the same decision.</p></div>
<div class="card"><b>Composable</b><p>If one transaction matches several enrolled programs, the maximum configured delay wins instead of creating a bypass through composition.</p></div>
</section>
<section class="flow"><pre>transaction
   ↓
BAM router
   ↓
XGuard policy
   ├─ unknown program → normal path
   ├─ explicit bypass marker → normal path
   └─ protected / indirect flow → 10–50ms delay
   ↓
BAM scheduler</pre></section>
<section class="status"><h2>Built for review, not marketing claims.</h2><p>The repository contains the Rust policy engine, fixture-driven simulator, invariants, security model, and the exact early-access integration boundary. Production BAM activation still requires the official ACE integration path.</p><div class="links"><a class="btn primary" href="${GITHUB}">Review the code</a><a class="btn" href="${ACE_DISCUSSION}">BAM ACE design basis</a><a class="btn" href="/spec.json">Machine-readable spec</a></div></section>
</main>
<footer>XGuard ACE · Apache-2.0 · deterministic scheduling policy research for BAM</footer>
</body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/healthz") {
      return json({ status: "ok", service: "XGuard ACE", mode: "bam-early-access-candidate" });
    }
    if (url.pathname === "/spec.json") return json(SPEC);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/.well-known/security.txt") {
      return new Response(`Contact: mailto:mo.elayyan2023@gmail.com\nCanonical: https://xguardgate.com/.well-known/security.txt\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return html();
    return json({ error: "not_found" }, 404);
  }
};
