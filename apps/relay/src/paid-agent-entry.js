import app from "./product-entry.js";
export * from "./product-entry.js";

import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  canonicalize,
  createJWS,
  createOfferJWS,
  createReceiptJWS,
} from "@x402/extensions/offer-receipt";
import {
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  isValidPaymentId,
} from "@x402/extensions/payment-identifier";

const VERSION = "5.1.0";
const API = "https://api.xguardgate.com";
const SITE = "https://xguardgate.com";
const PROOF_KID = "did:web:api.xguardgate.com#xguard-proofrail";
const TOOL = "xguard.web.fetch";
const MAINNET = "eip155:8453";
const TESTNET = "eip155:84532";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TESTNET_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_PAY_TO = "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07";
const DEFAULT_PRICE_ATOMIC = "1000";
const HARD_MAX_BYTES = 131072;
const MAX_TOOL_REQUEST_BYTES = 16384;
const QUOTE_TTL_SECONDS = 300;
const PAYMENT_TIMEOUT_SECONDS = 300;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const ALLOWED_FINANCIAL_STATES = new Set(["pending", "verified", "settled", "succeeded", "failed", "ambiguous", "refunded", "credited"]);
const METRIC_EVENTS = new Set(["challenge", "verified", "settled", "succeeded", "replay", "verification_failed", "settlement_failed", "settlement_ambiguous", "upstream_failed", "credited"]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(value) {
  const text = String(value || "");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(value) {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function requestId(request) {
  const supplied = request.headers.get("x-request-id");
  if (supplied && /^[A-Za-z0-9_-]{8,128}$/.test(supplied)) return supplied;
  return `xgr_${crypto.randomUUID().replaceAll("-", "")}`;
}

function headers(extra = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-allow-headers": "content-type,payment-signature,x-xguard-quote,x-xguard-credit,x-request-id",
    "access-control-expose-headers": "payment-required,payment-response,x-xguard-request-id,x-xguard-payment-identifier,x-xguard-replay,x-xguard-proof,x-xguard-receipt,x-xguard-credit",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "x-xguard-version": VERSION,
    ...extra,
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: headers(extra) });
}

async function jsonBody(request, maxBytes = MAX_TOOL_REQUEST_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) return { error: "payload_too_large" };
  const text = await request.text();
  if (textEncoder.encode(text).byteLength > maxBytes) return { error: "payload_too_large" };
  try { return { value: JSON.parse(text) }; } catch { return { error: "invalid_json" }; }
}

function error(code, status, id, details = {}) {
  return json({
    error: { code, message: ERROR_MESSAGES[code] || code, retryable: Boolean(details.retryable), details: details.details || null },
    request_id: id,
  }, status, { "x-xguard-request-id": id });
}

const ERROR_MESSAGES = {
  invalid_json: "The request body is not valid JSON.",
  payload_too_large: "The request body exceeded the configured size limit.",
  invalid_input: "The tool input is invalid.",
  unsupported_tool: "The requested tool is not enabled.",
  quote_required: "A current signed XGuard quote is required before payment.",
  quote_invalid: "The signed quote is invalid or does not match this request.",
  quote_expired: "The signed quote has expired.",
  payment_required: "A valid x402 payment is required.",
  payment_payload_invalid: "The x402 payment payload is invalid or does not match the quote.",
  payment_identifier_conflict: "The payment identifier or authorization was already bound to a different request.",
  payment_verification_failed: "The facilitator rejected the payment authorization.",
  settlement_failed: "The payment was not settled.",
  settlement_ambiguous: "Settlement may have been broadcast, so execution is paused until reconciliation.",
  payment_not_configured: "The paid gateway is not safely configured.",
  rate_limited: "The request rate limit was exceeded.",
  target_not_public: "The target is not a permitted public HTTPS destination.",
  dns_unresolved: "The target did not resolve to a public address.",
  content_type_not_allowed: "The upstream content type is not supported.",
  upstream_too_large: "The upstream response exceeded the configured size limit.",
  upstream_timeout: "The upstream request timed out.",
  upstream_failed: "The upstream request failed after settlement; a reusable execution credit was issued.",
  credit_invalid: "The execution credit is invalid, expired, or already consumed.",
  not_found: "The requested XGuard resource was not found.",
};

function validAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || "")) && !/^0x0{40}$/i.test(String(value));
}

function positiveAtomic(value) {
  return /^[1-9][0-9]{0,8}$/.test(String(value || ""));
}

function gatewayConfig(env, testnet = false) {
  const network = testnet ? TESTNET : MAINNET;
  const asset = testnet ? TESTNET_USDC : MAINNET_USDC;
  const payTo = String((testnet ? env.XGUARD_TESTNET_PAY_TO : env.XGUARD_TREASURY_USDC_ADDRESS) || env.XGUARD_TREASURY_USDC_ADDRESS || DEFAULT_PAY_TO);
  const amount = String(env.XGUARD_WEB_FETCH_PRICE_ATOMIC || DEFAULT_PRICE_ATOMIC);
  const facilitator = String((testnet ? env.XGUARD_TESTNET_FACILITATOR : env.XGUARD_PAID_FACILITATOR) || env.XGUARD_PAID_FACILITATOR || env.X402_BASE_PRIMARY || "https://facilitator.xpay.sh").replace(/\/+$/, "");
  const marginMicros = Number(env.XGUARD_MARGIN_USD_MICROS || amount);
  const configured = validAddress(payTo) && positiveAtomic(amount) && /^https:\/\//.test(facilitator) && Number.isSafeInteger(marginMicros) && marginMicros >= 0 && marginMicros === Number(amount);
  return {
    configured,
    testnet,
    network,
    asset,
    payTo,
    amount,
    facilitator,
    upstreamCostMaxUsdMicros: 0,
    marginUsdMicros: marginMicros,
    customerPriceUsdMicros: Number(amount),
    resource: `${API}/v1/tools/web.fetch${testnet ? "/testnet" : ""}`,
  };
}

function capabilities(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    discovery: {
      mcp: `${API}/mcp`,
      a2a: `${API}/a2a`,
      agent_card: `${API}/.well-known/agent-card.json`,
      payment_manifest: `${API}/.well-known/payment-manifest`,
      openapi: `${API}/openapi.json`,
      llms: `${API}/llms.txt`,
    },
    tools: [
      { id: "xguard.capabilities", available: true, paid: false, endpoint: `${API}/v1/capabilities` },
      { id: "xguard.pricing.quote", available: true, paid: false, endpoint: `${API}/v1/pricing/quote` },
      {
        id: TOOL,
        available: mainnet.configured,
        paid: true,
        endpoint: mainnet.resource,
        testnet_endpoint: testnet.resource,
        network: mainnet.network,
        asset: "USDC",
        safety: ["https_only", "ssrf_guard", "dns_public_address_check", "manual_redirect_validation", "bounded_response", "timeout", "cache", "idempotent_payment"],
        unavailable_reason: mainnet.configured ? null : { code: "payment_not_configured", missing: ["valid receiving address", "positive price", "HTTPS facilitator"] },
      },
      { id: "xguard.web.search", available: false, paid: true, unavailable_reason: { code: "connector_not_configured", message: "No production search connector with funded or post-paid capacity is configured." } },
      { id: "xguard.ai.generate", available: false, paid: true, unavailable_reason: { code: "connector_not_configured", message: "No production inference connector with funded or post-paid capacity is configured." } },
      { id: "xguard.ai.route", available: false, paid: true, unavailable_reason: { code: "connector_not_configured", message: "No eligible inference routes are configured." } },
      { id: "xguard.data.query", available: false, paid: true, unavailable_reason: { code: "connector_not_configured", message: "No production data connector is configured." } },
    ],
    guarantees: {
      account_required: false,
      sdk_required: false,
      payment: "x402 v2 exact USDC",
      signed_quotes: true,
      signed_offers: true,
      signed_receipts: true,
      payment_identifier_required: true,
      replay_safe: true,
      proofrail: true,
      secretless_upstream_credentials: true,
    },
  };
}

function pricing(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return {
    version: VERSION,
    currency: "USDC",
    decimals: 6,
    free_tools: ["xguard.capabilities", "xguard.pricing.quote"],
    tools: {
      [TOOL]: {
        available: mainnet.configured,
        formula: "customer_price = maximum_upstream_cost + configured_xguard_margin",
        maximum_upstream_cost_usd_micros: 0,
        xguard_margin_usd_micros: mainnet.marginUsdMicros,
        customer_price_usd_micros: mainnet.customerPriceUsdMicros,
        amount_atomic: mainnet.amount,
        network: mainnet.network,
        asset: mainnet.asset,
        testnet: { network: testnet.network, asset: testnet.asset, amount_atomic: testnet.amount },
      },
    },
    quote_endpoint: `${API}/v1/pricing/quote`,
    quote_ttl_seconds: QUOTE_TTL_SECONDS,
  };
}

function proofStub(env) {
  return env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName("proofrail-root-v1"));
}

async function signerFor(env) {
  if (!env.PROOF_AUTHORITY) throw new Error("proof_authority_unavailable");
  return {
    kid: PROOF_KID,
    format: "jws",
    algorithm: "ES256",
    async sign(bytes) {
      const response = await proofStub(env).fetch("https://proofrail/sign-bytes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: b64url(bytes) }),
      });
      const body = await response.json();
      if (!response.ok || !body.signature) throw new Error("quote_signing_failed");
      return body.signature;
    },
  };
}

async function verifyJws(env, compact) {
  const parts = String(compact || "").split(".");
  if (parts.length !== 3 || parts.some(part => !part)) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(textDecoder.decode(unb64url(parts[0])));
    payload = JSON.parse(textDecoder.decode(unb64url(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "ES256" || header.kid !== PROOF_KID || !env.PROOF_AUTHORITY) return null;
  const response = await proofStub(env).fetch("https://proofrail/verify-bytes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: b64url(textEncoder.encode(`${parts[0]}.${parts[1]}`)), signature: parts[2] }),
  });
  const result = await response.json().catch(() => null);
  return response.ok && result?.valid === true ? payload : null;
}

function normalizeFetchInput(raw) {
  const source = raw?.input && typeof raw.input === "object" ? raw.input : raw;
  let target;
  try { target = new URL(String(source?.url || "")); } catch { return null; }
  if (target.protocol !== "https:" || target.username || target.password || target.hash) return null;
  const method = String(source?.method || "GET").toUpperCase();
  if (!new Set(["GET", "HEAD"]).has(method)) return null;
  const timeoutMs = Math.max(1000, Math.min(10000, Number(source?.timeout_ms || 8000)));
  const maxBytes = Math.max(1024, Math.min(HARD_MAX_BYTES, Number(source?.max_bytes || HARD_MAX_BYTES)));
  const mode = ["auto", "text", "json"].includes(source?.mode) ? source.mode : "auto";
  return { url: target.toString(), method, timeout_ms: Math.trunc(timeoutMs), max_bytes: Math.trunc(maxBytes), mode };
}

async function issueQuote(env, raw, id) {
  const tool = String(raw?.tool || TOOL);
  if (tool !== TOOL) return { response: error("unsupported_tool", 400, id) };
  const input = normalizeFetchInput(raw);
  if (!input) return { response: error("invalid_input", 400, id) };
  const targetCheck = await publicDns(new URL(input.url).hostname);
  if (!targetCheck.ok) return { response: error(targetCheck.code, targetCheck.code === "dns_unresolved" ? 422 : 403, id) };
  const config = gatewayConfig(env, raw?.testnet === true);
  if (!config.configured || !env.PROOF_AUTHORITY || !env.PAID_GATEWAY) return { response: error("payment_not_configured", 503, id) };
  const now = Math.floor(Date.now() / 1000);
  const inputDigest = await sha256(canonicalize(input));
  const quoteId = `xgq_${crypto.randomUUID().replaceAll("-", "")}`;
  const paymentIdentifier = `pay_${crypto.randomUUID().replaceAll("-", "")}`;
  const payload = {
    v: 1,
    typ: "xguard-price-quote",
    iss: API,
    aud: config.resource,
    quote_id: quoteId,
    payment_identifier: paymentIdentifier,
    tool: TOOL,
    input,
    input_digest: inputDigest,
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    pay_to: config.payTo,
    amount: config.amount,
    currency: "USDC",
    upstream_cost_max_usd_micros: config.upstreamCostMaxUsdMicros,
    xguard_margin_usd_micros: config.marginUsdMicros,
    customer_price_usd_micros: config.customerPriceUsdMicros,
    issued_at: now,
    expires_at: now + QUOTE_TTL_SECONDS,
  };
  const quote = await createJWS(payload, await signerFor(env));
  return { payload, quote, response: json({ quote, ...payload }, 200, { "x-xguard-request-id": id }) };
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224 || (a === 192 && b === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function isPrivateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return false;
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = value;
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
    normalized = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return true;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(part => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : -1);
  if (words.length !== 8 || words.some(word => word < 0)) return true;
  const unspecified = words.every(word => word === 0);
  const loopback = words.slice(0, 7).every(word => word === 0) && words[7] === 1;
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (mapped) return isPrivateIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  const globalUnicast = (words[0] & 0xe000) === 0x2000;
  const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
  return unspecified || loopback || !globalUnicast || documentation;
}

function hostnameAllowed(hostname) {
  const host = String(hostname || "").replace(/\.$/, "").toLowerCase();
  if (!host || host.length > 253 || host === "localhost" || !host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || host.endsWith(".home") || host.endsWith(".lan")) return false;
  if (host === "metadata.google.internal" || host === "metadata.azure.internal" || host.endsWith(".xguardgate.com") || host === "xguardgate.com") return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
  return true;
}

async function publicDns(hostname) {
  if (!hostnameAllowed(hostname)) return { ok: false, code: "target_not_public" };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) return { ok: true, addresses: [hostname] };
  const answers = [];
  for (const type of ["A", "AAAA"]) {
    const endpoint = new URL("https://cloudflare-dns.com/dns-query");
    endpoint.searchParams.set("name", hostname);
    endpoint.searchParams.set("type", type);
    let response;
    try {
      response = await fetch(endpoint, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000), redirect: "error" });
    } catch {
      return { ok: false, code: "dns_unresolved" };
    }
    if (!response.ok) return { ok: false, code: "dns_unresolved" };
    const body = await response.json().catch(() => null);
    for (const answer of Array.isArray(body?.Answer) ? body.Answer : []) {
      if (answer.type === 1 || answer.type === 28) answers.push(String(answer.data || ""));
    }
  }
  if (!answers.length || answers.some(address => isPrivateIpv4(address) || isPrivateIpv6(address))) return { ok: false, code: answers.length ? "target_not_public" : "dns_unresolved" };
  return { ok: true, addresses: answers };
}

function allowedContentType(value) {
  const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return type.startsWith("text/") || type === "application/json" || type.endsWith("+json") || type === "application/xml" || type.endsWith("+xml") || type === "application/javascript";
}

async function readBounded(response, maxBytes) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length && length > maxBytes) throw Object.assign(new Error("upstream_too_large"), { code: "upstream_too_large" });
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error("upstream_too_large"), { code: "upstream_too_large" });
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function performWebFetch(input) {
  const cacheKeyHash = await sha256(canonicalize(input));
  const cacheKey = new Request(`${API}/__cache/web-fetch/${cacheKeyHash}`, { method: "GET" });
  const cache = globalThis.caches?.default;
  if (cache && input.method === "GET") {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const cached = await hit.json();
      return { ...cached, cache: "hit", served_at: new Date().toISOString() };
    }
  }

  let current = new URL(input.url);
  const redirects = [];
  const started = performance.now();
  let response;
  for (let hop = 0; hop <= 3; hop += 1) {
    const resolved = await publicDns(current.hostname);
    if (!resolved.ok) throw Object.assign(new Error(resolved.code), { code: resolved.code });
    try {
      response = await fetch(current, {
        method: input.method,
        headers: { accept: "application/json,text/plain,text/html,application/xml,text/xml;q=0.9,*/*;q=0.1", "user-agent": `XGuard-Web-Fetch/${VERSION}` },
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeout_ms),
      });
    } catch (cause) {
      const code = cause?.name === "TimeoutError" || cause?.name === "AbortError" ? "upstream_timeout" : "upstream_failed";
      throw Object.assign(new Error(code), { code });
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || hop === 3) throw Object.assign(new Error("unsafe_redirect"), { code: "upstream_failed" });
    const next = new URL(location, current);
    if (next.protocol !== "https:" || next.username || next.password || !hostnameAllowed(next.hostname)) throw Object.assign(new Error("unsafe_redirect"), { code: "target_not_public" });
    redirects.push({ from: current.origin + current.pathname, to: next.origin + next.pathname, status: response.status });
    current = next;
  }
  if (!response) throw Object.assign(new Error("upstream_failed"), { code: "upstream_failed" });
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (!allowedContentType(contentType)) throw Object.assign(new Error("content_type_not_allowed"), { code: "content_type_not_allowed" });
  const bytes = await readBounded(response, input.max_bytes);
  const text = textDecoder.decode(bytes);
  let parsed = null;
  if (input.mode === "json" || contentType.includes("json")) {
    try { parsed = JSON.parse(text); } catch { if (input.mode === "json") throw Object.assign(new Error("invalid_upstream_json"), { code: "upstream_failed" }); }
  }
  const retrievedAt = new Date().toISOString();
  const result = {
    tool: TOOL,
    requested_url: input.url,
    final_url: current.toString(),
    method: input.method,
    status: response.status,
    ok: response.ok,
    content_type: contentType,
    bytes: bytes.byteLength,
    body_sha256: await sha256(bytes),
    data: parsed ?? text,
    redirects,
    cache: "miss",
    latency_ms: Math.max(0, Math.round(performance.now() - started)),
    source: { url: current.toString(), retrieved_at: retrievedAt, transport: "https", dns_public_address_checked: true },
    trust: "untrusted_external_content",
  };
  if (cache && input.method === "GET" && response.ok) {
    const stored = new Response(JSON.stringify(result), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
    await cache.put(cacheKey, stored).catch(() => {});
  }
  return result;
}

function doJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function safeFinancialPatch(record, next, patch = {}) {
  if (!ALLOWED_FINANCIAL_STATES.has(next)) throw new Error("invalid_financial_state");
  const transitions = {
    pending: new Set(["verified", "failed", "ambiguous"]),
    verified: new Set(["settled", "failed", "ambiguous"]),
    ambiguous: new Set(["settled", "failed", "ambiguous"]),
    settled: new Set(["succeeded", "credited"]),
    credited: new Set(["succeeded", "credited"]),
    succeeded: new Set(["succeeded"]),
    failed: new Set(["failed"]),
    refunded: new Set(["refunded"]),
  };
  if (!transitions[record.status]?.has(next)) throw new Error("invalid_financial_transition");
  const updated = { ...record, ...patch, status: next, updated_at: new Date().toISOString() };
  if (next === "settled") {
    if (!patch.transaction || !patch.network) throw new Error("settlement_evidence_required");
    updated.settled_at = updated.updated_at;
    const economicallyReal = patch.network !== TESTNET;
    updated.gross_revenue_usd_micros = economicallyReal ? Number(record.customer_price_usd_micros || 0) : 0;
    updated.actual_upstream_cost_usd_micros = economicallyReal ? Number(record.maximum_upstream_cost_usd_micros || 0) : 0;
    updated.credit_liability_usd_micros = 0;
    updated.net_profit_usd_micros = updated.gross_revenue_usd_micros - updated.actual_upstream_cost_usd_micros;
    updated.revenue_source = economicallyReal ? "x402_settlement" : "testnet_settlement_non_revenue";
  } else if (!["succeeded", "credited"].includes(next) && !record.settled_at) {
    updated.gross_revenue_usd_micros = 0;
    updated.actual_upstream_cost_usd_micros = 0;
    updated.credit_liability_usd_micros = 0;
    updated.net_profit_usd_micros = 0;
    updated.revenue_source = null;
  }
  if (next === "credited") {
    if (!record.settled_at) throw new Error("credit_requires_settlement");
    updated.credit_liability_usd_micros = record.network === TESTNET ? 0 : Number(record.customer_price_usd_micros || 0);
    updated.net_profit_usd_micros = 0;
  }
  return updated;
}

export class PaidGatewayState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ping") return doJson({ ok: true, class: "PaidGatewayState", version: VERSION });
    if (request.method !== "POST") return doJson({ error: "method_not_allowed" }, 405);
    let body;
    try { body = await request.json(); } catch { return doJson({ error: "invalid_json" }, 400); }

    if (path === "/index/reserve") {
      if (!isValidPaymentId(body.payment_identifier) || !/^[a-f0-9]{64}$/.test(body.authorization_fingerprint) || !/^[a-f0-9]{64}$/.test(body.request_digest)) return doJson({ error: "invalid_reservation" }, 400);
      const key = `pid:${await sha256(body.payment_identifier)}`;
      const existing = await this.state.storage.get(key);
      if (existing) {
        const same = existing.authorization_fingerprint === body.authorization_fingerprint && existing.request_digest === body.request_digest;
        return same ? doJson({ ok: true, replay: true, record: existing }) : doJson({ error: "payment_identifier_conflict", record: { request_id: existing.request_id, status: existing.status } }, 409);
      }
      const record = {
        payment_identifier: body.payment_identifier,
        authorization_fingerprint: body.authorization_fingerprint,
        request_digest: body.request_digest,
        request_id: body.request_id,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      await this.state.storage.put(key, record);
      return doJson({ ok: true, replay: false, record });
    }

    if (path === "/index/finalize") {
      const key = `pid:${await sha256(body.payment_identifier)}`;
      const existing = await this.state.storage.get(key);
      if (!existing || existing.authorization_fingerprint !== body.authorization_fingerprint) return doJson({ error: "reservation_not_found" }, 404);
      const status = ALLOWED_FINANCIAL_STATES.has(body.status) ? body.status : existing.status;
      const record = { ...existing, status, updated_at: new Date().toISOString(), dead_letter: body.dead_letter === true };
      await this.state.storage.put(key, record);
      return doJson({ ok: true, record });
    }

    if (path === "/index/release") {
      const key = `pid:${await sha256(body.payment_identifier)}`;
      const existing = await this.state.storage.get(key);
      if (existing?.authorization_fingerprint === body.authorization_fingerprint && existing.status === "pending") await this.state.storage.delete(key);
      return doJson({ ok: true });
    }

    if (path === "/index/lookup") {
      const key = `pid:${await sha256(body.payment_identifier)}`;
      const record = await this.state.storage.get(key);
      return record ? doJson({ ok: true, record }) : doJson({ error: "not_found" }, 404);
    }

    if (path === "/index/rate") {
      const bucket = Math.floor(Date.now() / 60000);
      const key = `rate:${body.scope}:${body.subject_hash}:${bucket}`;
      const count = Number(await this.state.storage.get(key) || 0) + 1;
      await this.state.storage.put(key, count);
      const previous = `rate:${body.scope}:${body.subject_hash}:${bucket - 3}`;
      await this.state.storage.delete(previous);
      const limit = Math.max(1, Math.min(300, Number(body.limit || 30)));
      return doJson({ allowed: count <= limit, count, limit, retry_after_seconds: 60 - Math.floor((Date.now() % 60000) / 1000) }, count <= limit ? 200 : 429);
    }

    if (path === "/index/metric") {
      if (!METRIC_EVENTS.has(body.event)) return doJson({ error: "invalid_metric" }, 400);
      const current = await this.state.storage.get("metrics:v1") || { started_at: new Date().toISOString(), events: {}, settled_usd_micros: 0, latency_ms_total: 0, latency_samples: 0 };
      current.events[body.event] = Number(current.events[body.event] || 0) + 1;
      if (body.event === "settled") current.settled_usd_micros += Math.max(0, Number(body.amount_usd_micros || 0));
      if (body.event === "succeeded" && Number.isFinite(Number(body.latency_ms))) {
        current.latency_ms_total += Math.max(0, Number(body.latency_ms));
        current.latency_samples += 1;
      }
      current.updated_at = new Date().toISOString();
      await this.state.storage.put("metrics:v1", current);
      return doJson({ ok: true });
    }

    if (path === "/index/metrics") {
      const current = await this.state.storage.get("metrics:v1") || { started_at: new Date().toISOString(), events: {}, settled_usd_micros: 0, latency_ms_total: 0, latency_samples: 0 };
      return doJson({ ...current, average_success_latency_ms: current.latency_samples ? Math.round(current.latency_ms_total / current.latency_samples) : null });
    }

    if (path === "/index/credit-create") {
      const key = `credit:${await sha256(body.credit_id)}`;
      const existing = await this.state.storage.get(key);
      if (!existing) await this.state.storage.put(key, { ...body, status: "available", created_at: new Date().toISOString() });
      return doJson({ ok: true });
    }

    if (path === "/index/credit-consume") {
      const key = `credit:${await sha256(body.credit_id)}`;
      const existing = await this.state.storage.get(key);
      if (!existing || existing.status !== "available" || Date.parse(existing.expires_at) <= Date.now() || existing.tool !== body.tool || existing.amount !== body.amount) return doJson({ error: "credit_invalid" }, 409);
      const record = { ...existing, status: "reserved", reserved_by: body.request_id, updated_at: new Date().toISOString() };
      await this.state.storage.put(key, record);
      return doJson({ ok: true, record });
    }

    if (path === "/index/credit-finalize") {
      const key = `credit:${await sha256(body.credit_id)}`;
      const existing = await this.state.storage.get(key);
      if (!existing || existing.reserved_by !== body.request_id) return doJson({ error: "credit_invalid" }, 409);
      const status = body.success === true ? "consumed" : "available";
      await this.state.storage.put(key, { ...existing, status, reserved_by: null, updated_at: new Date().toISOString() });
      return doJson({ ok: true, status });
    }

    if (path === "/operation/begin") {
      const existing = await this.state.storage.get("operation");
      if (existing) {
        const same = existing.authorization_fingerprint === body.authorization_fingerprint && existing.payment_identifier === body.payment_identifier && existing.request_digest === body.request_digest;
        return same ? doJson({ ok: true, replay: true, record: existing }) : doJson({ error: "authorization_replay_conflict", record: { request_id: existing.request_id, status: existing.status } }, 409);
      }
      const now = new Date().toISOString();
      const record = {
        ...body,
        status: "pending",
        created_at: now,
        updated_at: now,
        gross_revenue_usd_micros: 0,
        actual_upstream_cost_usd_micros: 0,
        credit_liability_usd_micros: 0,
        net_profit_usd_micros: 0,
        revenue_source: null,
        reconciliation_attempts: 0,
      };
      await this.state.storage.put("operation", record);
      return doJson({ ok: true, replay: false, record });
    }

    if (path === "/operation/transition") {
      const existing = await this.state.storage.get("operation");
      if (!existing) return doJson({ error: "operation_not_found" }, 404);
      let record;
      try { record = safeFinancialPatch(existing, body.status, body.patch || {}); } catch (cause) { return doJson({ error: cause.message }, 409); }
      if (["failed", "settled"].includes(record.status)) delete record.payment_payload;
      await this.state.storage.put("operation", record);
      if (record.status === "ambiguous") await this.state.storage.setAlarm(Date.now() + 30000);
      return doJson({ ok: true, record });
    }

    if (path === "/operation/complete") {
      const existing = await this.state.storage.get("operation");
      if (!existing || !["settled", "credited"].includes(existing.status)) return doJson({ error: "operation_not_settled" }, 409);
      const record = safeFinancialPatch(existing, "succeeded", {
        result: body.result,
        settlement: body.settlement,
        receipt: body.receipt,
        proof: body.proof,
        payment_response: body.payment_response,
        succeeded_at: new Date().toISOString(),
      });
      delete record.payment_payload;
      await this.state.storage.put("operation", record);
      return doJson({ ok: true, record });
    }

    if (path === "/operation/get") {
      const record = await this.state.storage.get("operation");
      return record ? doJson({ ok: true, record }) : doJson({ error: "operation_not_found" }, 404);
    }

    return doJson({ error: "not_found" }, 404);
  }

  async alarm() {
    await reconcileStoredOperation(this.state, this.env);
  }
}

function gatewayIndex(env) {
  return env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName("xguard-paid-gateway-index-v1"));
}

function operationStub(env, fingerprint) {
  return env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName(`payment:${fingerprint}`));
}

async function postStub(stub, path, body) {
  const response = await stub.fetch(`https://paid-gateway${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

async function rateLimit(request, env, scope, limit) {
  if (!env.PAID_GATEWAY) return { allowed: false, retry_after_seconds: 60 };
  const subject = request.headers.get("cf-connecting-ip") || "unknown";
  const subjectHash = await sha256(subject);
  const result = await postStub(gatewayIndex(env), "/index/rate", { scope, subject_hash: subjectHash, limit });
  return result.body;
}

async function recordMetric(env, event, details = {}) {
  if (!env.PAID_GATEWAY || !METRIC_EVENTS.has(event)) return;
  await postStub(gatewayIndex(env), "/index/metric", { event, ...details }).catch(() => {});
}

async function logFinancialEvent(event, requestIdValue, paymentIdentifier, details = {}) {
  console.log(JSON.stringify({ event, request_id: requestIdValue, payment_identifier_hash: await sha256(paymentIdentifier), ...details }));
}

function safeReason(value, fallback) {
  const reason = String(value || fallback || "unknown");
  return /^[a-z0-9_-]{1,80}$/i.test(reason) ? reason : String(fallback || "unknown");
}

function paymentRequirements(config, quote) {
  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: config.amount,
    payTo: config.payTo,
    maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
    extra: {
      name: "USD Coin",
      version: "2",
      quoteId: quote.quote_id,
      inputDigest: quote.input_digest,
    },
  };
}

async function paymentRequired(env, config, quoteToken, quote, id, reason = "payment_required") {
  const requirements = paymentRequirements(config, quote);
  const paymentIdentifierExtension = declarePaymentIdentifierExtension(true);
  paymentIdentifierExtension.info.id = quote.payment_identifier;
  const offer = await createOfferJWS(config.resource, {
    acceptIndex: 0,
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset,
    payTo: requirements.payTo,
    amount: requirements.amount,
    offerValiditySeconds: Math.max(1, quote.expires_at - Math.floor(Date.now() / 1000)),
  }, await signerFor(env));
  const challenge = {
    x402Version: 2,
    error: reason,
    resource: {
      url: config.resource,
      description: "Fetch one bounded public HTTPS resource through XGuard with SSRF protection, source evidence, idempotent settlement and a signed receipt.",
      mimeType: "application/json",
      serviceName: "XGuard Universal Paid AI Agent Gateway",
      tags: ["ai-agent", "web-fetch", "x402", "secretless"],
    },
    accepts: [requirements],
    extensions: {
      "payment-identifier": paymentIdentifierExtension,
      "offer-receipt": {
        info: { offers: [offer] },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { offers: { type: "array", minItems: 1 } },
          required: ["offers"],
        },
      },
      xguard: {
        quote: quoteToken,
        quoteId: quote.quote_id,
        paymentIdentifier: quote.payment_identifier,
        inputDigest: quote.input_digest,
        proofKey: `${API}/.well-known/xguard-proof-key.json`,
      },
    },
  };
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: headers({
      "payment-required": encodePaymentRequiredHeader(challenge),
      "x-xguard-request-id": id,
      "x-xguard-payment-identifier": quote.payment_identifier,
      "link": `<${API}/v1/pricing/quote>; rel="pricing", <${API}/.well-known/xguard-proof-key.json>; rel="verification-key"`,
    }),
  });
}

function authIdentity(payload) {
  const authorization = payload?.payload?.authorization || payload?.payload?.permit2Authorization || payload?.authorization;
  const from = String(authorization?.from || authorization?.owner || "");
  const nonce = String(authorization?.nonce || "");
  if (!validAddress(from) || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) return null;
  return { from: from.toLowerCase(), nonce: nonce.toLowerCase() };
}

function requirementsMatch(left, right) {
  try { return canonicalize(left) === canonicalize(right); } catch { return false; }
}

function classifyFacilitatorError(cause) {
  const status = Number(cause?.statusCode || 0);
  if (status >= 400 && status < 500) return { ambiguous: false, reason: cause?.errorReason || cause?.invalidReason || "facilitator_rejected" };
  return { ambiguous: true, reason: cause?.name === "FacilitatorTimeoutError" ? "facilitator_timeout" : "facilitator_unavailable" };
}

function validSettlement(result, config, expectedPayer = "") {
  return result?.success === true
    && result.network === config.network
    && /^0x[0-9a-fA-F]{64}$/.test(String(result.transaction || ""))
    && (!result.amount || String(result.amount) === config.amount)
    && (!result.payer || !expectedPayer || String(result.payer).toLowerCase() === String(expectedPayer).toLowerCase());
}

async function signProof(env, payload) {
  const response = await proofStub(env).fetch("https://proofrail/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const body = await response.json().catch(() => null);
  return response.ok ? body : null;
}

async function deliveryArtifacts(env, record, settlement, result) {
  const signer = await signerFor(env);
  const receipt = await createReceiptJWS({
    resourceUrl: record.resource,
    payer: settlement.payer || record.payer,
    network: settlement.network,
    transaction: settlement.transaction,
  }, signer);
  const paymentResponse = {
    ...settlement,
    extensions: {
      ...(settlement.extensions || {}),
      "offer-receipt": { info: { receipt } },
      "payment-identifier": { info: { id: record.payment_identifier } },
    },
  };
  const proofPayload = {
    v: 1,
    typ: "xguard-paid-agent-execution",
    iss: API,
    request_id: record.request_id,
    payment_identifier: record.payment_identifier,
    quote_id: record.quote_id,
    tool: TOOL,
    input_digest: record.request_digest,
    network: settlement.network,
    transaction: settlement.transaction,
    amount_atomic: record.amount,
    status: "succeeded",
    source_origin: new URL(result.final_url).origin,
    source_path: new URL(result.final_url).pathname,
    body_sha256: result.body_sha256,
    executed_at: new Date().toISOString(),
  };
  const proof = await signProof(env, proofPayload);
  return { receipt, proof, paymentResponse, paymentResponseHeader: encodePaymentResponseHeader(paymentResponse) };
}

async function issueExecutionCredit(env, record, causeCode) {
  const now = Math.floor(Date.now() / 1000);
  const creditId = `xgc_${crypto.randomUUID().replaceAll("-", "")}`;
  const payload = {
    v: 1,
    typ: "xguard-execution-credit",
    iss: API,
    credit_id: creditId,
    tool: TOOL,
    payer: record.payer,
    amount: record.amount,
    network: record.network,
    original_payment_identifier: record.payment_identifier,
    original_transaction: record.transaction,
    reason: causeCode,
    issued_at: now,
    expires_at: now + 86400 * 30,
  };
  const token = await createJWS(payload, await signerFor(env));
  await postStub(gatewayIndex(env), "/index/credit-create", { ...payload, expires_at: new Date(payload.expires_at * 1000).toISOString() });
  return { token, payload };
}

function successfulResponse(record, replay = false) {
  return json({
    request_id: record.request_id,
    payment_identifier: record.payment_identifier,
    status: "succeeded",
    replay,
    result: record.result,
    settlement: record.settlement,
    receipt: record.receipt,
    proofrail: record.proof,
    accounting: {
      gross_revenue_usd_micros: record.gross_revenue_usd_micros,
      actual_upstream_cost_usd_micros: record.actual_upstream_cost_usd_micros,
      credit_liability_usd_micros: record.credit_liability_usd_micros,
      net_profit_usd_micros: record.net_profit_usd_micros,
      revenue_source: record.revenue_source,
    },
  }, 200, {
    "payment-response": record.payment_response,
    "x-xguard-request-id": record.request_id,
    "x-xguard-payment-identifier": record.payment_identifier,
    "x-xguard-replay": replay ? "true" : "false",
    "x-xguard-receipt": record.receipt?.signature || "",
    "x-xguard-proof": record.proof?.proof || "",
  });
}

async function reconcileStoredOperation(state, env) {
  let record = await state.storage.get("operation");
  if (!record || record.status !== "ambiguous" || !record.payment_payload || !record.requirements) return;
  const attempts = Number(record.reconciliation_attempts || 0);
  if (attempts >= MAX_RECONCILIATION_ATTEMPTS) {
    record = { ...record, dead_letter: true, updated_at: new Date().toISOString() };
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "ambiguous", dead_letter: true });
    console.log(JSON.stringify({ event: "paid_gateway_dead_letter", request_id: record.request_id, payment_identifier_hash: await sha256(record.payment_identifier), status: "ambiguous" }));
    return;
  }
  record = { ...record, reconciliation_attempts: attempts + 1, last_reconciliation_at: new Date().toISOString() };
  await state.storage.put("operation", record);
  let settlement;
  try {
    settlement = await new HTTPFacilitatorClient({ url: record.facilitator_url, timeoutMs: 12000 }).settle(record.payment_payload, record.requirements);
  } catch {
    const exhausted = record.reconciliation_attempts >= MAX_RECONCILIATION_ATTEMPTS;
    record = { ...record, dead_letter: exhausted, updated_at: new Date().toISOString() };
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "ambiguous", dead_letter: exhausted });
    if (!exhausted) await state.storage.setAlarm(Date.now() + 30000 * (2 ** (record.reconciliation_attempts - 1)));
    console.log(JSON.stringify({ event: exhausted ? "paid_gateway_dead_letter" : "paid_gateway_reconciliation_retry", request_id: record.request_id, attempt: record.reconciliation_attempts, next_backoff_ms: exhausted ? null : 30000 * (2 ** (record.reconciliation_attempts - 1)) }));
    return;
  }
  if (settlement?.success === false) {
    record = safeFinancialPatch(record, "failed", { failure_stage: "reconcile", failure_reason: settlement.errorReason || "settlement_rejected" });
    delete record.payment_payload;
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "failed" });
    return;
  }
  const config = gatewayConfig(env, record.network === TESTNET);
  if (!validSettlement(settlement, config, record.payer)) {
    const exhausted = record.reconciliation_attempts >= MAX_RECONCILIATION_ATTEMPTS;
    record = { ...record, dead_letter: exhausted, updated_at: new Date().toISOString() };
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "ambiguous", dead_letter: exhausted });
    if (!exhausted) await state.storage.setAlarm(Date.now() + 30000 * (2 ** (record.reconciliation_attempts - 1)));
    return;
  }
  record = safeFinancialPatch(record, "settled", { transaction: settlement.transaction, network: settlement.network, payer: settlement.payer || record.payer, settlement });
  delete record.payment_payload;
  await state.storage.put("operation", record);
  await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "settled" });
  await recordMetric(env, "settled", { amount_usd_micros: record.network === TESTNET ? 0 : record.customer_price_usd_micros });
  try {
    const result = await performWebFetch(record.input);
    if (result.status >= 500) throw Object.assign(new Error("upstream_failed"), { code: "upstream_failed" });
    const artifacts = await deliveryArtifacts(env, record, settlement, result);
    record = safeFinancialPatch(record, "succeeded", {
      result,
      settlement,
      receipt: artifacts.receipt,
      proof: artifacts.proof,
      payment_response: artifacts.paymentResponseHeader,
      succeeded_at: new Date().toISOString(),
    });
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "succeeded" });
    await recordMetric(env, "succeeded", { latency_ms: result.latency_ms });
    console.log(JSON.stringify({ event: "paid_gateway_reconciled_success", request_id: record.request_id, network: record.network, amount_atomic: record.amount, transaction: settlement.transaction, revenue_usd_micros: record.gross_revenue_usd_micros }));
  } catch (cause) {
    const credit = await issueExecutionCredit(env, record, cause?.code || "upstream_failed");
    record = safeFinancialPatch(record, "credited", { credit_token: credit.token, credit_id: credit.payload.credit_id, failure_code: cause?.code || "upstream_failed" });
    await state.storage.put("operation", record);
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "credited" });
    await recordMetric(env, "upstream_failed");
    await recordMetric(env, "credited");
  }
}

async function useExecutionCredit(request, env, quote, config, input, id) {
  const token = request.headers.get("x-xguard-credit");
  if (!token) return null;
  const payload = await verifyJws(env, token);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.typ !== "xguard-execution-credit" || payload.iss !== API || payload.tool !== TOOL || payload.amount !== config.amount || payload.network !== config.network || !payload.credit_id || payload.expires_at <= now) return error("credit_invalid", 409, id);
  const reserve = await postStub(gatewayIndex(env), "/index/credit-consume", { credit_id: payload.credit_id, tool: TOOL, amount: config.amount, request_id: id });
  if (!reserve.ok) return error("credit_invalid", 409, id);
  try {
    const result = await performWebFetch(input);
    if (result.status >= 500) throw Object.assign(new Error("upstream_failed"), { code: "upstream_failed" });
    await postStub(gatewayIndex(env), "/index/credit-finalize", { credit_id: payload.credit_id, request_id: id, success: true });
    const proof = await signProof(env, {
      v: 1, typ: "xguard-credited-execution", iss: API, request_id: id, credit_id: payload.credit_id, tool: TOOL,
      input_digest: quote.input_digest, original_transaction: payload.original_transaction, body_sha256: result.body_sha256, executed_at: new Date().toISOString(),
    });
    return json({ request_id: id, status: "succeeded", used_execution_credit: true, original_payment_identifier: payload.original_payment_identifier, result, proofrail: proof, accounting: { gross_revenue_usd_micros: 0, actual_upstream_cost_usd_micros: 0, net_profit_usd_micros: 0, revenue_source: "original_settlement_fulfillment" } }, 200, {
      "x-xguard-request-id": id,
      "x-xguard-proof": proof?.proof || "",
    });
  } catch (cause) {
    await postStub(gatewayIndex(env), "/index/credit-finalize", { credit_id: payload.credit_id, request_id: id, success: false });
    return error(cause?.code || "upstream_failed", cause?.code === "upstream_timeout" ? 504 : 502, id, { retryable: true });
  }
}

async function handlePaidWebFetch(request, env, id, rawInput, forceTestnet = false) {
  if (!env.PROOF_AUTHORITY || !env.PAID_GATEWAY) return error("payment_not_configured", 503, id);
  const rate = await rateLimit(request, env, "paid-execution", 30);
  if (!rate.allowed) return error("rate_limited", 429, id, { retryable: true, details: { retry_after_seconds: rate.retry_after_seconds } });
  const input = normalizeFetchInput(rawInput);
  if (!input) return error("invalid_input", 400, id);
  const quoteToken = request.headers.get("x-xguard-quote") || rawInput?.quote;
  if (!quoteToken) return error("quote_required", 428, id, { details: { quote_endpoint: `${API}/v1/pricing/quote` } });
  const quote = await verifyJws(env, quoteToken);
  if (!quote || quote.typ !== "xguard-price-quote" || quote.iss !== API || quote.tool !== TOOL) return error("quote_invalid", 400, id);
  if (quote.expires_at <= Math.floor(Date.now() / 1000)) return error("quote_expired", 400, id);
  const config = gatewayConfig(env, quote.network === TESTNET);
  const requestPath = new URL(request.url).pathname;
  const directRouteMismatch = (requestPath === "/v1/tools/web.fetch/testnet" && quote.network !== TESTNET)
    || (requestPath === "/v1/tools/web.fetch" && quote.network === TESTNET);
  if (!config.configured || (forceTestnet && quote.network !== TESTNET) || directRouteMismatch) return error("quote_invalid", 400, id);
  const digest = await sha256(canonicalize(input));
  if (quote.aud !== config.resource || quote.input_digest !== digest || quote.network !== config.network || quote.asset.toLowerCase() !== config.asset.toLowerCase() || quote.pay_to.toLowerCase() !== config.payTo.toLowerCase() || quote.amount !== config.amount || quote.customer_price_usd_micros !== config.customerPriceUsdMicros || quote.upstream_cost_max_usd_micros !== 0 || quote.xguard_margin_usd_micros !== config.marginUsdMicros || quote.payment_identifier == null) return error("quote_invalid", 400, id);

  const firstTarget = await publicDns(new URL(input.url).hostname);
  if (!firstTarget.ok) return error(firstTarget.code, firstTarget.code === "dns_unresolved" ? 422 : 403, id);
  const credited = await useExecutionCredit(request, env, quote, config, input, id);
  if (credited) return credited;

  const signatureHeader = request.headers.get("payment-signature");
  if (!signatureHeader) return paymentRequired(env, config, quoteToken, quote, id);
  let paymentPayload;
  try { paymentPayload = decodePaymentSignatureHeader(signatureHeader); } catch { return error("payment_payload_invalid", 400, id); }
  const requirements = paymentRequirements(config, quote);
  const paymentIdentifier = extractPaymentIdentifier(paymentPayload, true);
  const identity = authIdentity(paymentPayload);
  if (paymentPayload?.x402Version !== 2 || !requirementsMatch(paymentPayload?.accepted, requirements) || (paymentPayload.resource?.url && paymentPayload.resource.url !== config.resource) || paymentIdentifier !== quote.payment_identifier || !identity) return error("payment_payload_invalid", 400, id);
  const authorizationFingerprint = await sha256(`${config.network}|${config.asset.toLowerCase()}|${identity.from}|${identity.nonce}`);
  const reserve = await postStub(gatewayIndex(env), "/index/reserve", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, request_digest: digest, request_id: id });
  if (!reserve.ok) return error("payment_identifier_conflict", 409, id, { details: reserve.body.record || null });
  const stub = operationStub(env, authorizationFingerprint);
  const begin = await postStub(stub, "/operation/begin", {
    request_id: reserve.body.record.request_id || id,
    payment_identifier: paymentIdentifier,
    authorization_fingerprint: authorizationFingerprint,
    request_digest: digest,
    quote_id: quote.quote_id,
    resource: config.resource,
    tool: TOOL,
    input,
    payer: identity.from,
    nonce: identity.nonce,
    network: config.network,
    asset: config.asset,
    amount: config.amount,
    maximum_upstream_cost_usd_micros: 0,
    customer_price_usd_micros: config.customerPriceUsdMicros,
    facilitator_url: config.facilitator,
    payment_payload: paymentPayload,
    requirements,
  });
  if (!begin.ok) {
    await postStub(gatewayIndex(env), "/index/release", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint });
    return error("payment_identifier_conflict", 409, id, { details: begin.body.record || null });
  }
  if (begin.body.replay) {
    const record = begin.body.record;
    if (record.status === "succeeded") {
      await recordMetric(env, "replay");
      return successfulResponse(record, true);
    }
    if (record.status === "credited") return error("upstream_failed", 502, record.request_id, { retryable: true, details: { execution_credit: record.credit_token, credit_id: record.credit_id } });
    if (record.status === "ambiguous") return error("settlement_ambiguous", 503, record.request_id, { retryable: true, details: { status_url: `${API}/v1/operations/${paymentIdentifier}` } });
    if (record.status === "failed") return paymentRequired(env, config, quoteToken, quote, record.request_id, "previous_payment_failed");
    return error("settlement_ambiguous", 409, record.request_id, { retryable: true });
  }

  const facilitator = new HTTPFacilitatorClient({ url: config.facilitator, timeoutMs: 10000 });
  let verification;
  try { verification = await facilitator.verify(paymentPayload, requirements); } catch (cause) {
    await postStub(stub, "/operation/transition", { status: "failed", patch: { failure_stage: "verify", failure_reason: "facilitator_verify_unavailable" } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "failed" });
    await recordMetric(env, "verification_failed");
    await logFinancialEvent("paid_gateway_verification_failed", id, paymentIdentifier, { reason: "facilitator_unavailable" });
    return error("payment_verification_failed", 402, id, { retryable: true, details: { reason: cause?.invalidReason || "facilitator_unavailable" } });
  }
  if (!verification?.isValid || (verification.payer && verification.payer.toLowerCase() !== identity.from)) {
    await postStub(stub, "/operation/transition", { status: "failed", patch: { failure_stage: "verify", failure_reason: verification?.invalidReason || "invalid_payment" } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "failed" });
    await recordMetric(env, "verification_failed");
    await logFinancialEvent("paid_gateway_verification_failed", id, paymentIdentifier, { reason: safeReason(verification?.invalidReason, "invalid_payment") });
    return paymentRequired(env, config, quoteToken, quote, id, verification?.invalidReason || "payment_verification_failed");
  }
  await postStub(stub, "/operation/transition", { status: "verified", patch: { verified_at: new Date().toISOString(), payer: verification.payer || identity.from } });
  await recordMetric(env, "verified");

  let settlement;
  try { settlement = await facilitator.settle(paymentPayload, requirements); } catch (cause) {
    const classified = classifyFacilitatorError(cause);
    const status = classified.ambiguous ? "ambiguous" : "failed";
    await postStub(stub, "/operation/transition", { status, patch: { failure_stage: "settle", failure_reason: classified.reason } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status });
    await recordMetric(env, classified.ambiguous ? "settlement_ambiguous" : "settlement_failed");
    await logFinancialEvent(classified.ambiguous ? "paid_gateway_settlement_ambiguous" : "paid_gateway_settlement_failed", id, paymentIdentifier, { reason: classified.reason, network: config.network, amount_atomic: config.amount });
    return classified.ambiguous
      ? error("settlement_ambiguous", 503, id, { retryable: true, details: { status_url: `${API}/v1/operations/${paymentIdentifier}` } })
      : error("settlement_failed", 402, id, { retryable: true, details: { reason: classified.reason } });
  }
  if (!validSettlement(settlement, config, identity.from)) {
    const ambiguous = settlement?.success === true;
    const status = ambiguous ? "ambiguous" : "failed";
    await postStub(stub, "/operation/transition", { status, patch: { failure_stage: "settle", failure_reason: settlement?.errorReason || "invalid_settlement_response", observed_transaction: settlement?.transaction || null } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status });
    await recordMetric(env, ambiguous ? "settlement_ambiguous" : "settlement_failed");
    await logFinancialEvent(ambiguous ? "paid_gateway_settlement_ambiguous" : "paid_gateway_settlement_failed", id, paymentIdentifier, { reason: safeReason(settlement?.errorReason, "invalid_settlement_response"), network: config.network, amount_atomic: config.amount });
    return error(ambiguous ? "settlement_ambiguous" : "settlement_failed", ambiguous ? 503 : 402, id, { retryable: true });
  }
  const settled = await postStub(stub, "/operation/transition", { status: "settled", patch: { transaction: settlement.transaction, network: settlement.network, payer: settlement.payer || identity.from, settlement } });
  await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "settled" });
  await recordMetric(env, "settled", { amount_usd_micros: config.testnet ? 0 : config.customerPriceUsdMicros });
  let result;
  try {
    result = await performWebFetch(input);
    if (result.status >= 500) throw Object.assign(new Error("upstream_failed"), { code: "upstream_failed" });
  } catch (cause) {
    const credit = await issueExecutionCredit(env, { ...settled.body.record, transaction: settlement.transaction }, cause?.code || "upstream_failed");
    await postStub(stub, "/operation/transition", { status: "credited", patch: { credit_token: credit.token, credit_id: credit.payload.credit_id, failure_code: cause?.code || "upstream_failed" } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "credited" });
    await recordMetric(env, "upstream_failed");
    await recordMetric(env, "credited");
    await logFinancialEvent("paid_gateway_execution_credited", id, paymentIdentifier, { reason: cause?.code || "upstream_failed", network: config.network, amount_atomic: config.amount, transaction: settlement.transaction });
    return error("upstream_failed", cause?.code === "upstream_timeout" ? 504 : 502, id, { retryable: true, details: { execution_credit: credit.token, credit_id: credit.payload.credit_id, original_transaction: settlement.transaction } });
  }
  const artifacts = await deliveryArtifacts(env, settled.body.record, settlement, result);
  const completed = await postStub(stub, "/operation/complete", { result, settlement, receipt: artifacts.receipt, proof: artifacts.proof, payment_response: artifacts.paymentResponseHeader });
  await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "succeeded" });
  const finalRecord = completed.body.record;
  await recordMetric(env, "succeeded", { latency_ms: result.latency_ms });
  console.log(JSON.stringify({ event: "paid_gateway_succeeded", request_id: finalRecord.request_id, payment_identifier_hash: await sha256(paymentIdentifier), tool: TOOL, target_host: new URL(input.url).hostname, network: config.network, amount_atomic: config.amount, transaction: settlement.transaction, latency_ms: result.latency_ms, revenue_usd_micros: finalRecord.gross_revenue_usd_micros, upstream_cost_usd_micros: finalRecord.actual_upstream_cost_usd_micros, net_profit_usd_micros: finalRecord.net_profit_usd_micros }));
  return successfulResponse(finalRecord, false);
}

const PAID_MCP_TOOLS = [
  {
    name: "xguard.capabilities",
    title: "Discover XGuard capabilities",
    description: "Return the enabled and disabled XGuard tools, their security boundary, and canonical discovery URLs. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "xguard.pricing.quote",
    title: "Get a signed execution quote",
    description: "Return a short-lived signed price quote bound to xguard.web.fetch inputs. Free; set testnet=true for Base Sepolia.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", format: "uri", pattern: "^https://" },
        method: { type: "string", enum: ["GET", "HEAD"], default: "GET" },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 10000 },
        max_bytes: { type: "integer", minimum: 1024, maximum: HARD_MAX_BYTES },
        mode: { type: "string", enum: ["auto", "text", "json"] },
        testnet: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: false },
  },
  {
    name: TOOL,
    title: "Fetch a public HTTPS resource",
    description: "Fetch one bounded public HTTPS resource after x402 settlement. Requires a signed quote and Payment-Signature; returns a signed receipt and ProofRail evidence.",
    inputSchema: {
      type: "object",
      required: ["url", "quote"],
      properties: {
        url: { type: "string", format: "uri", pattern: "^https://" },
        method: { type: "string", enum: ["GET", "HEAD"], default: "GET" },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 10000 },
        max_bytes: { type: "integer", minimum: 1024, maximum: HARD_MAX_BYTES },
        mode: { type: "string", enum: ["auto", "text", "json"] },
        quote: { type: "string", description: "Compact signed quote returned by xguard.pricing.quote." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
];

function mcpEnvelope(id, value, responseHeaders = {}) {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    },
  }, 200, responseHeaders);
}

async function handlePaidMcp(request, env, id) {
  const parsed = await jsonBody(request.clone(), 32768);
  if (parsed.error) return error(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, id);
  const message = parsed.value;
  if (message?.method === "tools/call" && message?.params?.name === "xguard.capabilities") {
    return mcpEnvelope(message.id, capabilities(env), { "x-xguard-request-id": id });
  }
  if (message?.method === "tools/call" && message?.params?.name === "xguard.pricing.quote") {
    const quoted = await issueQuote(env, message?.params?.arguments || {}, id);
    if (!quoted.response.ok) return quoted.response;
    return mcpEnvelope(message.id, await quoted.response.clone().json(), { "x-xguard-request-id": id });
  }
  if (message?.method === "tools/call" && message?.params?.name === TOOL) {
    const paid = await handlePaidWebFetch(request, env, id, message?.params?.arguments || {});
    if (!paid.ok) return paid;
    const value = await paid.clone().json();
    const exposed = {};
    for (const name of ["payment-response", "x-xguard-request-id", "x-xguard-payment-identifier", "x-xguard-replay", "x-xguard-proof", "x-xguard-receipt"]) {
      const value = paid.headers.get(name);
      if (value) exposed[name] = value;
    }
    return mcpEnvelope(message.id, value, exposed);
  }
  return { message };
}

async function augmentMcpTools(message, response) {
  if (message?.method !== "tools/list" || !(response instanceof Response) || !response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!Array.isArray(body?.result?.tools)) return response;
  for (const tool of [...PAID_MCP_TOOLS].reverse()) {
    const existing = body.result.tools.findIndex(item => item?.name === tool.name);
    if (existing >= 0) body.result.tools.splice(existing, 1);
    body.result.tools.unshift(tool);
  }
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return new Response(JSON.stringify(body), { status: response.status, headers: next });
}

function mcpDiscovery(env) {
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    transport: "streamable-http",
    endpoint: `${API}/mcp`,
    protocol: "MCP",
    methods: ["initialize", "notifications/initialized", "tools/list", "tools/call"],
    tools: PAID_MCP_TOOLS.map(tool => ({ ...tool, available: tool.name !== TOOL || gatewayConfig(env, false).configured })),
  };
}

function paymentManifest(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    protocol: "x402",
    x402_version: 2,
    account_required: false,
    subscription_required: false,
    custody: "non-custodial-resource-server",
    currencies: [{ symbol: "USDC", decimals: 6 }],
    resources: [{
      tool: TOOL,
      method: "POST",
      url: mainnet.resource,
      testnet_url: testnet.resource,
      quote_url: `${API}/v1/pricing/quote`,
      scheme: "exact",
      mainnet: { network: mainnet.network, asset: mainnet.asset, amount: mainnet.amount, pay_to: mainnet.payTo, configured: mainnet.configured },
      testnet: { network: testnet.network, asset: testnet.asset, amount: testnet.amount, pay_to: testnet.payTo, configured: testnet.configured },
      payment_identifier_required: true,
      signed_offer: true,
      signed_receipt: true,
      settlement_before_execution: true,
      replay_safe: true,
      post_settlement_failure_policy: "signed_reusable_execution_credit",
    }],
    facilitator: {
      configurable: true,
      selected_mainnet: mainnet.facilitator,
      selected_testnet: testnet.facilitator,
      discovery: `${API}/.well-known/x402-facilitator.json`,
    },
  };
}

function facilitatorManifest(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return {
    name: "XGuard x402 routing surface",
    version: VERSION,
    x402_version: 2,
    role: "resource-server facilitator selection plus backwards-compatible verify/settle relay",
    endpoints: { supported: `${API}/supported`, verify: `${API}/verify`, settle: `${API}/settle` },
    selected_for_paid_gateway: [
      { network: mainnet.network, scheme: "exact", url: mainnet.facilitator, configured: mainnet.configured },
      { network: testnet.network, scheme: "exact", url: testnet.facilitator, configured: testnet.configured },
    ],
    settlement_policy: "Execute only after the configured facilitator returns a valid successful settlement response. Timeout or 5xx is ambiguous and enters reconciliation without upstream execution.",
  };
}

async function readiness(env) {
  const checks = { proof_authority: false, paid_state: false, mainnet_config: false, facilitator: false };
  const config = gatewayConfig(env, false);
  checks.mainnet_config = config.configured;
  try { checks.proof_authority = (await proofStub(env).fetch("https://proofrail/public")).ok; } catch {}
  try { checks.paid_state = (await gatewayIndex(env).fetch("https://paid-gateway/ping")).ok; } catch {}
  try {
    const response = await fetch(`${config.facilitator}/supported`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    checks.facilitator = response.ok && Array.isArray(body?.kinds) && body.kinds.some(kind => kind?.x402Version === 2 && kind?.scheme === "exact" && kind?.network === config.network);
  } catch {}
  return { ready: Object.values(checks).every(Boolean), checks, checked_at: new Date().toISOString() };
}

async function operationStatus(env, paymentIdentifier, id) {
  if (!isValidPaymentId(paymentIdentifier) || !env.PAID_GATEWAY) return error("not_found", 404, id);
  const lookup = await postStub(gatewayIndex(env), "/index/lookup", { payment_identifier: paymentIdentifier });
  if (!lookup.ok) return error("not_found", 404, id);
  const operation = await postStub(operationStub(env, lookup.body.record.authorization_fingerprint), "/operation/get", {});
  if (!operation.ok) return error("not_found", 404, id);
  const record = operation.body.record;
  return json({
    request_id: record.request_id,
    payment_identifier: record.payment_identifier,
    status: record.status,
    network: record.network,
    asset: record.asset,
    amount: record.amount,
    transaction: record.transaction || null,
    gross_revenue_usd_micros: record.gross_revenue_usd_micros,
    actual_upstream_cost_usd_micros: record.actual_upstream_cost_usd_micros,
    net_profit_usd_micros: record.net_profit_usd_micros,
    revenue_source: record.revenue_source,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }, 200, { "x-xguard-request-id": id });
}

function paidOpenApiPaths() {
  const standard = { "application/json": { schema: { type: "object" } } };
  return {
    "/v1/capabilities": { get: { summary: "Discover actual XGuard tool availability", responses: { "200": { description: "Machine-readable capabilities", content: standard } } } },
    "/v1/pricing": { get: { summary: "Inspect prices before execution", responses: { "200": { description: "Published pricing", content: standard } } } },
    "/v1/pricing/quote": { post: { summary: "Create a signed quote bound to web.fetch inputs", requestBody: { required: true, content: standard }, responses: { "200": { description: "Signed short-lived quote", content: standard }, "400": { description: "Invalid input" } } } },
    "/v1/tools/web.fetch": { post: { summary: "Fetch a public HTTPS resource after x402 settlement", parameters: [{ name: "X-XGuard-Quote", in: "header", required: true, schema: { type: "string" } }, { name: "Payment-Signature", in: "header", required: false, schema: { type: "string" } }], requestBody: { required: true, content: standard }, responses: { "200": { description: "Result, signed receipt, and ProofRail evidence", content: standard }, "402": { description: "x402 v2 PaymentRequired challenge", content: standard }, "409": { description: "Replay or idempotency conflict" }, "503": { description: "Ambiguous settlement; no upstream execution" } } } },
    "/v1/tools/web.fetch/testnet": { post: { summary: "Base Sepolia testnet form of xguard.web.fetch", requestBody: { required: true, content: standard }, responses: { "200": { description: "Testnet result" }, "402": { description: "Base Sepolia x402 challenge" } } } },
    "/v1/operations/{payment_identifier}": { get: { summary: "Read a payment/execution state", parameters: [{ name: "payment_identifier", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Explicit financial state", content: standard }, "404": { description: "Unknown identifier" } } } },
    "/v1/health": { get: { summary: "Liveness probe", responses: { "200": { description: "Worker is live" } } } },
    "/v1/ready": { get: { summary: "Dependency readiness probe", responses: { "200": { description: "Ready" }, "503": { description: "Dependency unavailable" } } } },
    "/v1/metrics": { get: { summary: "Paid-gateway operational counters", responses: { "200": { description: "Actual challenges, settlement outcomes, upstream failures, replays, and latency aggregates" } } } },
  };
}

async function improveOpenApi(response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return response;
  body.info = {
    ...(body.info || {}),
    title: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    description: "No-account x402 v2 USDC gateway for controlled agent tools, plus secretless upstream credential execution. Prices are signed before payment; successful execution returns a signed receipt and ProofRail evidence.",
  };
  body.paths = { ...(body.paths || {}), ...paidOpenApiPaths() };
  body.servers = [{ url: API }];
  body.x_xguard = { product: "XGUARD = UNIVERSAL PAID AI AGENT + SECRETLESS GATEWAY", actual_capabilities: `${API}/v1/capabilities`, pricing: `${API}/v1/pricing`, payment_manifest: `${API}/.well-known/payment-manifest` };
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return new Response(JSON.stringify(body), { status: response.status, headers: next });
}

async function improveLlms(response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const current = await response.clone().text();
  const addition = `\n## Universal paid tool path\n\nXGuard lets an agent discover a tool, obtain a signed price, pay once with x402 v2 USDC, and execute without an XGuard account or subscription. The first production tool is xguard.web.fetch; advertised search, inference, routing and data connectors are disabled until real connectors are configured.\n\n- Capabilities: ${API}/v1/capabilities\n- Pricing: ${API}/v1/pricing\n- Signed quote: POST ${API}/v1/pricing/quote\n- Paid execution: POST ${API}/v1/tools/web.fetch\n- Testnet execution: POST ${API}/v1/tools/web.fetch/testnet\n- Payment manifest: ${API}/.well-known/payment-manifest\n- Health: ${API}/v1/health\n- Readiness: ${API}/v1/ready\n\nFlow: discovery -> signed quote -> HTTP 402 -> Payment-Signature verification -> settlement -> controlled HTTPS fetch -> signed receipt + ProofRail. Payment-Identifier is mandatory; retries return the stored outcome and do not settle twice.\n`;
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return new Response(current.includes("## Universal paid tool path") ? current : current + addition, { status: response.status, headers: next });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = requestId(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
    if (request.method === "GET" && url.pathname === "/mcp") return json(mcpDiscovery(env), 200, { allow: "GET, HEAD, POST, OPTIONS", "cache-control": "public, max-age=60" });
    if (request.method === "HEAD" && url.pathname === "/mcp") return new Response(null, { status: 200, headers: headers({ allow: "GET, HEAD, POST, OPTIONS" }) });
    if (request.method === "GET" && url.pathname === "/v1/capabilities") return json(capabilities(env), 200, { "cache-control": "public, max-age=60", "x-xguard-request-id": id });
    if (request.method === "GET" && url.pathname === "/v1/pricing") return json(pricing(env), 200, { "cache-control": "public, max-age=60", "x-xguard-request-id": id });
    if (request.method === "GET" && url.pathname === "/v1/health") return json({ status: "ok", live: true, version: VERSION, request_id: id, checked_at: new Date().toISOString() }, 200, { "x-xguard-request-id": id });
    if (request.method === "GET" && url.pathname === "/v1/ready") {
      const state = await readiness(env);
      return json({ status: state.ready ? "ready" : "not_ready", version: VERSION, request_id: id, ...state }, state.ready ? 200 : 503, { "x-xguard-request-id": id });
    }
    if (request.method === "GET" && url.pathname === "/v1/metrics") {
      if (!env.PAID_GATEWAY) return error("payment_not_configured", 503, id);
      const metrics = await postStub(gatewayIndex(env), "/index/metrics", {});
      return json({ version: VERSION, request_id: id, health_checks_excluded: true, ...metrics.body }, metrics.ok ? 200 : 503, { "x-xguard-request-id": id });
    }
    if (request.method === "GET" && ["/.well-known/payment-manifest", "/.well-known/payment-manifest.json"].includes(url.pathname)) return json(paymentManifest(env), 200, { "cache-control": "public, max-age=120" });
    if (request.method === "GET" && url.pathname === "/.well-known/x402-facilitator.json") return json(facilitatorManifest(env), 200, { "cache-control": "public, max-age=120" });
    if (request.method === "POST" && url.pathname === "/v1/pricing/quote") {
      const parsed = await jsonBody(request);
      if (parsed.error) return error(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, id);
      return (await issueQuote(env, parsed.value, id)).response;
    }
    if (request.method === "POST" && ["/v1/tools/web.fetch", "/v1/tools/web.fetch/testnet"].includes(url.pathname)) {
      const parsed = await jsonBody(request.clone());
      if (parsed.error) return error(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, id);
      return handlePaidWebFetch(request, env, id, parsed.value, url.pathname.endsWith("/testnet"));
    }
    const operationMatch = request.method === "GET" ? url.pathname.match(/^\/v1\/operations\/([^/]+)$/) : null;
    if (operationMatch) return operationStatus(env, decodeURIComponent(operationMatch[1]), id);
    if (url.pathname === "/mcp" && request.method === "POST") {
      const paid = await handlePaidMcp(request, env, id);
      if (paid instanceof Response) return paid;
      const response = await app.fetch(request, env, ctx);
      return augmentMcpTools(paid?.message, response);
    }
    let response = await app.fetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/openapi.json") response = await improveOpenApi(response);
    if (request.method === "GET" && url.pathname === "/llms.txt") response = await improveLlms(response);
    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
