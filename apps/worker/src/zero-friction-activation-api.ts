import {
  XGuardError,
  parseJsonStrict,
  readHttpBodyTextCapped,
  sha256Hex,
} from "@xguard/core/edge";
import {
  claimZeroFrictionMerchant,
  createZeroFrictionClaimChallenge,
  type ZeroFrictionClaimEnv,
} from "./zero-friction-claim.js";
import {
  zeroFrictionAccountOrNull,
  type ZeroFrictionPricingTerms,
} from "./zero-friction-billing.js";

const MAX_JSON_BYTES = 16 * 1024;

export interface ZeroFrictionActivationEnv extends ZeroFrictionClaimEnv {
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  XGUARD_PRICING_VERSION?: string;
  XGUARD_FEE_BPS?: string;
  XGUARD_FEE_CAP_MICRO_USD?: string;
  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;
}

export async function zeroFrictionActivationResponse(
  request: Request,
  env: ZeroFrictionActivationEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    (url.pathname === "/start" || url.pathname === "/quickstart")
  )
    return secure(startPage(url.origin, currentTerms(env)));

  if (
    request.method === "OPTIONS" &&
    (url.pathname === "/v1/activate/challenge" ||
      url.pathname === "/v1/activate")
  )
    return secure(
      new Response(null, {
        status: 204,
        headers: corsHeaders(),
      }),
    );

  if (request.method === "POST" && url.pathname === "/v1/activate/challenge")
    return secure(
      await protectedActivation(request, env, async () => {
        const body = await jsonBody(request);
        const payTo = typeof body.payTo === "string" ? body.payTo : "";
        const challenge = await createZeroFrictionClaimChallenge(
          env,
          payTo,
          currentTerms(env),
        );
        return json({
          ...challenge,
          activation: "sign-once",
          facilitatorUrl: url.origin,
          accountRequired: false,
          apiKeyRequired: false,
          prepaymentRequired: false,
        });
      }),
    );

  if (request.method === "POST" && url.pathname === "/v1/activate")
    return secure(
      await protectedActivation(request, env, async () => {
        const body = await jsonBody(request);
        const account = await claimZeroFrictionMerchant(env, {
          payTo: typeof body.payTo === "string" ? body.payTo : "",
          nonce: typeof body.nonce === "string" ? body.nonce : "",
          signature: typeof body.signature === "string" ? body.signature : "",
        });
        return json({
          activated: true,
          payTo: account.payTo,
          facilitatorUrl: url.origin,
          pricing: pricingJson(account),
          next: `Point the standard x402 facilitator client at ${url.origin}. No API key is required.`,
        });
      }),
    );

  if (request.method === "GET" && url.pathname === "/v1/activate/status") {
    try {
      const payTo = url.searchParams.get("payTo") ?? "";
      const account = await zeroFrictionAccountOrNull(env.DB, payTo);
      return secure(
        json({
          activated: account !== null,
          ...(account === null
            ? { payTo }
            : { payTo: account.payTo, pricing: pricingJson(account) }),
        }),
      );
    } catch (error) {
      return secure(errorResponse(error));
    }
  }

  return null;
}

function currentTerms(env: ZeroFrictionActivationEnv): ZeroFrictionPricingTerms {
  return {
    pricingVersion: env.XGUARD_PRICING_VERSION ?? "2026-08-zero-friction-v1",
    feeBps: boundedInteger(env.XGUARD_FEE_BPS ?? "50", 0, 10_000, "XGUARD_FEE_BPS"),
    feeCapMicroUsd: boundedInteger(
      env.XGUARD_FEE_CAP_MICRO_USD ?? "1000",
      0,
      1_000_000_000,
      "XGUARD_FEE_CAP_MICRO_USD",
    ),
    postpaidLimitMicroUsd: boundedInteger(
      env.XGUARD_POSTPAID_LIMIT_MICRO_USD ?? "1000000",
      1,
      1_000_000_000,
      "XGUARD_POSTPAID_LIMIT_MICRO_USD",
    ),
  };
}

async function protectedActivation(
  request: Request,
  env: ZeroFrictionActivationEnv,
  run: () => Promise<Response>,
): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "anonymous";
  const path = new URL(request.url).pathname;
  try {
    const [client, global] = await Promise.all([
      env.REQUEST_RATE_LIMITER.limit({ key: `activate:${path}:${sha256Hex(ip)}` }),
      env.GLOBAL_RATE_LIMITER.limit({ key: `activate:${path}` }),
    ]);
    if (!client.success || !global.success)
      return json({ error: "rate_limit_exceeded" }, 429, { "Retry-After": "60" });
  } catch {
    return json({ error: "protection_unavailable" }, 503);
  }

  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  const parsed = parseJsonStrict(
    await readHttpBodyTextCapped(request, MAX_JSON_BYTES, "activation JSON body"),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new XGuardError("BAD_REQUEST", "JSON body must be an object", 400);
  return parsed as Record<string, unknown>;
}

function pricingJson(terms: ZeroFrictionPricingTerms) {
  return {
    version: terms.pricingVersion,
    feeBps: terms.feeBps,
    feePercent: `${terms.feeBps / 100}%`,
    feeCapMicroUsd: terms.feeCapMicroUsd,
    feeCapUsd: microUsdToUsd(terms.feeCapMicroUsd),
    postpaidLimitMicroUsd: terms.postpaidLimitMicroUsd,
    postpaidLimitUsd: microUsdToUsd(terms.postpaidLimitMicroUsd),
    chargedEvent: "independently_finalized_successful_settlement",
    verifyFeeUsd: "0",
    failedSettlementFeeUsd: "0",
    idempotentRetryAdditionalFeeUsd: "0",
  };
}

function startPage(origin: string, terms: ZeroFrictionPricingTerms): Response {
  const pricing = pricingJson(terms);
  const escapedOrigin = JSON.stringify(origin);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activate XGuard</title>
<style>body{margin:0;background:#080b10;color:#f5f7fb;font:16px/1.55 system-ui,sans-serif}.wrap{max-width:720px;margin:64px auto;padding:24px}.card{border:1px solid #273041;background:#10151d;border-radius:18px;padding:28px}.muted{color:#9aa8ba}.terms{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}.term{padding:14px;border-radius:12px;background:#0a0e14;border:1px solid #212936}.big{font-size:24px;font-weight:750}button{width:100%;padding:14px;border:0;border-radius:12px;font-weight:750;font-size:16px;cursor:pointer}code{word-break:break-all}.ok{color:#7ee787}.err{color:#ff7b72}@media(max-width:600px){.terms{grid-template-columns:1fr}}</style></head>
<body><main class="wrap"><div class="card"><h1>Activate XGuard once</h1><p class="muted">No account. No email. No password. No API key. No prepaid balance. Sign one wallet message proving you control the merchant <code>payTo</code> address and accepting the exact pricing below.</p>
<div class="terms"><div class="term"><div class="muted">Service share</div><div class="big">${pricing.feePercent}</div><div class="muted">only on finalized success</div></div><div class="term"><div class="muted">Maximum fee</div><div class="big">$${pricing.feeCapUsd}</div><div class="muted">per settlement</div></div><div class="term"><div class="muted">Verify / failure / retry</div><div class="big">$0</div></div><div class="term"><div class="muted">Pay before first use</div><div class="big">No</div><div class="muted">postpaid limit $${pricing.postpaidLimitUsd}</div></div></div>
<button id="activate">Connect wallet & sign once</button><p id="status" class="muted"></p><div id="done" hidden><h2 class="ok">Activated</h2><p>Use this standard facilitator URL:</p><p><code>${origin}</code></p><p class="muted">That is all. Your x402 server does not need an XGuard API key.</p></div></div></main>
<script>
const origin=${escapedOrigin};
const button=document.getElementById('activate');const status=document.getElementById('status');const done=document.getElementById('done');
button.addEventListener('click',async()=>{try{if(!window.ethereum)throw new Error('No EVM wallet provider found');button.disabled=true;status.className='muted';status.textContent='Connecting wallet…';const accounts=await ethereum.request({method:'eth_requestAccounts'});const payTo=accounts[0];if(!payTo)throw new Error('Wallet did not return an address');status.textContent='Preparing the exact terms for signature…';const c=await fetch(origin+'/v1/activate/challenge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payTo})});const challenge=await c.json();if(!c.ok)throw new Error(challenge.message||challenge.error||'Could not create activation challenge');status.textContent='Please sign the message in your wallet. This is not a token transfer.';const signature=await ethereum.request({method:'personal_sign',params:[challenge.message,payTo]});const r=await fetch(origin+'/v1/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payTo,nonce:challenge.nonce,signature})});const result=await r.json();if(!r.ok)throw new Error(result.message||result.error||'Activation failed');status.textContent='';done.hidden=false;button.hidden=true;}catch(e){status.className='err';status.textContent=e&&e.message?e.message:String(e);button.disabled=false;}});
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${field}_invalid`);
  return parsed;
}

function microUsdToUsd(value: number): string {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction}`;
}

function errorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "activation_failed";
  const status =
    code.includes("signature_invalid") ? 401 :
    code.includes("already_used") || code.includes("mismatch") || code.includes("raced") ? 409 :
    code.includes("invalid") || code.includes("expired") || code.includes("not_found") ? 400 : 500;
  return json(
    {
      error: code.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      message:
        status === 500
          ? "XGuard could not safely activate this merchant wallet"
          : code,
    },
    status,
  );
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function json(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
