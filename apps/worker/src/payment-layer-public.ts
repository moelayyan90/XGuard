const PAYMENT_LAYER_VERSION = "0.2.1";
const RELEASE_TAG = `xguard-payment-layer-v${PAYMENT_LAYER_VERSION}`;
const RELEASE_ASSET = `xguard-payment-layer-${PAYMENT_LAYER_VERSION}.zip`;

export function paymentLayerPublicResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  if (
    url.pathname !== "/" &&
    url.pathname !== "/payment-layer" &&
    url.pathname !== "/install" &&
    url.pathname !== "/.well-known/xguard/payment-layer.json"
  ) {
    return null;
  }

  const origin = url.origin;
  const headOnly = request.method === "HEAD";

  if (url.pathname === "/.well-known/xguard/payment-layer.json") {
    const body = JSON.stringify(paymentLayerMetadata(origin));
    return new Response(headOnly ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (url.pathname === "/" && !acceptsHtml(request)) {
    const body = JSON.stringify(paymentLayerMetadata(origin));
    return new Response(headOnly ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const html =
    url.pathname === "/install" ? installPage(origin) : landingPage(origin);
  return new Response(headOnly ? null : html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

function paymentLayerMetadata(origin: string): Record<string, unknown> {
  return {
    name: "XGuard Payment Layer",
    version: PAYMENT_LAYER_VERSION,
    product: "universal-payment-control-layer",
    primaryUse:
      "buyer-side payment memory and control across HTTPS payment and transfer surfaces",
    merchantIntegrationRequiredForBrowserLayer: false,
    capabilities: [
      "inline-payment-rail",
      "defer-for-payment",
      "pay-this-only",
      "pay-all-bills",
      "saved-payee-memory",
      "payment-history",
      "split-bills",
    ],
    surfaces: {
      install: `${origin}/install`,
      paymentLayer: `${origin}/payment-layer`,
      paymentLayerManifest: `${origin}/.well-known/xguard/payment-layer.json`,
      apiDocs: `${origin}/docs`,
      openapi: `${origin}/openapi.json`,
      mcp: `${origin}/mcp`,
      x402Adapter: `${origin}/.well-known/x402/facilitator.json`,
      protocols: `${origin}/.well-known/xguard/protocols.json`,
    },
    adapters: [
      "browser-payment-surface",
      "http",
      "openapi",
      "mcp",
      "a2a",
      "x402",
      "webhook",
    ],
    x402Role: "adapter-and-settlement-safety-path-not-product-boundary",
    repository: "https://github.com/moelayyan90/XGuard",
  };
}

function landingPage(origin: string): string {
  const downloadUrl = releaseAssetUrl();
  const metadata = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "XGuard Payment Layer",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Chromium browsers and Web",
    softwareVersion: PAYMENT_LAYER_VERSION,
    description:
      "A buyer-side payment control layer that appears beside payment and transfer actions, remembers payees, defers bills, coordinates Pay All sessions and supports bill splitting without merchant integration.",
    url: origin,
    codeRepository: "https://github.com/moelayyan90/XGuard",
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f7f8fa">
  <title>XGuard Payment Layer — One layer across payment surfaces</title>
  <meta name="description" content="XGuard appears beside payment and transfer actions so you can defer bills, remember payees, Pay All, split bills and reuse recipients without requiring merchant integration.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate" type="application/json" href="${origin}/.well-known/xguard/payment-layer.json" title="XGuard Payment Layer metadata">
  <script type="application/ld+json">${metadata}</script>
  ${styles()}
</head>
<body>
  <header><div class="shell nav"><a class="brand" href="/"><img src="/favicon.svg" alt="" width="30" height="30"><b>XGuard</b></a><nav><a href="#how">How it works</a><a href="#modes">Where it fits</a><a href="/docs">Developer API</a><a href="/status">Status</a><a class="primary small" href="/install">Install</a></nav></div></header>
  <main>
    <section class="shell hero">
      <div class="eyebrow">XGUARD PAYMENT LAYER · v${PAYMENT_LAYER_VERSION}</div>
      <h1>One payment layer.<br><span>Wherever the payment happens.</span></h1>
      <p class="lead">XGuard is not an x402-only product. Its primary buyer-side layer can appear beside detected payment and transfer actions, remember who you pay, defer payments, coordinate multiple bills and split them — without requiring the merchant to integrate XGuard.</p>
      <div class="actions"><a class="primary" href="/install">Install Payment Layer</a><a class="secondary" href="${downloadUrl}">Direct ZIP</a></div>
      <div class="facts"><span>Works across HTTPS payment surfaces</span><span>No merchant integration for browser layer</span><span>Payment credentials stay with the underlying provider</span></div>
    </section>

    <section id="how" class="shell section">
      <div class="kicker">THE CORE PRODUCT</div><h2>Controls that travel with the payer.</h2>
      <div class="grid four">
        <article><b>ترحيل لغايات الدفع</b><h3>Defer for payment</h3><p>Capture a payment while you are already on its real payment surface and keep it in your local payment queue.</p></article>
        <article><b>دفع كل الفواتير</b><h3>Pay all bills</h3><p>Coordinate a sequence of deferred payments instead of rebuilding the list from scratch every time.</p></article>
        <article><b>Saved payees</b><h3>Remember recipients</h3><p>Reuse previously seen payees and their last known payment destination rather than registering the same recipient repeatedly.</p></article>
        <article><b>تقسيم الفواتير</b><h3>Split bills</h3><p>Create child payments across saved payees while each underlying payment remains subject to its real bank, wallet or merchant rail.</p></article>
      </div>
    </section>

    <section class="band"><div class="shell"><strong>XGuard should sit beside the payment — not force the user into another XGuard website.</strong></div></section>

    <section id="modes" class="shell section">
      <div class="kicker">ONE PRODUCT, MULTIPLE ADAPTERS</div><h2>x402 is one integration path, not the boundary.</h2>
      <div class="grid three">
        <article class="accent"><small>PRIMARY</small><h3>Browser Payment Layer</h3><p>Buyer-side controls on normal HTTPS payment, billing, checkout, beneficiary and transfer surfaces.</p><a href="/install">Install →</a></article>
        <article><small>BUSINESS / AGENT</small><h3>Payment decision APIs</h3><p>HTTP, OpenAPI, MCP, A2A and webhook surfaces let software consult XGuard before or around payment activity.</p><a href="/openapi.json">OpenAPI →</a></article>
        <article><small>ADAPTER</small><h3>x402 settlement path</h3><p>x402 remains available for compatible resource servers that need settlement safety, finality and recovery.</p><a href="/.well-known/x402/facilitator.json">x402 manifest →</a></article>
      </div>
    </section>

    <section class="shell section split">
      <div><div class="kicker">WHY THIS MATTERS</div><h2>Demand should not depend on one protocol winning.</h2><p class="lead compact">The browser layer follows the user to the payment surface. Protocol-specific integrations stay available underneath, but they no longer define who XGuard is for.</p></div>
      <div class="panel"><b>Public discovery</b><a href="/.well-known/xguard/payment-layer.json">Payment Layer manifest</a><a href="/.well-known/xguard/protocols.json">Protocol adapters</a><a href="/mcp">MCP</a><a href="/openapi.json">OpenAPI</a><a href="/docs">Developer docs</a></div>
    </section>
  </main>
  <footer><div class="shell footer"><span>© XGuard</span><span>Payment control layer · protocol adapters · settlement safety</span><a href="https://github.com/moelayyan90/XGuard">GitHub</a></div></footer>
</body>
</html>`;
}

function installPage(origin: string): string {
  const downloadUrl = releaseAssetUrl();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install XGuard Payment Layer</title><meta name="description" content="Install the XGuard buyer-side payment control layer."><link rel="icon" type="image/svg+xml" href="/favicon.svg">${styles()}</head>
<body><header><div class="shell nav"><a class="brand" href="/"><img src="/favicon.svg" alt="" width="30" height="30"><b>XGuard</b></a><nav><a href="/">Home</a><a href="/docs">Developer API</a></nav></div></header>
<main class="shell install"><div class="eyebrow">EARLY ACCESS · v${PAYMENT_LAYER_VERSION}</div><h1>Install the Payment Layer.</h1><p class="lead compact">The public runtime package is built from the same repository and contains the browser-side universal layer, inline payment rail, service worker and minimal extension assets.</p>
<div class="actions"><a class="primary" href="${downloadUrl}">Download ZIP</a><a class="secondary" href="https://github.com/moelayyan90/XGuard/tree/main/browser-extension">Inspect source</a></div>
<div class="steps"><article><b>1</b><h3>Download and unzip</h3><p>Download the current XGuard Payment Layer ZIP and extract it to a folder.</p></article><article><b>2</b><h3>Open Extensions</h3><p>In a Chromium browser, open the extensions manager and enable developer mode for this early-access package.</p></article><article><b>3</b><h3>Load unpacked</h3><p>Select the extracted folder. XGuard can then detect supported payment and transfer surfaces on HTTPS pages.</p></article></div>
<p class="note">A browser-store submission kit is maintained in the repository. This page does not claim a Chrome Web Store or Edge Add-ons listing until one is actually published.</p>
<p><a href="${origin}/.well-known/xguard/payment-layer.json">Machine-readable Payment Layer metadata →</a></p>
</main></body></html>`;
}

function releaseAssetUrl(): string {
  return `https://github.com/moelayyan90/XGuard/releases/download/${RELEASE_TAG}/${RELEASE_ASSET}`;
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .includes("text/html");
}

function styles(): string {
  return `<style>
  :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#14171a;background:#f7f8fa;line-height:1.5}*{box-sizing:border-box}body{margin:0}a{color:inherit}header{position:sticky;top:0;z-index:10;background:rgba(247,248,250,.94);border-bottom:1px solid #e5e8eb;backdrop-filter:blur(14px)}.shell{width:min(1120px,calc(100% - 40px));margin:auto}.nav{height:68px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-size:18px}.nav nav{display:flex;gap:22px;align-items:center}.nav nav a{text-decoration:none;color:#58616a;font-size:14px}.hero{padding:108px 0 88px}.eyebrow,.kicker{font-size:12px;font-weight:800;letter-spacing:.13em;color:#66717b}.hero h1,.install h1{font-size:clamp(48px,7vw,82px);line-height:1.02;letter-spacing:-.055em;margin:18px 0 26px;max-width:980px}.hero h1 span{color:#68727c}.lead{font-size:20px;color:#59636c;max-width:820px}.lead.compact{max-width:680px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:34px 0}.primary,.secondary{display:inline-flex;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700}.primary{background:#f48120;color:#111}.primary.small{padding:9px 13px}.secondary{background:white;border:1px solid #d9dde1}.facts{display:flex;gap:22px;flex-wrap:wrap;color:#6c757d;font-size:13px}.section{padding:82px 0}.section h2{font-size:40px;letter-spacing:-.035em;margin:10px 0 30px}.grid{display:grid;gap:16px}.grid.four{grid-template-columns:repeat(4,1fr)}.grid.three{grid-template-columns:repeat(3,1fr)}article,.panel{background:#fff;border:1px solid #e2e5e8;border-radius:14px;padding:24px}article h3{margin:8px 0}article p{color:#68717a}.accent{border-color:#f0b47d;box-shadow:0 0 0 1px #f7d7b9 inset}article small{font-weight:800;color:#8a939c}.band{background:#15191d;color:#fff;padding:28px 0}.band strong{font-size:20px}.split{display:grid;grid-template-columns:1.5fr 1fr;gap:36px;align-items:start}.panel{display:flex;flex-direction:column;gap:12px}.panel a{color:#4f5962}.install{padding:100px 0}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:48px 0}.steps article b{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#f48120}.note{max-width:800px;background:#fff3e8;border:1px solid #ffd2aa;padding:15px;border-radius:10px;color:#685240}.footer{padding:34px 0;display:flex;justify-content:space-between;gap:18px;color:#76808a;font-size:13px;border-top:1px solid #e3e6e8}@media(max-width:850px){.nav nav a:not(.primary){display:none}.grid.four,.grid.three,.steps,.split{grid-template-columns:1fr}.hero{padding-top:72px}.section{padding:58px 0}.section h2{font-size:34px}.lead{font-size:18px}.footer{flex-direction:column}}
  </style>`;
}
