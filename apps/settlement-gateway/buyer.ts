// Browser checkout uses the same paid endpoint as API buyers. Never send a
// license to the checkout provider or create a second payment after uncertainty.
const prefix = "/api/gateway/v1";
const checkout = prefix + "/checkout";
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verified fact receipt | XGuard Live</title><link rel="stylesheet" href="${checkout}.css"></head>
<body><main><nav><a href="/">XGuard Live</a> <a href="/topics">Browse free facts</a></nav>
<h1>Get a verified fact receipt</h1>
<p>Choose a published fact to receive a verified result, its primary source, the response hash, and a payment receipt. The public fact remains free to read.</p>
<label for="fact">XGuard fact link</label>
<input id="fact" type="text" value="/fact/npm/react/latest-version" maxlength="512" spellcheck="false" autocomplete="off">
<div class="methods">
<section><h2>Pay with credits</h2><p>Use <strong>1 credit</strong> per receipt. Buy credits by card through Lemon Squeezy, then use the license from your purchase.</p>
<p><a href="https://credits.xguardgate.com/" target="_blank" rel="noopener noreferrer">Buy credits ↗</a></p>
<label for="license">XGuard license key</label>
<input id="license" type="password" autocomplete="off" maxlength="200">
<button type="button" id="credit">Use 1 credit</button></section>
<section><h2>Pay with USDC</h2><p>Pay <strong>0.001 USDC</strong> on Base from your own wallet. Review the amount and recipient before approving the payment.</p>
<button type="button" id="base">Pay 0.001 USDC</button></section>
</div>
<p id="status" role="status" aria-live="polite"></p>
<section id="result" hidden><h2>Verification receipt</h2>
<p><a id="chain" hidden rel="noopener noreferrer">View transaction on BaseScan ↗</a></p>
<p><button type="button" id="download">Download receipt JSON</button></p>
<pre id="details"></pre></section>
<p><a href="${prefix}/catalog">API pricing and usage</a> · <a href="/refund-policy">Refund policy</a></p>
<noscript>Enable JavaScript to use this checkout, or use the API directly.</noscript>
</main><script src="${checkout}.js" defer></script></body></html>`;

const css = `*{box-sizing:border-box}body{margin:0;background:#f6f7f3;color:#182920;font:16px/1.55 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:32px 20px 56px}nav{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:28px}h1{font-size:clamp(30px,7vw,46px);line-height:1.12;margin:0 0 12px}h2{font-size:20px;margin:0}a{color:#24583f;text-underline-offset:4px}label{display:block;margin:12px 0 4px;font-weight:600}input,button{font:inherit;padding:10px;border-radius:6px}input{width:100%;border:1px solid #829589;background:white;color:#182920}button{margin-top:10px;border:0;background:#24583f;color:white;cursor:pointer}button:disabled{opacity:.55;cursor:default}.methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:20px}section{padding:16px;background:white;border:1px solid #dce3db;border-radius:8px}pre{overflow:auto;font-size:13px}#status{min-height:24px}`;

const script = String.raw`
(() => {
"use strict";
const byId = id => document.getElementById(id);
const fact = byId("fact"), license = byId("license"), status = byId("status");
const credit = byId("credit"), base = byId("base"), result = byId("result"), chain = byId("chain");
const prefix = "/api/gateway/v1";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
const decode = value => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (resource, headers = {}) => fetch(resource, { headers, redirect: "error",
  credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(25000) });
const errorText = {
  lemon_license_not_authorized: "This license is not active. Use the license from your XGuard credit purchase.",
  insufficient: "This license is out of credits.",
  fact_not_currently_verified: "This fact is not currently verified. No new payment was taken.",
  origin_result_unavailable: "This fact is unavailable. No new payment was taken.",
};
let busy = false, receipt, completedPath;

function factPath(input) {
  const url = new URL(input.trim(), location.origin);
  if (url.origin !== location.origin || url.username || url.password || url.hash ||
      (url.search && url.search !== "?format=json") || url.pathname.length > 490 ||
      !/^\/fact\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}(?:\/[@A-Za-z0-9][A-Za-z0-9_.-]{0,95}){1,8}$/.test(url.pathname)) {
    throw new Error("Enter a fact link from xguardgate.com.");
  }
  return url.pathname;
}
try {
  const selected = new URL(location.href).searchParams.get("fact");
  if (selected) fact.value = factPath(selected);
} catch { /* Keep the default fact if the incoming URL is invalid. */ }

async function authorize(resource) {
  const wallet = window.ethereum;
  if (!wallet?.request) throw new Error("Open this page in a browser with a Base wallet.");
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (typeof from !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error("No valid wallet address was returned.");
  if (BigInt(await wallet.request({ method: "eth_chainId" })) !== 8453n) throw new Error("Select Base in your wallet, then try again.");
  const id = "checkout-" + crypto.randomUUID();
  const first = await request(resource, { "Idempotency-Key": id });
  if (first.status !== 402) throw new Error("A payment offer is unavailable.");
  const offer = decode(first.headers.get("Payment-Required") || "");
  const accepted = offer.accepts?.[0];
  if (offer.x402Version !== 2 || offer.resource?.url !== resource || accepted?.scheme !== "exact" ||
      accepted?.network !== "eip155:8453" || accepted?.asset?.toLowerCase() !== usdc ||
      accepted?.amount !== "1000" || accepted?.extra?.name !== "USD Coin" ||
      accepted?.extra?.version !== "2" || !/^0x[0-9a-fA-F]{40}$/.test(accepted?.payTo ?? "") ||
      from.toLowerCase() === accepted.payTo.toLowerCase() ||
      !Number.isSafeInteger(accepted?.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 60) {
    throw new Error("The offer did not match the displayed price and network.");
  }
  const seconds = Math.floor(Date.now() / 1000);
  const authorization = { from, to: accepted.payTo, value: "1000", validAfter: String(seconds - 15),
    validBefore: String(seconds + Math.min(240, accepted.maxTimeoutSeconds)), nonce: "0x" + hex(crypto.getRandomValues(new Uint8Array(32))) };
  const typed = {
    types: {
      EIP712Domain: [{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
      TransferWithAuthorization: [{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
        {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}],
    },
    domain: {name:"USD Coin",version:"2",chainId:8453,verifyingContract:accepted.asset},
    primaryType: "TransferWithAuthorization",
    message: authorization,
  };
  status.textContent = "Review the payment of 0.001 USDC to " + accepted.payTo + " in your wallet.";
  const signature = await wallet.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typed)] });
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("This checkout requires a Base wallet with EIP-712 support.");
  return { id, proof: encode({ x402Version: 2, resource: offer.resource, accepted, payload: { authorization, signature } }) };
}

function show(receipt) {
  const source = receipt.verification.source.fact;
  result.hidden = false;
  const payment = receipt.payment;
  chain.hidden = !payment.transaction;
  if (payment.transaction) chain.href = "https://basescan.org/tx/" + payment.transaction;
  else chain.removeAttribute("href");
  byId("details").textContent = JSON.stringify({ fact: source.id, value: source.current_value,
    verified_at: source.verified_at, source: source.source_url, response_sha256: receipt.verification.source_body_sha256,
    payment }, null, 2);
}

async function pay(rail) {
  if (busy) return;
  busy = true; base.disabled = credit.disabled = fact.disabled = license.disabled = true;
  status.textContent = "";
  try {
    const path = factPath(fact.value);
    if (path === completedPath) return;
    const resource = location.origin + prefix + path;
    const credential = rail === "lemon" ? license.value.trim() : "";
    if (rail === "lemon" && !/^[A-Za-z0-9_-]{20,200}$/.test(credential)) throw new Error("Enter your XGuard license key.");
    const credentialHash = rail === "lemon"
      ? hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential)))) : null;
    const key = "xguard-checkout-v1:" + path;
    let order = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!order && path === "/fact/npm/react/latest-version") {
      // Recover a request already signed on the previous single-fact page.
      const oldKey = "xguard-base-single-settlement-v1";
      const previous = JSON.parse(sessionStorage.getItem(oldKey) || "null");
      if (previous?.id && previous.proof) {
        order = { rail: "base", id: previous.id, proof: previous.proof };
        sessionStorage.setItem(key, JSON.stringify(order));
        sessionStorage.removeItem(oldKey);
      }
    }
    if (order && order.rail !== rail) throw new Error("Resume the pending payment with its original payment method.");
    if (order && rail === "lemon" && order.credentialHash !== credentialHash) {
      throw new Error("Enter the same license used to start this payment.");
    }
    const browserUrl = new URL(location.href);
    browserUrl.searchParams.set("fact", path);
    history.replaceState(null, "", browserUrl);
    if (!order) {
      order = rail === "base" ? { rail, ...await authorize(resource) }
        : { rail, id: "checkout-" + crypto.randomUUID(), credentialHash };
      sessionStorage.setItem(key, JSON.stringify(order));
    }
    const headers = { "Idempotency-Key": order.id, ...(rail === "base"
      ? { "Payment-Signature": order.proof } : { Authorization: "Bearer " + credential }) };
    for (let attempt = 0; attempt < (rail === "base" ? 12 : 3); attempt++) {
      status.textContent = "Checking your payment and preparing the receipt…";
      const response = await request(resource, headers);
      if (response.ok) {
        const verification = await response.json();
        const payment = rail === "base" ? decode(response.headers.get("Payment-Response") || "")
          : { rail, receipt: response.headers.get("X-XGuard-Billing-Receipt"), credits: 1 };
        if (verification.operation !== "validate_live_fact" || verification.resource !== resource ||
            verification.source?.fact?.id !== path.slice(6) ||
            (rail === "base" ? payment.success !== true || payment.network !== "eip155:8453" ||
              !/^0x[0-9a-fA-F]{64}$/.test(payment.transaction) : !/^xga_[a-f0-9]{24}$/.test(payment.receipt))) {
          throw new Error("The receipt could not be read. Resume the same request.");
        }
        receipt = { verification, payment };
        show(receipt);
        completedPath = path;
        sessionStorage.removeItem(key);
        license.value = "";
        status.textContent = "Payment accepted. Your verification receipt is ready.";
        return;
      }
      const failure = await response.json().catch(() => ({}));
      if (response.status === 503) {
        await pause(5000);
        continue;
      }
      // Only errors known to precede debit can clear a pending order.
      if (Object.hasOwn(errorText, failure.error) && (rail === "lemon" || response.status === 502)) {
        sessionStorage.removeItem(key);
      }
      throw new Error(errorText[failure.error] || "The payment did not complete (" + response.status + "). Use the same payment method to resume.");
    }
    throw new Error("Payment confirmation is pending. Use the same payment button to resume.");
  } catch (error) {
    status.textContent = typeof error?.message === "string" ? error.message : "The payment could not be completed.";
  } finally {
    busy = false; fact.disabled = license.disabled = false;
    refreshButtons();
  }
}
function refreshButtons() {
  let alreadyDelivered = false;
  try { alreadyDelivered = factPath(fact.value) === completedPath; } catch { /* The next click explains invalid input. */ }
  base.disabled = credit.disabled = busy || alreadyDelivered;
}
fact.addEventListener("input", refreshButtons);
credit.addEventListener("click", () => pay("lemon"));
base.addEventListener("click", () => pay("base"));
byId("download").addEventListener("click", () => {
  if (!receipt) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "xguard-verification-receipt.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
})();
`;

export function buyerAsset(path: string, search: string): Response | undefined {
  const common = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (path === prefix + "/test-base" && !search) return new Response(null, { status: 308,
    headers: { ...common, Location: checkout } });
  if (path === checkout) return new Response(page, { headers: { ...common,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
  if (path === checkout + ".js" && !search) return new Response(script, { headers: { ...common,
    "Content-Type": "application/javascript; charset=utf-8" } });
  if (path === checkout + ".css" && !search) return new Response(css, { headers: { ...common,
    "Content-Type": "text/css; charset=utf-8" } });
  return undefined;
}
