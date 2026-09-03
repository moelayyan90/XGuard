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
import {
  PAYMENT_ENVIRONMENTS,
  PAYMENT_STATES,
  isRealRevenueSettlement,
  paymentStateCanTransition,
  validatePaymentRailConfig,
} from "./core/payment-rail.js";

const VERSION = "5.1.0";
const API = "https://api.xguardgate.com";
const SITE = "https://xguardgate.com";
const PROOF_KID = "did:web:api.xguardgate.com#xguard-proofrail";
const TOOL = "xguard.web.fetch";
const MAINNET = "eip155:8453";
const TESTNET = "eip155:84532";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TESTNET_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_PRICE_ATOMIC = "1000";
const HARD_MAX_BYTES = 131072;
const MAX_TOOL_REQUEST_BYTES = 16384;
const QUOTE_TTL_SECONDS = 300;
const PAYMENT_TIMEOUT_SECONDS = 300;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const ALLOWED_FINANCIAL_STATES = new Set(PAYMENT_STATES);
const JOURNEY_EVENTS = new Set([
  "discovery",
  "preflight",
  "tools_list",
  "tools_call",
  "quote_attempt",
  "quote_success",
  "quote_failed",
  "payment_required",
  "payment_attempt",
  "payment_payload_received",
  "payment_parse_failed",
  "payment_authorization_received",
  "payment_verified",
  "settlement_started",
  "settlement_success",
  "settlement_failed",
  "execution_started",
  "execution_success",
  "execution_failed",
]);
const METRIC_EVENTS = new Set([
  ...JOURNEY_EVENTS,
  "succeeded",
  "replay",
  "verification_failed",
  "settlement_ambiguous",
  "upstream_failed",
  "credited",
]);
const QUOTE_CANONICAL_EXAMPLE = { url: "https://example.com/", method: "GET", testnet: true };
const QUOTE_ACCEPTED_SHAPES = [
  { name: "canonical_flat", example: QUOTE_CANONICAL_EXAMPLE },
  { name: "tool_input", example: { tool: TOOL, input: { url: "https://example.com/", method: "GET" }, testnet: true } },
  { name: "mcp_arguments", example: { name: TOOL, arguments: { url: "https://example.com/", method: "GET" }, testnet: true } },
  { name: "tool_parameters", example: { tool_name: TOOL, parameters: { url: "https://example.com/", method: "GET" }, network: TESTNET } },
  { name: "function_call", example: { function: { name: TOOL, arguments: "{\"url\":\"https://example.com/\",\"method\":\"GET\"}" }, testnet: true } },
  { name: "curl_command", example: { command: "curl https://example.com/", testnet: true } },
  { name: "operation_object", example: { operation: { name: TOOL, arguments: { endpoint: "https://example.com/", method: "GET" } }, testnet: true } },
];
const DISCOVERY_PATHS = new Set([
  "/.well-known/xguard-tools.json",
  "/v1/preflight",
  "/a2a",
  "/openapi.json",
  "/llms.txt",
  "/server.json",
  "/skill.md",
  "/architecture",
  "/supported",
  "/facilitator",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/payment-manifest",
  "/.well-known/payment-manifest.json",
  "/.well-known/x402-facilitator.json",
  "/.well-known/xguard.json",
  "/.well-known/xguard-egress.json",
  "/.well-known/xguard-egress-key.json",
  "/.well-known/xguard-proof-key.json",
  "/v1/payment/readiness",
]);
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
    "access-control-allow-headers": "content-type,payment-signature,x-xguard-quote,x-xguard-credit,x-request-id,x-xguard-traffic-class",
    "access-control-expose-headers": "payment-required,payment-response,x-xguard-quote,x-xguard-request-id,x-xguard-payment-identifier,x-xguard-payment-environment,x-xguard-payment-rail,x-xguard-replay,x-xguard-proof,x-xguard-receipt,x-xguard-credit",
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
  const retry = details.details?.retry;
  return json({
    error: { code, message: ERROR_MESSAGES[code] || code, retryable: Boolean(details.retryable), details: details.details || null },
    error_code: code,
    recoverable: Boolean(details.retryable || retry),
    ...(retry ? { suggested_fix: retry.canonical_shape, accepted_examples: retry.accepted_shapes?.map(shape => shape.example).filter(Boolean) || [] } : {}),
    request_id: id,
  }, status, { "x-xguard-request-id": id });
}

const ERROR_MESSAGES = {
  invalid_json: "The request body is not valid JSON.",
  payload_too_large: "The request body exceeded the configured size limit.",
  invalid_input: "The tool input is invalid.",
  ambiguous_input: "The request contains conflicting input envelopes or values.",
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
  dns_unavailable: "Public DNS validation is temporarily unavailable; no quote was issued.",
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
  env ||= {};
  const network = testnet ? TESTNET : MAINNET;
  const asset = testnet ? TESTNET_USDC : MAINNET_USDC;
  const environment = testnet ? PAYMENT_ENVIRONMENTS.TEST : String(env.XGUARD_PAYMENT_ENVIRONMENT || PAYMENT_ENVIRONMENTS.PRODUCTION).toLowerCase();
  const payTo = String(testnet ? env.XGUARD_TESTNET_PAY_TO || "" : env.XGUARD_TREASURY_USDC_ADDRESS || "");
  const amount = String(testnet ? env.XGUARD_TESTNET_WEB_FETCH_PRICE_ATOMIC || DEFAULT_PRICE_ATOMIC : env.XGUARD_WEB_FETCH_PRICE_ATOMIC || DEFAULT_PRICE_ATOMIC);
  const facilitator = String(testnet ? env.XGUARD_TESTNET_FACILITATOR || "" : env.XGUARD_PAID_FACILITATOR || env.X402_BASE_PRIMARY || "").replace(/\/+$/, "");
  const marginMicros = Number(testnet ? env.XGUARD_TESTNET_MARGIN_USD_MICROS || amount : env.XGUARD_MARGIN_USD_MICROS || amount);
  const railValidation = validatePaymentRailConfig({ environment, network, asset, payTo, amount, facilitator });
  const economicsValid = Number.isSafeInteger(marginMicros) && marginMicros >= 0 && marginMicros === Number(amount);
  const configured = railValidation.configured && economicsValid;
  const configurationError = !railValidation.environment_configured ? "payment_environment_invalid"
    : !railValidation.environment_matches_network ? "payment_environment_network_mismatch"
    : !railValidation.recipient_configured ? "payment_recipient_missing"
      : !railValidation.asset_configured ? "payment_asset_invalid"
        : !railValidation.amount_configured || !economicsValid ? "payment_price_invalid"
          : !railValidation.facilitator_configured ? "payment_facilitator_missing" : null;
  const rail = {
    id: `x402:${network}:exact`,
    provider: "x402",
    scheme: "exact",
    environment: railValidation.environment,
    config: railValidation,
  };
  return {
    configured,
    configurationError,
    environment: railValidation.environment,
    rail,
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
      preflight: `${API}/v1/preflight`,
      interactive_try: "https://xguardgate.com/try",
    },
    fastest_path: {
      method: "POST",
      endpoint: `${API}/v1/tools/web.fetch`,
      body: { url: "https://example.com/" },
      first_response: "HTTP 402 with Payment-Required and X-XGuard-Quote",
      target_contacted_before_settlement: false,
    },
    tools: [
      { id: "xguard.capabilities", available: true, paid: false, endpoint: `${API}/v1/capabilities` },
      { id: "xguard.preflight", available: true, paid: false, endpoint: `${API}/v1/preflight`, request: preflightRequestGuidance(), target_contacted: false },
      { id: "xguard.pricing.quote", available: true, paid: false, endpoint: `${API}/v1/pricing/quote`, request: quoteRequestGuidance() },
      {
        id: TOOL,
        available: mainnet.configured,
        paid: true,
        role: "guarded_request_chokepoint",
        endpoint: mainnet.resource,
        testnet_endpoint: testnet.resource,
        network: mainnet.network,
        asset: "USDC",
        payment_environment: mainnet.environment,
        payment_rails: [{ id: mainnet.rail.id, provider: mainnet.rail.provider, scheme: mainnet.rail.scheme, environment: mainnet.environment, network: mainnet.network, asset: mainnet.asset, configured: mainnet.configured }],
        safety: ["https_only", "ssrf_guard", "dns_public_address_check", "manual_redirect_validation", "bounded_response", "timeout", "cache", "idempotent_payment"],
        unavailable_reason: mainnet.configured ? null : { code: mainnet.configurationError || "payment_not_configured", missing: ["valid production receiving address", "positive price", "HTTPS facilitator", "production network/environment match"], readiness: `${API}/v1/payment/readiness` },
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
    payment_environments: {
      production: { environment: mainnet.environment, network: mainnet.network, asset: mainnet.asset, configured: mainnet.configured, rail: mainnet.rail.id },
      test: { environment: testnet.environment, network: testnet.network, asset: testnet.asset, configured: testnet.configured, rail: testnet.rail.id, revenue: false },
    },
  };
}

function toolsManifest(env) {
  const manifest = capabilities(env);
  return {
    name: manifest.name,
    version: manifest.version,
    canonical_mcp: manifest.discovery.mcp,
    canonical_api: API,
    recommended_order: [TOOL],
    optional_preparation: ["xguard.capabilities", "xguard.preflight", "xguard.pricing.quote"],
    execution_chokepoint: {
      tool: TOOL,
      endpoint: `${API}/v1/tools/web.fetch`,
      payment: "x402-v2-exact-usdc",
      settlement_before_execution: true,
      replay_safe: true,
    },
    tools: manifest.tools,
    guarantees: manifest.guarantees,
  };
}

function pricing(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return {
    version: VERSION,
    currency: "USDC",
    decimals: 6,
    free_tools: ["xguard.capabilities", "xguard.preflight", "xguard.pricing.quote"],
    preflight_endpoint: `${API}/v1/preflight`,
    tools: {
      [TOOL]: {
        available: mainnet.configured,
        payment_environment: mainnet.environment,
        formula: "customer_price = maximum_upstream_cost + configured_xguard_margin",
        maximum_upstream_cost_usd_micros: 0,
        xguard_margin_usd_micros: mainnet.marginUsdMicros,
        customer_price_usd_micros: mainnet.customerPriceUsdMicros,
        amount_atomic: mainnet.amount,
        network: mainnet.network,
        asset: mainnet.asset,
        payment_rails: [{ id: mainnet.rail.id, provider: "x402", environment: mainnet.environment, network: mainnet.network, asset: mainnet.asset, configured: mainnet.configured }],
        testnet: { environment: testnet.environment, revenue: false, network: testnet.network, asset: testnet.asset, amount_atomic: testnet.amount, configured: testnet.configured, rail: testnet.rail.id },
      },
    },
    quote_endpoint: `${API}/v1/pricing/quote`,
    quote_ttl_seconds: QUOTE_TTL_SECONDS,
    quote_request: quoteRequestGuidance(),
    paid_flow: {
      preflight: "Optional free preflight validates target safety and payment readiness without contacting the target.",
      execute: `POST ${mainnet.resource}`,
      testnet_execute: `POST ${testnet.resource}`,
      request_body: { url: "https://example.com/" },
      first_response: "HTTP 402 with Payment-Required, an automatically created signed quote, and X-XGuard-Quote",
      retry: "Sign the advertised x402 v2 requirements and retry the identical request with Payment-Signature.",
      success: "HTTP 200 with Payment-Response, signed receipt, and ProofRail evidence",
    },
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function quoteRequestGuidance() {
  return {
    endpoint: `${API}/v1/pricing/quote`,
    method: "POST",
    content_type: "application/json",
    canonical_shape: QUOTE_CANONICAL_EXAMPLE,
    accepted_shapes: QUOTE_ACCEPTED_SHAPES,
    required: { url: "A public HTTPS URL without credentials or a fragment." },
    optional: {
      tool: { accepted: [TOOL], default: TOOL },
      method: { accepted: ["GET", "HEAD"], default: "GET" },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 10000, default: 8000, aliases: ["timeoutMs"] },
      max_bytes: { type: "integer", minimum: 1024, maximum: HARD_MAX_BYTES, default: HARD_MAX_BYTES, aliases: ["maxBytes"] },
      mode: { accepted: ["auto", "text", "json"], default: "auto" },
      testnet: { type: "boolean", default: false, equivalent_network: TESTNET },
      network: { accepted: [MAINNET, TESTNET, "base", "base-mainnet", "base-sepolia"] },
    },
    url_aliases: ["url", "target_url", "targetUrl", "uri", "target", "resource", "endpoint", "href"],
    deterministic_command_aliases: ["curl", "command"],
    next: "Fastest path: call the paid execution URL directly with the input. XGuard automatically creates the same signed quote and returns it with HTTP 402. Construct an official x402 v2 Payment-Signature from Payment-Required and retry the identical request. Advanced clients may request this quote separately first.",
  };
}

function preflightRequestGuidance() {
  return {
    endpoint: `${API}/v1/preflight`,
    method: "POST",
    content_type: "application/json",
    canonical_shape: QUOTE_CANONICAL_EXAMPLE,
    accepted_shapes: QUOTE_ACCEPTED_SHAPES,
    required: { url: "A public HTTPS URL without credentials or a fragment." },
    optional: quoteRequestGuidance().optional,
    purpose: "Optionally check XGuard's public-HTTPS and payment path before the paid call. The target is not fetched and no payment is attempted.",
    next: `POST the same normalized input directly to ${API}/v1/tools/web.fetch. XGuard creates the signed quote and returns it with the HTTP 402 x402-v2 challenge. A separate quote request is optional.`,
  };
}

function preflightSchema() {
  return {
    name: "xguard.preflight",
    title: "Preflight a guarded paid request",
    version: VERSION,
    free: true,
    target_contacted: false,
    input: quoteRequestSchema(),
    response: {
      decision: "allow | blocked",
      normalized_input: fetchInputSchema(),
      checks: ["https", "public_dns", "ssrf_policy", "payment_path"],
      next: { execution_url: `${API}/v1/tools/web.fetch`, quote_url_optional: `${API}/v1/pricing/quote`, expected_first_status: 402 },
    },
    guidance: preflightRequestGuidance(),
  };
}

export async function handlePreflight(env, raw, id, observation = {}) {
  const normalized = normalizeQuoteRequest(raw);
  if (!normalized.ok) {
    await observeStage(env, "preflight", id, {
      traffic_class: observation.trafficClass,
      transport: observation.transport || "http",
      outcome: "rejected",
      metric: { outcome: "rejected" },
    });
    return error(normalized.code, normalized.code === "unsupported_tool" ? 422 : 400, id, {
      details: { issues: normalized.issues, retry: preflightRequestGuidance() },
    });
  }

  const input = normalized.input;
  const hostname = new URL(input.url).hostname;
  const targetCheck = await publicDns(hostname);
  if (!targetCheck.ok) {
    const status = targetCheck.code === "dns_unavailable" ? 503 : targetCheck.code === "dns_unresolved" ? 422 : 403;
    const retryable = status === 503;
    await observeStage(env, "preflight", id, {
      traffic_class: observation.trafficClass,
      transport: observation.transport || "http",
      outcome: targetCheck.code,
      metric: { outcome: targetCheck.code },
    });
    return error(targetCheck.code, status, id, {
      retryable,
      details: {
        issues: [{ path: "url", code: targetCheck.code, message: retryable ? "Trusted public DNS resolvers are temporarily unavailable; retry the same preflight." : "The hostname is not a permitted public HTTPS destination." }],
        retry: preflightRequestGuidance(),
        target_contacted: false,
      },
    });
  }

  const config = gatewayConfig(env, normalized.testnet);
  if (!config.configured || !env.PROOF_AUTHORITY || !env.PAID_GATEWAY) {
    await observeStage(env, "preflight", id, {
      traffic_class: observation.trafficClass,
      transport: observation.transport || "http",
      network: config.network,
      outcome: "payment_not_configured",
      metric: { outcome: "payment_not_configured" },
    });
    return error("payment_not_configured", 503, id, {
      retryable: true,
      details: {
        issues: [{ path: "payment", code: "payment_not_configured", message: `The ${config.network} paid path cannot issue a safe quote right now.` }],
        retry: preflightRequestGuidance(),
        target_contacted: false,
      },
    });
  }

  await observeStage(env, "preflight", id, {
    traffic_class: observation.trafficClass,
    transport: observation.transport || "http",
    tool: TOOL,
    network: config.network,
    outcome: "allow",
    metric: { outcome: "allow" },
  });
  return json({
    request_id: id,
    tool: TOOL,
    decision: "allow",
    target_contacted: false,
    normalized_input: input,
    network: config.network,
    asset: config.asset,
    price: { amount_atomic: config.amount, currency: "USDC", decimals: 6 },
    checks: [
      { id: "https", status: "pass", detail: "HTTPS URL has no credentials or fragment." },
      { id: "ssrf_policy", status: "pass", detail: "Private, local, metadata and XGuard-owned destinations are blocked." },
      { id: "public_dns", status: "pass", addresses_checked: targetCheck.addresses?.length || 0, detail: "A and AAAA answers were validated through trusted public resolvers." },
      { id: "payment_path", status: "pass", detail: "Signed quote and x402 v2 settlement path are configured for the selected network." },
    ],
    next: {
      execution_url: normalized.testnet ? `${API}/v1/tools/web.fetch/testnet` : `${API}/v1/tools/web.fetch`,
      quote_url_optional: `${API}/v1/pricing/quote`,
      method: "POST",
      body: { ...input, testnet: normalized.testnet },
      expected_status: 402,
      instruction: "Send the normalized input directly to execution_url. XGuard returns Payment-Required and X-XGuard-Quote automatically; sign with an official x402 v2 client and retry the identical request with both headers.",
    },
    guidance: preflightRequestGuidance(),
  }, 200, { "x-xguard-request-id": id });
}

function validationError(code, id, issues, status = 400, retryable = false) {
  return error(code, status, id, {
    retryable,
    details: {
      issues: issues.map(issue => ({ field: issue.path, expected: issue.message, ...issue })),
      retry: quoteRequestGuidance(),
    },
  });
}

async function quoteRejection(env, code, id, issues, observation = {}, status = 400, retryable = false) {
  await observeStage(env, "quote_failed", id, {
    traffic_class: observation.trafficClass,
    transport: observation.transport || "http",
    outcome: code,
    drop_reason: code,
    metric: { retryable },
  });
  return { response: validationError(code, id, issues, status, retryable) };
}

function readAliased(source, names) {
  const entries = names
    .filter(name => Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined && source[name] !== null && source[name] !== "")
    .map(name => ({ name, value: source[name] }));
  if (!entries.length) return { value: undefined };
  const first = String(entries[0].value);
  if (entries.some(entry => String(entry.value) !== first)) return { conflict: entries.map(entry => entry.name) };
  return { value: entries[0].value };
}

function parseArguments(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.length > MAX_TOOL_REQUEST_BYTES) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCurlCommand(value) {
  if (typeof value !== "string" || value.length > MAX_TOOL_REQUEST_BYTES) return null;
  const trimmed = value.trim();
  if (!/^curl(?:\s|$)/i.test(trimmed)) return null;
  if (/\s(?:-X|--request)\s+(?!GET\b|HEAD\b)/i.test(trimmed) || /\s(?:-d|--data|--data-raw|--form)(?:\s|=)/i.test(trimmed)) return null;
  const method = /\s(?:-I|--head)(?:\s|$)/i.test(trimmed) ? "HEAD" : "GET";
  const urls = trimmed.match(/https:\/\/[^\s'"\\]+/gi) || [];
  if (urls.length !== 1) return null;
  return { url: urls[0], method };
}

function inputEnvelope(raw) {
  if (!isRecord(raw)) return { source: null, shape: null, issues: [{ path: "$", code: "object_required", message: "The JSON body must be an object." }] };
  const functionCall = isRecord(raw.function) ? raw.function : null;
  const structuredOperation = [raw.operation, raw.action, raw.request, raw.payload, raw.data].find(isRecord) || null;
  const candidates = [];
  for (const key of ["input", "arguments", "parameters", "params", "args"]) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = parseArguments(raw[key]);
    if (!value) return { source: null, shape: key, issues: [{ path: key, code: "object_required", message: `${key} must be a JSON object, or a JSON-encoded object for arguments.` }] };
    candidates.push({ key, value });
  }
  if (functionCall && Object.prototype.hasOwnProperty.call(functionCall, "arguments")) {
    const value = parseArguments(functionCall.arguments);
    if (!value) return { source: null, shape: "function.arguments", issues: [{ path: "function.arguments", code: "object_required", message: "function.arguments must contain a JSON object." }] };
    candidates.push({ key: "function.arguments", value });
  }
  if (!candidates.length && structuredOperation) {
    const nested = structuredOperation.arguments || structuredOperation.input || structuredOperation.parameters || structuredOperation.params || structuredOperation.args;
    candidates.push({ key: `${Object.entries(raw).find(([, value]) => value === structuredOperation)?.[0] || "operation"}${nested ? "_arguments" : ""}`, value: parseArguments(nested) || structuredOperation });
  }
  if (!candidates.length) {
    const command = raw.curl ?? raw.command;
    const parsedCommand = parseCurlCommand(command);
    if (command !== undefined && !parsedCommand) return { source: null, shape: "curl", issues: [{ path: "command", code: "unsupported_command", message: "Only one deterministic curl GET/HEAD command with an absolute HTTPS URL is accepted." }] };
    if (parsedCommand) candidates.push({ key: "curl", value: parsedCommand });
  }
  if (candidates.length > 1) {
    let first;
    try { first = canonicalize(candidates[0].value); } catch { first = null; }
    if (!first || candidates.some(candidate => canonicalize(candidate.value) !== first)) {
      return { source: null, shape: "conflicting", issues: [{ path: "$", code: "conflicting_envelopes", message: `Use one input envelope. Conflicting envelopes: ${candidates.map(candidate => candidate.key).join(", ")}.` }] };
    }
  }
  return { source: candidates[0]?.value || raw, shape: candidates[0]?.key || "canonical_flat", functionCall, issues: [] };
}

function normalizeFetchInputDetailed(raw) {
  const envelope = inputEnvelope(raw);
  if (!envelope.source) return { ok: false, issues: envelope.issues, shape: envelope.shape };
  const source = envelope.source;
  const issues = [];
  const urlValue = readAliased(source, ["url", "target_url", "targetUrl", "uri", "target", "resource", "endpoint", "href"]);
  if (urlValue.conflict) issues.push({ path: "url", code: "conflicting_aliases", message: `Provide only one URL value; conflicting fields: ${urlValue.conflict.join(", ")}.` });
  if (urlValue.value === undefined) issues.push({ path: "url", code: "required", message: "Provide url as a public HTTPS URL." });
  let target;
  if (urlValue.value !== undefined) {
    try { target = new URL(String(urlValue.value)); } catch { issues.push({ path: "url", code: "invalid_url", message: "url must be an absolute public HTTPS URL." }); }
  }
  if (target && (target.protocol !== "https:" || target.username || target.password || target.hash)) {
    issues.push({ path: "url", code: "https_public_url_required", message: "url must use HTTPS and must not include credentials or a fragment." });
  }
  const methodValue = readAliased(source, ["method", "http_method", "httpMethod"]);
  if (methodValue.conflict) issues.push({ path: "method", code: "conflicting_aliases", message: "Conflicting method aliases were supplied." });
  const method = String(methodValue.value || "GET").toUpperCase();
  if (!new Set(["GET", "HEAD"]).has(method)) issues.push({ path: "method", code: "unsupported_value", message: "method must be GET or HEAD." });
  const timeoutValue = readAliased(source, ["timeout_ms", "timeoutMs"]);
  if (timeoutValue.conflict) issues.push({ path: "timeout_ms", code: "conflicting_aliases", message: "Conflicting timeout aliases were supplied." });
  const timeoutMs = timeoutValue.value === undefined ? 8000 : Number(timeoutValue.value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10000) issues.push({ path: "timeout_ms", code: "out_of_range", message: "timeout_ms must be an integer from 1000 through 10000." });
  const maxBytesValue = readAliased(source, ["max_bytes", "maxBytes"]);
  if (maxBytesValue.conflict) issues.push({ path: "max_bytes", code: "conflicting_aliases", message: "Conflicting size-limit aliases were supplied." });
  const maxBytes = maxBytesValue.value === undefined ? HARD_MAX_BYTES : Number(maxBytesValue.value);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > HARD_MAX_BYTES) issues.push({ path: "max_bytes", code: "out_of_range", message: `max_bytes must be an integer from 1024 through ${HARD_MAX_BYTES}.` });
  const mode = String(source.mode || "auto").toLowerCase();
  if (!["auto", "text", "json"].includes(mode)) issues.push({ path: "mode", code: "unsupported_value", message: "mode must be auto, text, or json." });
  if (issues.length) return { ok: false, issues, shape: envelope.shape };
  return { ok: true, input: { url: target.toString(), method, timeout_ms: timeoutMs, max_bytes: maxBytes, mode }, shape: envelope.shape };
}

function normalizeFetchInput(raw) {
  const normalized = normalizeFetchInputDetailed(raw);
  return normalized.ok ? normalized.input : null;
}

function normalizeTool(raw, functionCall) {
  const nested = [raw?.operation, raw?.action, raw?.request, raw?.payload, raw?.data].find(isRecord);
  const values = [raw?.tool, raw?.tool_name, raw?.toolName, raw?.tool_id, raw?.toolId, raw?.capability, raw?.capability_id, raw?.capabilityId, raw?.name, functionCall?.name, nested?.tool, nested?.tool_name, nested?.toolName, nested?.capability, nested?.name]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => isRecord(value) ? value.name || value.id || "" : String(value))
    .filter(Boolean)
    .map(value => ({ "web.fetch": TOOL, "fetch": TOOL, "xguard_web_fetch": TOOL }[String(value).toLowerCase()] || String(value)));
  if (!values.length) return { value: TOOL };
  if (values.some(value => value !== values[0])) return { conflict: values };
  return { value: values[0] };
}

function normalizeNetwork(raw, source) {
  const booleanValues = [raw?.testnet, source?.testnet].filter(value => value !== undefined);
  if (booleanValues.some(value => typeof value !== "boolean")) return { issue: { path: "testnet", code: "boolean_required", message: "testnet must be true or false." } };
  if (booleanValues.length > 1 && booleanValues.some(value => value !== booleanValues[0])) return { issue: { path: "testnet", code: "conflicting_values", message: "Conflicting testnet values were supplied." } };
  const networkValues = [raw?.network, source?.network, raw?.chain, source?.chain, raw?.environment, source?.environment]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => String(value).toLowerCase());
  const aliases = new Map([
    [MAINNET, false], ["base", false], ["base-mainnet", false], ["mainnet", false], ["production", false],
    [TESTNET, true], ["base-sepolia", true], ["sepolia", true], ["testnet", true],
  ]);
  if (networkValues.some(value => !aliases.has(value))) return { issue: { path: "network", code: "unsupported_value", message: `network must be one of ${[...aliases.keys()].join(", ")}.` } };
  const requested = [...booleanValues, ...networkValues.map(value => aliases.get(value))];
  if (requested.length > 1 && requested.some(value => value !== requested[0])) return { issue: { path: "network", code: "conflicting_values", message: "testnet, network, chain, and environment must select the same network." } };
  return { testnet: requested[0] === true };
}

function normalizeQuoteRequest(raw) {
  const envelope = inputEnvelope(raw);
  if (!envelope.source) return { ok: false, code: envelope.shape === "conflicting" ? "ambiguous_input" : "invalid_input", issues: envelope.issues };
  const tool = normalizeTool(raw, envelope.functionCall);
  if (tool.conflict) return { ok: false, code: "ambiguous_input", issues: [{ path: "tool", code: "conflicting_values", message: `Conflicting tool names were supplied: ${tool.conflict.join(", ")}.` }] };
  if (tool.value !== TOOL) return { ok: false, code: "unsupported_tool", issues: [{ path: "tool", code: "unsupported_value", message: `Only ${TOOL} can currently receive a paid execution quote.` }] };
  const input = normalizeFetchInputDetailed(raw);
  if (!input.ok) return { ok: false, code: "invalid_input", issues: input.issues };
  const network = normalizeNetwork(raw, envelope.source);
  if (network.issue) return { ok: false, code: "ambiguous_input", issues: [network.issue] };
  return { ok: true, tool: TOOL, input: input.input, testnet: network.testnet, shape: envelope.shape };
}

function quoteNextStep(config, quoteToken, quote) {
  return {
    execution_url: config.resource,
    method: "POST",
    body: quote.input,
    quote: { header: "X-XGuard-Quote", value: quoteToken },
    expected_first_status: 402,
    payment: {
      protocol: "x402",
      rail: config.rail.id,
      environment: config.environment,
      version: 2,
      challenge_header: "Payment-Required",
      retry_header: "Payment-Signature",
      instructions: "Build an official x402 v2 payment payload from Payment-Required, sign it with the payer, then retry the identical execution request with Payment-Signature. Do not change the body or reuse this payment identifier for another request.",
    },
    success: "HTTP 200 returns the result, Payment-Response, a signed receipt, and ProofRail evidence.",
  };
}

export async function issueQuote(env, raw, id, observation = {}) {
  const normalized = normalizeQuoteRequest(raw);
  if (!normalized.ok) return quoteRejection(env, normalized.code, id, normalized.issues, observation);
  const input = normalized.input;
  const targetCheck = await publicDns(new URL(input.url).hostname);
  if (!targetCheck.ok) {
    const resolverUnavailable = targetCheck.code === "dns_unavailable";
    return quoteRejection(env, targetCheck.code, id, [{
      path: "url",
      code: targetCheck.code,
      message: resolverUnavailable
        ? "Trusted public DNS resolvers could not be reached. Retry the same quote request later."
        : "The hostname has no public A or AAAA address, or a private address was returned.",
    }], observation, resolverUnavailable ? 503 : targetCheck.code === "dns_unresolved" ? 422 : 403, resolverUnavailable);
  }
  const config = gatewayConfig(env, normalized.testnet);
  if (!config.configured || !env.PROOF_AUTHORITY || !env.PAID_GATEWAY) return quoteRejection(env, "payment_not_configured", id, [{ path: "$", code: "payment_not_configured", message: "The selected network cannot safely issue paid execution quotes right now." }], observation, 503, true);
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
    payment_environment: config.environment,
    payment_rail: config.rail.id,
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
  await observeStage(env, "quote_success", id, {
    traffic_class: observation.trafficClass,
    transport: observation.transport,
    tool: TOOL,
    network: config.network,
    request_shape: normalized.shape,
    environment: config.environment,
  });
  return {
    payload,
    quote,
    response: json({ quote, ...payload, request_shape: normalized.shape, next: quoteNextStep(config, quote, payload) }, 200, { "x-xguard-request-id": id }),
  };
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
  let trustedResponses = 0;
  let successfulFamilies = 0;
  let unavailableFamilies = 0;
  for (const type of ["A", "AAAA"]) {
    const resolvers = [
      { endpoint: "https://one.one.one.one/dns-query", accept: "application/dns-json", hosts: new Set(["one.one.one.one", "cloudflare-dns.com"]) },
      { endpoint: "https://cloudflare-dns.com/dns-query", accept: "application/dns-json", hosts: new Set(["cloudflare-dns.com", "one.one.one.one"]) },
      { endpoint: "https://dns.google/resolve", accept: "application/json", hosts: new Set(["dns.google"]) },
    ];
    const results = await Promise.allSettled(resolvers.map(async resolver => {
        const endpoint = new URL(resolver.endpoint);
        endpoint.searchParams.set("name", hostname);
        endpoint.searchParams.set("type", type);
        const response = await fetch(endpoint, { headers: { accept: resolver.accept }, signal: AbortSignal.timeout(2500), redirect: "follow" });
        if (!response.ok || !resolver.hosts.has(new URL(response.url || endpoint).hostname)) throw new Error("dns_resolver_unavailable");
        const candidate = await response.json().catch(() => null);
        if (!candidate || !Number.isInteger(Number(candidate.Status ?? 0))) throw new Error("dns_response_invalid");
        return candidate;
      }));
    const bodies = results.filter(result => result.status === "fulfilled").map(result => result.value);
    trustedResponses += bodies.length;
    const successful = bodies.filter(body => Number(body.Status ?? 0) === 0);
    if (successful.length) successfulFamilies += 1;
    else if (!bodies.length || bodies.some(body => ![0, 3].includes(Number(body.Status ?? 0)))) unavailableFamilies += 1;
    for (const body of successful) {
      for (const answer of Array.isArray(body?.Answer) ? body.Answer : []) {
        if (answer.type === 1 || answer.type === 28) answers.push(String(answer.data || ""));
      }
    }
  }
  if (!trustedResponses || unavailableFamilies) return { ok: false, code: "dns_unavailable" };
  if (successfulFamilies < 2) return { ok: false, code: "dns_unresolved" };
  if (!answers.length || answers.some(address => isPrivateIpv4(address) || isPrivateIpv6(address))) return { ok: false, code: answers.length ? "target_not_public" : "dns_unresolved" };
  return { ok: true, addresses: [...new Set(answers)] };
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
  if (!paymentStateCanTransition(record.status, next)) throw new Error("invalid_financial_transition");
  const updated = { ...record, ...patch, status: next, updated_at: new Date().toISOString() };
  if (next === "settled") {
    if (!patch.transaction || !patch.network) throw new Error("settlement_evidence_required");
    updated.settled_at = updated.updated_at;
    const economicallyReal = isRealRevenueSettlement(record, { success: true, network: patch.network, transaction: patch.transaction });
    updated.gross_revenue_usd_micros = economicallyReal ? Number(record.customer_price_usd_micros || 0) : 0;
    updated.actual_upstream_cost_usd_micros = economicallyReal ? Number(record.maximum_upstream_cost_usd_micros || 0) : 0;
    updated.credit_liability_usd_micros = 0;
    updated.net_profit_usd_micros = updated.gross_revenue_usd_micros - updated.actual_upstream_cost_usd_micros;
    updated.revenue_source = economicallyReal ? "external_production_x402_settlement" : `${record.environment || "unknown"}_settlement_non_revenue`;
  } else if (!["succeeded", "credited"].includes(next) && !record.settled_at) {
    updated.gross_revenue_usd_micros = 0;
    updated.actual_upstream_cost_usd_micros = 0;
    updated.credit_liability_usd_micros = 0;
    updated.net_profit_usd_micros = 0;
    updated.revenue_source = null;
  }
  if (next === "credited") {
    if (!record.settled_at) throw new Error("credit_requires_settlement");
    updated.credit_liability_usd_micros = record.gross_revenue_usd_micros > 0 ? Number(record.customer_price_usd_micros || 0) : 0;
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
      const current = await this.state.storage.get("metrics:v1") || { started_at: new Date().toISOString(), events: {}, outcomes: {}, test_volume_usd_micros: 0, real_revenue_usd_micros: 0, qualified_external_executions: 0, latency_ms_total: 0, latency_samples: 0 };
      current.events[body.event] = Number(current.events[body.event] || 0) + 1;
      if (body.outcome) {
        const outcome = safeReason(body.outcome, "unknown");
        const key = `${body.event}:${outcome}`;
        current.outcomes ||= {};
        current.outcomes[key] = Number(current.outcomes[key] || 0) + 1;
      }
      if (body.event === "settlement_success" && body.environment === PAYMENT_ENVIRONMENTS.TEST) current.test_volume_usd_micros = Number(current.test_volume_usd_micros || 0) + Math.max(0, Number(body.amount_usd_micros || 0));
      if (body.event === "settlement_success" && body.real_revenue === true && body.environment === PAYMENT_ENVIRONMENTS.PRODUCTION && body.traffic_class === "external") current.real_revenue_usd_micros = Number(current.real_revenue_usd_micros || 0) + Math.max(0, Number(body.amount_usd_micros || 0));
      if (body.event === "execution_success" && body.environment === PAYMENT_ENVIRONMENTS.PRODUCTION && body.traffic_class === "external") current.qualified_external_executions = Number(current.qualified_external_executions || 0) + 1;
      if (body.event === "succeeded" && Number.isFinite(Number(body.latency_ms))) {
        current.latency_ms_total += Math.max(0, Number(body.latency_ms));
        current.latency_samples += 1;
      }
      current.updated_at = new Date().toISOString();
      await this.state.storage.put("metrics:v1", current);
      return doJson({ ok: true });
    }

    if (path === "/index/metrics") {
      const current = await this.state.storage.get("metrics:v1") || { started_at: new Date().toISOString(), events: {}, outcomes: {}, test_volume_usd_micros: 0, real_revenue_usd_micros: 0, qualified_external_executions: 0, latency_ms_total: 0, latency_samples: 0 };
      return doJson({
        ...current,
        test_volume_usd_micros: Number(current.test_volume_usd_micros || 0),
        real_revenue_usd_micros: Number(current.real_revenue_usd_micros || 0),
        settled_usd_micros: Number(current.real_revenue_usd_micros || 0),
        successful_external_paid_executions: Number(current.qualified_external_executions || 0),
        average_success_latency_ms: current.latency_samples ? Math.round(current.latency_ms_total / current.latency_samples) : null,
      });
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

    if (path === "/operation/claim-execution") {
      const existing = await this.state.storage.get("operation");
      if (!existing) return doJson({ error: "operation_not_found" }, 404);
      if (existing.status === "succeeded") return doJson({ ok: true, replay: true, record: existing });
      if (!new Set(["settled", "credited"]).has(existing.status)) return doJson({ error: "operation_not_settled", status: existing.status }, 409);
      const activeUntil = Date.parse(existing.execution_claim?.expires_at || "");
      if (Number.isFinite(activeUntil) && activeUntil > Date.now()) return doJson({ error: "execution_in_progress", status: existing.status }, 409);
      const claim = { token: crypto.randomUUID(), claimed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() };
      const record = { ...existing, execution_claim: claim, execution_attempts: Number(existing.execution_attempts || 0) + 1, updated_at: claim.claimed_at };
      await this.state.storage.put("operation", record);
      return doJson({ ok: true, replay: false, claim_token: claim.token, record });
    }

    if (path === "/operation/complete") {
      const existing = await this.state.storage.get("operation");
      if (existing?.status === "succeeded") return doJson({ ok: true, replay: true, record: existing });
      if (!existing || !["settled", "credited"].includes(existing.status)) return doJson({ error: "operation_not_settled" }, 409);
      if (existing.execution_claim?.token && body.claim_token !== existing.execution_claim.token) return doJson({ error: "execution_claim_invalid" }, 409);
      const record = safeFinancialPatch(existing, "succeeded", {
        result: body.result,
        settlement: body.settlement,
        receipt: body.receipt,
        proof: body.proof,
        payment_response: body.payment_response,
        execution_claim: null,
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

function trafficClass(request) {
  const declared = String(request?.headers?.get("x-xguard-traffic-class") || "").toLowerCase();
  if (["synthetic", "monitoring", "registry", "security_scan"].includes(declared)) return declared;
  const agent = String(request?.headers?.get("user-agent") || "").toLowerCase();
  if (/mcpbeat|uptime|healthcheck|better uptime|pingdom|statuscake/.test(agent)) return "monitoring";
  if (/registry|glama|smithery|mcpcentral|cardwall|agent.?card/.test(agent)) return "registry";
  if (/scanner|security|cloudflare.*scan/.test(agent)) return "security_scan";
  return "external";
}

async function observeStage(env, event, id, details = {}) {
  if (!JOURNEY_EVENTS.has(event)) return;
  const traffic = ["external", "synthetic", "monitoring", "registry", "security_scan"].includes(details.traffic_class) ? details.traffic_class : "external";
  const safe = {
    event,
    conversion_stage: event,
    request_id: id,
    traffic_class: traffic,
    ...(details.transport ? { transport: safeLabel(details.transport) } : {}),
    ...(details.surface ? { surface: safeLabel(details.surface) } : {}),
    ...(details.tool ? { tool: safeLabel(details.tool) } : {}),
    ...(details.network ? { network: String(details.network) } : {}),
    ...(details.request_shape ? { request_shape: safeLabel(details.request_shape) } : {}),
    ...(details.outcome ? { outcome: safeReason(details.outcome, "unknown") } : {}),
    ...(details.drop_reason ? { drop_reason: safeReason(details.drop_reason, "unknown") } : {}),
    ...(details.amount_atomic ? { amount_atomic: String(details.amount_atomic) } : {}),
    ...(details.environment ? { environment: safeLabel(details.environment) } : {}),
    ...(details.payment_state ? { payment_state: safeLabel(details.payment_state) } : {}),
  };
  console.log(JSON.stringify(safe));
  if (traffic === "external") {
    const metric = { ...(details.metric || {}) };
    if (details.outcome) metric.outcome = safeReason(details.outcome, "unknown");
    if (details.drop_reason) metric.drop_reason = safeReason(details.drop_reason, "unknown");
    metric.traffic_class = traffic;
    if (details.environment) metric.environment = safeLabel(details.environment);
    await recordMetric(env, event, metric);
  }
}

export async function recordAgentJourney(request, env, event, details = {}) {
  const id = details.request_id || requestId(request);
  await observeStage(env, event, id, { ...details, traffic_class: trafficClass(request) });
  return id;
}

async function logFinancialEvent(event, requestIdValue, paymentIdentifier, details = {}) {
  console.log(JSON.stringify({ event, request_id: requestIdValue, payment_identifier_hash: await sha256(paymentIdentifier), ...details }));
}

function safeReason(value, fallback) {
  const reason = String(value || fallback || "unknown");
  return /^[a-z0-9_-]{1,80}$/i.test(reason) ? reason : String(fallback || "unknown");
}

function safeLabel(value, fallback = "unknown") {
  const normalized = String(value || "").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return normalized || fallback;
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

async function paymentRequired(env, config, quoteToken, quote, id, reason = "payment_required", observation = {}) {
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
        paymentEnvironment: config.environment,
        paymentRail: config.rail.id,
        inputDigest: quote.input_digest,
        proofKey: `${API}/.well-known/xguard-proof-key.json`,
        next: {
          action: "sign_and_retry",
          payment_header: "Payment-Signature",
          instructions: "Use an official x402 v2 client to sign the Payment-Required requirements, then retry the identical request with Payment-Signature. Preserve Payment-Identifier and do not change the request body.",
          success: "HTTP 200 returns Payment-Response, a signed receipt, and ProofRail evidence.",
        },
      },
    },
  };
  await observeStage(env, "payment_required", id, {
    traffic_class: observation.trafficClass,
    transport: observation.transport,
    tool: TOOL,
    network: config.network,
    amount_atomic: config.amount,
    environment: config.environment,
    payment_state: "pending",
  });
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: headers({
      "payment-required": encodePaymentRequiredHeader(challenge),
      "x-xguard-request-id": id,
      "x-xguard-payment-identifier": quote.payment_identifier,
      "x-xguard-quote": quoteToken,
      "x-xguard-payment-environment": config.environment,
      "x-xguard-payment-rail": config.rail.id,
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
    && (!result.asset || String(result.asset).toLowerCase() === config.asset.toLowerCase())
    && (!result.payTo || String(result.payTo).toLowerCase() === config.payTo.toLowerCase())
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
    payment_environment: record.environment,
    payment_rail: record.payment_rail,
    receipt_signature_sha256: await sha256(receipt.signature),
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
    environment: record.environment,
    payment_rail: record.payment_rail,
    revenue: record.gross_revenue_usd_micros > 0,
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
    "x-xguard-payment-environment": record.environment || "unknown",
    "x-xguard-payment-rail": record.payment_rail || "x402",
    "x-xguard-replay": replay ? "true" : "false",
    "x-xguard-receipt": record.receipt?.signature || "",
    "x-xguard-proof": record.proof?.proof || "",
  });
}

async function executeSettledOperation({ stub, env, record, settlement, observation = {}, resumed = false }) {
  const claim = await postStub(stub, "/operation/claim-execution", {});
  if (!claim.ok) {
    return error("settlement_ambiguous", 409, record.request_id, { retryable: true, details: { state: claim.body?.status || "execution_in_progress", status_url: `${API}/v1/operations/${record.payment_identifier}` } });
  }
  if (claim.body.replay) return successfulResponse(claim.body.record, true);
  record = claim.body.record;
  await observeStage(env, "execution_started", record.request_id, { traffic_class: observation.trafficClass || record.traffic_class, transport: observation.transport || record.transport || "reconcile", tool: TOOL, network: record.network, amount_atomic: record.amount, environment: record.environment, payment_state: "settled" });
  let result;
  try {
    result = await performWebFetch(record.input);
    if (result.status >= 500) throw Object.assign(new Error("upstream_failed"), { code: "upstream_failed" });
  } catch (cause) {
    const code = cause?.code || "upstream_failed";
    const credit = await issueExecutionCredit(env, record, code);
    await postStub(stub, "/operation/transition", { status: "credited", patch: { credit_token: credit.token, credit_id: credit.payload.credit_id, failure_code: code, execution_claim: null } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "credited" });
    await recordMetric(env, "upstream_failed", { traffic_class: record.traffic_class, environment: record.environment });
    await recordMetric(env, "credited", { traffic_class: record.traffic_class, environment: record.environment });
    await observeStage(env, "execution_failed", record.request_id, { traffic_class: observation.trafficClass || record.traffic_class, transport: observation.transport || record.transport || "reconcile", tool: TOOL, network: record.network, amount_atomic: record.amount, environment: record.environment, payment_state: "credited", outcome: code });
    await logFinancialEvent("paid_gateway_execution_credited", record.request_id, record.payment_identifier, { reason: code, network: record.network, amount_atomic: record.amount, transaction: settlement.transaction });
    return error("upstream_failed", code === "upstream_timeout" ? 504 : 502, record.request_id, { retryable: true, details: { execution_credit: credit.token, credit_id: credit.payload.credit_id, original_transaction: settlement.transaction } });
  }
  const artifacts = await deliveryArtifacts(env, record, settlement, result);
  const completed = await postStub(stub, "/operation/complete", { claim_token: claim.body.claim_token, result, settlement, receipt: artifacts.receipt, proof: artifacts.proof, payment_response: artifacts.paymentResponseHeader });
  if (!completed.ok) return error("settlement_ambiguous", 409, record.request_id, { retryable: true, details: { status_url: `${API}/v1/operations/${record.payment_identifier}` } });
  await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: record.payment_identifier, authorization_fingerprint: record.authorization_fingerprint, status: "succeeded" });
  const finalRecord = completed.body.record;
  await recordMetric(env, "succeeded", { latency_ms: result.latency_ms, traffic_class: finalRecord.traffic_class, environment: finalRecord.environment });
  await observeStage(env, "execution_success", finalRecord.request_id, { traffic_class: observation.trafficClass || finalRecord.traffic_class, transport: observation.transport || finalRecord.transport || "reconcile", tool: TOOL, network: finalRecord.network, amount_atomic: finalRecord.amount, environment: finalRecord.environment, payment_state: "settled", outcome: "succeeded" });
  console.log(JSON.stringify({ event: "paid_gateway_succeeded", request_id: finalRecord.request_id, payment_identifier_hash: await sha256(finalRecord.payment_identifier), tool: TOOL, target_host: new URL(finalRecord.input.url).hostname, network: finalRecord.network, environment: finalRecord.environment, amount_atomic: finalRecord.amount, transaction: settlement.transaction, latency_ms: result.latency_ms, revenue_usd_micros: finalRecord.gross_revenue_usd_micros, upstream_cost_usd_micros: finalRecord.actual_upstream_cost_usd_micros, net_profit_usd_micros: finalRecord.net_profit_usd_micros, resumed }));
  return successfulResponse(finalRecord, false);
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
  await observeStage(env, "settlement_success", record.request_id, {
    traffic_class: record.traffic_class,
    transport: record.transport || "reconcile",
    tool: TOOL,
    network: record.network,
    amount_atomic: record.amount,
    environment: record.environment,
    payment_state: "settled",
    metric: {
      amount_usd_micros: record.environment === PAYMENT_ENVIRONMENTS.TEST ? record.customer_price_usd_micros : record.gross_revenue_usd_micros,
      real_revenue: record.gross_revenue_usd_micros > 0,
    },
  });
  const localStub = {
    fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      return new PaidGatewayState(state, env).fetch(request);
    },
  };
  await executeSettledOperation({ stub: localStub, env, record, settlement, observation: { trafficClass: record.traffic_class, transport: record.transport || "reconcile" }, resumed: true });
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

export async function handlePaidWebFetch(request, env, id, rawInput, forceTestnet = false, transport = "http") {
  const observation = { trafficClass: trafficClass(request), transport };
  if (!env.PROOF_AUTHORITY || !env.PAID_GATEWAY) return error("payment_not_configured", 503, id);
  const rate = await rateLimit(request, env, "paid-execution", 30);
  if (!rate.allowed) return error("rate_limited", 429, id, { retryable: true, details: { retry_after_seconds: rate.retry_after_seconds } });
  const normalizedInput = normalizeFetchInputDetailed(rawInput);
  if (!normalizedInput.ok) return validationError("invalid_input", id, normalizedInput.issues);
  const input = normalizedInput.input;
  await observeStage(env, "tool_call_valid", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, environment: forceTestnet ? "test" : "production" });
  const envelope = inputEnvelope(rawInput);
  let quoteToken = request.headers.get("x-xguard-quote") || rawInput?.quote || envelope.source?.quote;
  let quote;
  if (!quoteToken) {
    await observeStage(env, "quote_attempt", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, environment: forceTestnet ? "test" : "production" });
    const requestedTestnet = rawInput?.testnet;
    if (requestedTestnet !== undefined && typeof requestedTestnet !== "boolean") {
      return validationError("invalid_input", id, [{ path: "testnet", code: "boolean_required", message: "testnet must be true or false." }]);
    }
    if (requestedTestnet !== undefined && requestedTestnet !== forceTestnet) {
      return validationError("invalid_input", id, [{
        path: "testnet",
        code: "route_environment_mismatch",
        message: forceTestnet
          ? "Use testnet=true with /v1/tools/web.fetch/testnet."
          : "Use testnet=false or omit it with /v1/tools/web.fetch; use /v1/tools/web.fetch/testnet for Base Sepolia.",
      }]);
    }
    const quoteInput = { ...rawInput, testnet: forceTestnet };
    const issued = await issueQuote(env, quoteInput, id, observation);
    if (!issued.payload) return issued.response;
    quoteToken = issued.quote;
    quote = issued.payload;
    const autoConfig = gatewayConfig(env, forceTestnet);
    return paymentRequired(env, autoConfig, quoteToken, quote, id, "payment_required", observation);
  }
  quote = await verifyJws(env, quoteToken);
  if (!quote || quote.typ !== "xguard-price-quote" || quote.iss !== API || quote.tool !== TOOL) return error("quote_invalid", 400, id);
  if (quote.expires_at <= Math.floor(Date.now() / 1000)) return error("quote_expired", 400, id);
  const config = gatewayConfig(env, quote.network === TESTNET);
  const requestPath = new URL(request.url).pathname;
  const directRouteMismatch = (requestPath === "/v1/tools/web.fetch/testnet" && quote.network !== TESTNET)
    || (requestPath === "/v1/tools/web.fetch" && quote.network === TESTNET);
  if (!config.configured || (forceTestnet && quote.network !== TESTNET) || directRouteMismatch) return error("quote_invalid", 400, id);
  const digest = await sha256(canonicalize(input));
  if (quote.aud !== config.resource || quote.input_digest !== digest || quote.network !== config.network || quote.payment_environment !== config.environment || quote.payment_rail !== config.rail.id || quote.asset.toLowerCase() !== config.asset.toLowerCase() || quote.pay_to.toLowerCase() !== config.payTo.toLowerCase() || quote.amount !== config.amount || quote.customer_price_usd_micros !== config.customerPriceUsdMicros || quote.upstream_cost_max_usd_micros !== 0 || quote.xguard_margin_usd_micros !== config.marginUsdMicros || quote.payment_identifier == null) return error("quote_invalid", 400, id);

  const firstTarget = await publicDns(new URL(input.url).hostname);
  if (!firstTarget.ok) return error(firstTarget.code, firstTarget.code === "dns_unresolved" ? 422 : 403, id);
  const credited = await useExecutionCredit(request, env, quote, config, input, id);
  if (credited) return credited;

  const signatureHeader = request.headers.get("payment-signature");
  if (!signatureHeader) return paymentRequired(env, config, quoteToken, quote, id, "payment_required", observation);
  await observeStage(env, "payment_attempt", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, environment: config.environment, payment_state: "pending" });
  await observeStage(env, "payment_payload_received", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, environment: config.environment, payment_state: "pending" });
  let paymentPayload;
  try { paymentPayload = decodePaymentSignatureHeader(signatureHeader); } catch {
    await observeStage(env, "payment_parse_failed", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, environment: config.environment, payment_state: "pending", outcome: "malformed_payment_signature" });
    return error("payment_payload_invalid", 400, id);
  }
  const requirements = paymentRequirements(config, quote);
  const paymentIdentifier = extractPaymentIdentifier(paymentPayload, true);
  const identity = authIdentity(paymentPayload);
  if (paymentPayload?.x402Version !== 2 || !requirementsMatch(paymentPayload?.accepted, requirements) || (paymentPayload.resource?.url && paymentPayload.resource.url !== config.resource) || paymentIdentifier !== quote.payment_identifier || !identity) {
    await observeStage(env, "payment_parse_failed", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, environment: config.environment, payment_state: "pending", outcome: "payment_binding_mismatch" });
    return error("payment_payload_invalid", 400, id);
  }
  await observeStage(env, "payment_authorization_received", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, environment: config.environment, payment_state: "pending" });
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
    environment: config.environment,
    traffic_class: observation.trafficClass,
    transport,
    payment_rail: config.rail.id,
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
    if (record.status === "settled") return executeSettledOperation({ stub, env, record, settlement: record.settlement || { success: true, transaction: record.transaction, network: record.network, payer: record.payer }, observation, resumed: true });
    if (record.status === "failed") return paymentRequired(env, config, quoteToken, quote, record.request_id, "previous_payment_failed", observation);
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
    return paymentRequired(env, config, quoteToken, quote, id, verification?.invalidReason || "payment_verification_failed", observation);
  }
  await postStub(stub, "/operation/transition", { status: "verified", patch: { verified_at: new Date().toISOString(), payer: verification.payer || identity.from } });
  await observeStage(env, "payment_verified", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, environment: config.environment, payment_state: "verified" });

  let settlement;
  await observeStage(env, "settlement_started", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, environment: config.environment, payment_state: "verified" });
  try { settlement = await facilitator.settle(paymentPayload, requirements); } catch (cause) {
    const classified = classifyFacilitatorError(cause);
    const status = classified.ambiguous ? "ambiguous" : "failed";
    await postStub(stub, "/operation/transition", { status, patch: { failure_stage: "settle", failure_reason: classified.reason } });
    await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status });
    if (classified.ambiguous) await recordMetric(env, "settlement_ambiguous");
    await observeStage(env, "settlement_failed", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, outcome: classified.ambiguous ? "ambiguous" : "failed" });
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
    if (ambiguous) await recordMetric(env, "settlement_ambiguous");
    await observeStage(env, "settlement_failed", id, { traffic_class: observation.trafficClass, transport, tool: TOOL, network: config.network, amount_atomic: config.amount, outcome: ambiguous ? "ambiguous" : "failed" });
    await logFinancialEvent(ambiguous ? "paid_gateway_settlement_ambiguous" : "paid_gateway_settlement_failed", id, paymentIdentifier, { reason: safeReason(settlement?.errorReason, "invalid_settlement_response"), network: config.network, amount_atomic: config.amount });
    return error(ambiguous ? "settlement_ambiguous" : "settlement_failed", ambiguous ? 503 : 402, id, { retryable: true });
  }
  const settled = await postStub(stub, "/operation/transition", { status: "settled", patch: { transaction: settlement.transaction, network: settlement.network, payer: settlement.payer || identity.from, settlement } });
  await postStub(gatewayIndex(env), "/index/finalize", { payment_identifier: paymentIdentifier, authorization_fingerprint: authorizationFingerprint, status: "settled" });
  await observeStage(env, "settlement_success", id, {
    traffic_class: observation.trafficClass,
    transport,
    tool: TOOL,
    network: config.network,
    amount_atomic: config.amount,
    environment: config.environment,
    payment_state: "settled",
    metric: { amount_usd_micros: config.customerPriceUsdMicros, environment: config.environment, traffic_class: observation.trafficClass, real_revenue: isRealRevenueSettlement(settled.body.record, settlement) },
  });
  return executeSettledOperation({ stub, env, record: settled.body.record, settlement, observation, resumed: false });
}

function fetchInputSchema({ quote = false, quoteOptional = false, quoteNetwork = false } = {}) {
  const properties = {
    url: { type: "string", format: "uri", pattern: "^https://", description: "Canonical public HTTPS target URL." },
    target_url: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    targetUrl: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    uri: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    target: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    resource: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    endpoint: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    href: { type: "string", format: "uri", pattern: "^https://", deprecated: true, description: "Accepted alias for url." },
    curl: { type: "string", description: "One deterministic curl GET/HEAD command containing one absolute HTTPS URL." },
    command: { type: "string", description: "Alias for curl." },
    operation: { oneOf: [{ type: "string" }, { type: "object" }], description: "OpenAPI/MCP-style operation envelope." },
    action: { oneOf: [{ type: "string" }, { type: "object" }], description: "Action envelope." },
    method: { type: "string", enum: ["GET", "HEAD"], default: "GET" },
    timeout_ms: { type: "integer", minimum: 1000, maximum: 10000, default: 8000 },
    timeoutMs: { type: "integer", minimum: 1000, maximum: 10000, deprecated: true },
    max_bytes: { type: "integer", minimum: 1024, maximum: HARD_MAX_BYTES, default: HARD_MAX_BYTES },
    maxBytes: { type: "integer", minimum: 1024, maximum: HARD_MAX_BYTES, deprecated: true },
    mode: { type: "string", enum: ["auto", "text", "json"], default: "auto" },
  };
  if (quote || quoteOptional) properties.quote = { type: "string", description: "Compact signed quote returned by xguard.pricing.quote." };
  if (quoteNetwork) {
    properties.testnet = { type: "boolean", default: false };
    properties.network = { type: "string", enum: [MAINNET, TESTNET, "base", "base-mainnet", "base-sepolia", "mainnet", "testnet"] };
  }
  return {
    type: "object",
    ...(quote ? { required: ["quote"] } : {}),
    anyOf: ["url", "target_url", "targetUrl", "uri", "target", "resource", "endpoint", "href", "curl", "command", "operation", "action"].map(name => ({ required: [name] })),
    properties,
    additionalProperties: true,
  };
}

export function quoteRequestSchema() {
  const canonical = fetchInputSchema({ quoteNetwork: true });
  const toolName = { type: "string", enum: [TOOL, "web.fetch", "fetch", "xguard_web_fetch"] };
  return {
    oneOf: [
      canonical,
      {
        type: "object",
        required: ["input"],
        properties: { tool: toolName, toolName, tool_name: toolName, capability: toolName, capability_id: toolName, capabilityId: toolName, input: fetchInputSchema({ quoteNetwork: true }), testnet: { type: "boolean" }, network: canonical.properties.network },
        additionalProperties: true,
      },
      { type: "object", required: ["capability", "input"], properties: { capability: toolName, capability_id: toolName, capabilityId: toolName, input: fetchInputSchema({ quoteNetwork: true }), testnet: { type: "boolean" }, network: canonical.properties.network }, additionalProperties: true },
      {
        type: "object",
        required: ["name", "arguments"],
        properties: { name: toolName, arguments: { oneOf: [fetchInputSchema({ quoteNetwork: true }), { type: "string", contentMediaType: "application/json" }] }, testnet: { type: "boolean" }, network: canonical.properties.network },
        additionalProperties: true,
      },
      {
        type: "object",
        required: ["tool_name", "parameters"],
        properties: { tool_name: toolName, toolName, parameters: fetchInputSchema({ quoteNetwork: true }), testnet: { type: "boolean" }, network: canonical.properties.network },
        additionalProperties: true,
      },
      {
        type: "object",
        required: ["function"],
        properties: {
          function: { type: "object", required: ["name", "arguments"], properties: { name: toolName, arguments: { oneOf: [fetchInputSchema({ quoteNetwork: true }), { type: "string", contentMediaType: "application/json" }] } }, additionalProperties: true },
          testnet: { type: "boolean" },
          network: canonical.properties.network,
        },
        additionalProperties: true,
      },
    ],
    description: "Canonical form is a flat object with url. Explicitly supported agent envelopes are documented in x-xguard-accepted-shapes.",
    "x-xguard-accepted-shapes": QUOTE_ACCEPTED_SHAPES,
  };
}

function paidFetchSchema() {
  const canonical = fetchInputSchema({ quote: true });
  const nestedInput = fetchInputSchema();
  const envelopeFields = {
    testnet: { type: "boolean" },
    network: { type: "string", enum: [MAINNET, TESTNET, "base", "base-mainnet", "base-sepolia", "mainnet", "testnet"] },
    quote: { type: "string", description: "Compact signed quote returned by xguard.pricing.quote." },
  };
  return {
    oneOf: [
      canonical,
      { type: "object", required: ["tool", "input"], properties: { tool: { type: "string", enum: [TOOL] }, input: nestedInput, ...envelopeFields }, additionalProperties: true },
      { type: "object", required: ["name", "arguments"], properties: { name: { type: "string", enum: [TOOL] }, arguments: { oneOf: [nestedInput, { type: "string", contentMediaType: "application/json" }] }, ...envelopeFields }, additionalProperties: true },
      { type: "object", required: ["tool_name", "parameters"], properties: { tool_name: { type: "string", enum: [TOOL] }, parameters: nestedInput, ...envelopeFields }, additionalProperties: true },
      { type: "object", required: ["function"], properties: { function: { type: "object", required: ["name", "arguments"], properties: { name: { type: "string", enum: [TOOL] }, arguments: { oneOf: [nestedInput, { type: "string", contentMediaType: "application/json" }] }, }, additionalProperties: false }, ...envelopeFields }, additionalProperties: true },
    ],
    description: "Canonical and common AI-agent envelopes are accepted. A first call without a quote returns HTTP 402 plus an automatically created signed quote. Retry the identical request with X-XGuard-Quote and Payment-Signature.",
    "x-xguard-accepted-shapes": QUOTE_ACCEPTED_SHAPES.map(shape => shape.name),
  };
}

export { paidFetchSchema };

const PAID_MCP_TOOLS = [
  {
    name: "xguard.capabilities",
    title: "Discover XGuard capabilities",
    description: "Return the enabled and disabled XGuard tools, their security boundary, and canonical discovery URLs. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "xguard.preflight",
    title: "Preflight a guarded paid request",
    description: "Free, read-only safety gate for xguard.web.fetch. Validates the public HTTPS target, SSRF policy, DNS reachability and selected payment path without contacting the target or attempting payment. On allow, call xguard.web.fetch directly; it creates the signed quote and returns the mandatory x402 v2 PaymentRequired result.",
    inputSchema: quoteRequestSchema(),
    _meta: {
      "xguard/next": { execution_tool: TOOL, quote_url_optional: `${API}/v1/pricing/quote`, first_status: 402, challenge_header: "Payment-Required", quote_header: "X-XGuard-Quote", retry_header: "Payment-Signature" },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "xguard.pricing.quote",
    title: "Get a signed execution quote",
    description: "Optional free preview before xguard.web.fetch. Returns a five-minute signed, input-bound quote for 0.001 USDC; set testnet=true for Base Sepolia. The fastest path is to call xguard.web.fetch directly and receive this quote in its HTTP 402 response.",
    inputSchema: quoteRequestSchema(),
    _meta: {
      "xguard/pricing": { amount_atomic: DEFAULT_PRICE_ATOMIC, currency: "USDC", decimals: 6, mainnet: MAINNET, testnet: TESTNET },
      "xguard/next": { call: TOOL, first_status: 402, challenge_header: "Payment-Required", retry_header: "Payment-Signature" },
    },
    annotations: { readOnlyHint: true, idempotentHint: false },
  },
  {
    name: TOOL,
    title: "Fetch a public HTTPS resource",
    description: "Paid, read-only public HTTPS fetch. Call it directly with {url}; XGuard automatically creates an input-bound signed quote and returns an actionable x402 v2 PaymentRequired result for 0.001 USDC. Sign Payment-Required and retry the identical MCP request with Payment-Signature. Execution starts only after settlement and returns Payment-Response, a signed receipt, and ProofRail evidence. xguard.pricing.quote remains available for agents that want a quote before calling.",
    inputSchema: paidFetchSchema(),
    _meta: {
      "xguard/payment": { required: true, protocol: "x402", version: 2, price_atomic: DEFAULT_PRICE_ATOMIC, currency: "USDC", challenge_status: 402, challenge_header: "Payment-Required", retry_header: "Payment-Signature", settlement_before_execution: true },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
];

function mcpEnvelope(id, value, responseHeaders = {}) {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      resultType: "complete",
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      isError: false,
    },
  }, 200, responseHeaders);
}

async function mcpToolError(id, response, requestIdValue) {
  const value = await response.clone().json().catch(() => ({ error: { code: "tool_error", message: "The tool call failed." } }));
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      resultType: "complete",
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      isError: true,
    },
  }, 200, { "x-xguard-request-id": requestIdValue });
}

function mcpRpcError(id, code, message, status = 400, data) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }, status);
}

function validateMcpRequest(request, message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return mcpRpcError(message?.id, -32600, "Invalid Request", 400);
  }
  if ("id" in message && message.id !== null && typeof message.id !== "string" && typeof message.id !== "number") {
    return mcpRpcError(null, -32600, "Invalid Request", 400);
  }
  const methodHeader = request.headers.get("mcp-method");
  if (methodHeader && methodHeader !== message.method) {
    return mcpRpcError(message.id, -32600, "Mcp-Method header does not match JSON-RPC method", 400);
  }
  const nameHeader = request.headers.get("mcp-name");
  const bodyName = message.params?.name;
  if (nameHeader && (!bodyName || nameHeader !== bodyName)) {
    return mcpRpcError(message.id, -32600, "Mcp-Name header does not match JSON-RPC params.name", 400);
  }
  return null;
}

function mcpTransportResponse(response, message) {
  if (!(response instanceof Response)) return response;
  const next = new Headers(response.headers);
  next.set("mcp-protocol-version", "2026-07-28");
  next.set("mcp-method", message.method);
  if (message.params?.name) next.set("mcp-name", String(message.params.name));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: next });
}

function discoverMcp(id) {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-11-25"],
      capabilities: { tools: {} },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "xguard-universal-paid-secretless-gateway", version: VERSION } },
      instructions: "Call xguard.web.fetch directly with a public HTTPS URL. XGuard returns its signed price and x402 PaymentRequired automatically; sign and retry the identical call. Capabilities, preflight and standalone pricing quote are optional and free. XGuard never executes a paid tool before settlement.",
      ttlMs: 60000,
      cacheScope: "public",
    },
  }, 200, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" });
}

async function handlePaidMcp(request, env, id) {
  const parsed = await jsonBody(request.clone(), 32768);
  if (parsed.error === "invalid_json") return mcpRpcError(null, -32700, "Parse error", 400);
  if (parsed.error) return mcpRpcError(null, -32600, parsed.error, parsed.error === "payload_too_large" ? 413 : 400);
  const message = parsed.value;
  const invalid = validateMcpRequest(request, message);
  if (invalid) return invalid;
  const observation = { trafficClass: trafficClass(request), transport: "mcp" };
  if (message.method === "server/discover") {
    await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "mcp", surface: "server_discover" });
    return discoverMcp(message.id);
  }
  if (message.method === "initialize") await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "mcp", surface: "initialize" });
  if (message.method === "tools/list") await observeStage(env, "tools_list", id, { traffic_class: observation.trafficClass, transport: "mcp" });
  if (message.method === "tools/call") await observeStage(env, "tools_call", id, { traffic_class: observation.trafficClass, transport: "mcp", tool: String(message.params?.name || "unknown") });
  if (message?.method === "tools/call" && message?.params?.name === "xguard.capabilities") {
    return mcpTransportResponse(mcpEnvelope(message.id, capabilities(env), { "x-xguard-request-id": id }), message);
  }
  if (message?.method === "tools/call" && message?.params?.name === "xguard.preflight") {
    const preflight = await handlePreflight(env, message?.params?.arguments || {}, id, observation);
    if (!preflight.ok) return mcpTransportResponse(await mcpToolError(message.id, preflight, id), message);
    return mcpTransportResponse(mcpEnvelope(message.id, await preflight.clone().json(), { "x-xguard-request-id": id }), message);
  }
  if (message?.method === "tools/call" && message?.params?.name === "xguard.pricing.quote") {
    await observeStage(env, "quote_attempt", id, { traffic_class: observation.trafficClass, transport: "mcp", tool: TOOL });
    const quoted = await issueQuote(env, message?.params?.arguments || {}, id, observation);
    if (!quoted.response.ok) return mcpTransportResponse(await mcpToolError(message.id, quoted.response, id), message);
    return mcpTransportResponse(mcpEnvelope(message.id, await quoted.response.clone().json(), { "x-xguard-request-id": id }), message);
  }
  if (message?.method === "tools/call" && message?.params?.name === TOOL) {
    const paid = await handlePaidWebFetch(request, env, id, message?.params?.arguments || {}, false, "mcp");
    if (!paid.ok) return mcpTransportResponse(paid, message);
    const value = await paid.clone().json();
    const exposed = {};
    for (const name of ["payment-response", "x-xguard-request-id", "x-xguard-payment-identifier", "x-xguard-replay", "x-xguard-proof", "x-xguard-receipt"]) {
      const value = paid.headers.get(name);
      if (value) exposed[name] = value;
    }
    return mcpTransportResponse(mcpEnvelope(message.id, value, exposed), message);
  }
  return { message };
}

function mcpToolsForEnv(env) {
  const mainnet = gatewayConfig(env, false);
  const testnet = gatewayConfig(env, true);
  return PAID_MCP_TOOLS.map(tool => {
    if (tool.name === "xguard.pricing.quote") return { ...tool, _meta: { ...(tool._meta || {}), "xguard/pricing": { ...(tool._meta?.["xguard/pricing"] || {}), payment_readiness: `${API}/v1/payment/readiness`, production: { environment: mainnet.environment, network: mainnet.network, asset: mainnet.asset, amount_atomic: mainnet.amount, configured: mainnet.configured }, test: { environment: testnet.environment, network: testnet.network, asset: testnet.asset, amount_atomic: testnet.amount, configured: testnet.configured, revenue: false } } } };
    if (tool.name !== TOOL) return tool;
    return { ...tool, available: mainnet.configured, _meta: { ...(tool._meta || {}), "xguard/payment": { ...(tool._meta?.["xguard/payment"] || {}), payment_readiness: `${API}/v1/payment/readiness`, production: { environment: mainnet.environment, rail: mainnet.rail.id, network: mainnet.network, asset: mainnet.asset, amount_atomic: mainnet.amount, configured: mainnet.configured }, test: { environment: testnet.environment, rail: testnet.rail.id, network: testnet.network, asset: testnet.asset, amount_atomic: testnet.amount, configured: testnet.configured, revenue: false } } } };
  });
}

async function augmentMcpTools(message, response, env) {
  if (!(response instanceof Response) || !message) return response;
  if (!response.ok) return mcpTransportResponse(response, message);
  const body = await response.clone().json().catch(() => null);
  if (!body?.result || typeof body.result !== "object") return mcpTransportResponse(response, message);
  if (message.method === "tools/list" && Array.isArray(body.result.tools)) {
    for (const tool of [...mcpToolsForEnv(env)].reverse()) {
      const existing = body.result.tools.findIndex(item => item?.name === tool.name);
      if (existing >= 0) body.result.tools.splice(existing, 1);
      body.result.tools.unshift(tool);
    }
    body.result.resultType = "complete";
    body.result.ttlMs = 60000;
    body.result.cacheScope = "public";
  } else if (message.method === "tools/call") {
    body.result.resultType ||= "complete";
    if (typeof body.result.isError !== "boolean") body.result.isError = false;
  } else {
    return mcpTransportResponse(response, message);
  }
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return mcpTransportResponse(new Response(JSON.stringify(body), { status: response.status, headers: next }), message);
}

function mcpDiscovery(env) {
  return {
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    version: VERSION,
    transport: "streamable-http",
    endpoint: `${API}/mcp`,
    protocol: "MCP",
    methods: ["server/discover", "initialize", "notifications/initialized", "tools/list", "tools/call"],
    protocolVersions: ["2026-07-28", "2025-11-25"],
    authentication: { required: false, oauth: false, payment: "x402-v2-per-paid-tool" },
    tools: mcpToolsForEnv(env),
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
      role: "guarded_request_chokepoint",
      method: "POST",
      url: mainnet.resource,
      testnet_url: testnet.resource,
      preflight_url: `${API}/v1/preflight`,
      quote_url: `${API}/v1/pricing/quote`,
      quote_optional: true,
      first_call_creates_quote: true,
      quote_request: quoteRequestGuidance(),
      scheme: "exact",
      mainnet: { environment: mainnet.environment, rail: mainnet.rail.id, network: mainnet.network, asset: mainnet.asset, amount: mainnet.amount, pay_to: mainnet.payTo, configured: mainnet.configured },
      testnet: { environment: testnet.environment, rail: testnet.rail.id, revenue: false, network: testnet.network, asset: testnet.asset, amount: testnet.amount, pay_to: testnet.payTo, configured: testnet.configured },
      payment_identifier_required: true,
      signed_offer: true,
      signed_receipt: true,
      settlement_before_execution: true,
      replay_safe: true,
      post_settlement_failure_policy: "signed_reusable_execution_credit",
      agent_flow: [
        "POST {url: 'https://example.com/'} directly to the resource URL",
        "On HTTP 402, preserve X-XGuard-Quote, decode Payment-Required and sign an official x402 v2 payment payload",
        "Retry the identical execution request with Payment-Signature and X-XGuard-Quote",
        "On HTTP 200, verify Payment-Response, the signed receipt, and ProofRail evidence",
      ],
    }],
    facilitator: {
      configurable: true,
      selected_mainnet: mainnet.facilitator,
      selected_testnet: testnet.facilitator,
      discovery: `${API}/.well-known/x402-facilitator.json`,
    },
    payment_readiness: `${API}/v1/payment/readiness`,
    revenue_integrity: { testnet_is_revenue: false, synthetic_is_revenue: false, real_revenue_requires: ["production environment", "external traffic", "successful settlement"] },
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
      { environment: mainnet.environment, rail: mainnet.rail.id, network: mainnet.network, scheme: "exact", url: mainnet.facilitator, configured: mainnet.configured },
      { environment: testnet.environment, rail: testnet.rail.id, network: testnet.network, scheme: "exact", url: testnet.facilitator, configured: testnet.configured },
    ],
    settlement_policy: "Execute only after the configured facilitator returns a valid successful settlement response. Timeout or 5xx is ambiguous and enters reconciliation without upstream execution.",
  };
}

async function readiness(env) {
  const checks = { proof_authority: false, paid_state: false, mainnet_config: false, facilitator: false, testnet_config: false, testnet_facilitator: false };
  const config = gatewayConfig(env, false);
  const testConfig = gatewayConfig(env, true);
  checks.mainnet_config = config.configured;
  checks.testnet_config = testConfig.configured;
  try { checks.proof_authority = (await proofStub(env).fetch("https://proofrail/public")).ok; } catch {}
  try { checks.paid_state = (await gatewayIndex(env).fetch("https://paid-gateway/ping")).ok; } catch {}
  const facilitatorSupports = async selected => {
    if (!selected.configured || !env || Object.keys(env).length === 0) return false;
    try {
      const response = await fetch(`${selected.facilitator}/supported`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      return response.ok && Array.isArray(body?.kinds) && body.kinds.some(kind => kind?.x402Version === 2 && kind?.scheme === "exact" && kind?.network === selected.network);
    } catch { return false; }
  };
  checks.facilitator = await facilitatorSupports(config);
  checks.testnet_facilitator = await facilitatorSupports(testConfig);
  const productionReady = checks.mainnet_config && checks.facilitator && config.environment === PAYMENT_ENVIRONMENTS.PRODUCTION;
  const testReady = checks.testnet_config && checks.testnet_facilitator && testConfig.environment === PAYMENT_ENVIRONMENTS.TEST;
  let realRevenueObserved = false;
  try {
    const metrics = await postStub(gatewayIndex(env), "/index/metrics", {});
    realRevenueObserved = Number(metrics.body?.real_revenue_usd_micros || 0) > 0;
  } catch {}
  return {
    ready: Boolean(checks.proof_authority && checks.paid_state && productionReady),
    production_payment_ready: productionReady,
    test_payment_ready: testReady,
    production: { environment: config.environment, rail: config.rail.id, network: config.network, asset: config.asset, recipient_configured: config.rail.config.recipient_configured, facilitator_configured: config.rail.config.facilitator_configured, facilitator_supports_exact: checks.facilitator },
    test: { environment: testConfig.environment, rail: testConfig.rail.id, revenue: false, network: testConfig.network, asset: testConfig.asset, recipient_configured: testConfig.rail.config.recipient_configured, facilitator_configured: testConfig.rail.config.facilitator_configured, facilitator_supports_exact: checks.testnet_facilitator },
    real_revenue_observed: realRevenueObserved,
    checks,
    checked_at: new Date().toISOString(),
  };
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
    environment: record.environment || null,
    traffic_class: record.traffic_class || null,
    payment_rail: record.payment_rail || null,
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
  const quoteContent = {
    "application/json": {
      schema: quoteRequestSchema(),
      examples: Object.fromEntries(QUOTE_ACCEPTED_SHAPES.map(shape => [shape.name, { value: shape.example }])),
    },
  };
  const paidFlow = {
    price: { amount_atomic: DEFAULT_PRICE_ATOMIC, currency: "USDC", decimals: 6 },
    steps: [
      `POST ${API}/v1/tools/web.fetch with {url: \"https://example.com/\"}`,
      "Read Payment-Required and X-XGuard-Quote from HTTP 402",
      "Sign Payment-Required with an official x402 v2 payer",
      "Retry the identical request with Payment-Signature and X-XGuard-Quote",
      "Verify Payment-Response, signed receipt, and ProofRail evidence on HTTP 200",
    ],
    standalone_quote_optional: `${API}/v1/pricing/quote`,
    settlement_before_execution: true,
    payment_required: true,
  };
  return {
    "/v1/capabilities": { get: { summary: "Discover actual XGuard tool availability", responses: { "200": { description: "Machine-readable capabilities", content: standard } } } },
    "/v1/pricing": { get: { summary: "Inspect prices before execution", responses: { "200": { description: "Published pricing", content: standard } } } },
    "/v1/preflight": {
      get: { summary: "Describe the free guarded-request preflight", responses: { "200": { description: "Preflight schema and exact next steps", content: standard } } },
      post: {
        summary: "Preflight a guarded paid request without contacting the target",
        description: "Free and read-only. Validates the normalized public HTTPS target, SSRF policy, trusted public DNS and payment readiness. On allow, call /v1/tools/web.fetch directly for an automatically quoted mandatory x402 v2 flow.",
        requestBody: { required: true, content: { "application/json": { schema: quoteRequestSchema(), examples: Object.fromEntries(QUOTE_ACCEPTED_SHAPES.map(shape => [shape.name, { value: shape.example }])) } } },
        responses: {
          "200": { description: "Target is safe to quote; no upstream request was made", content: standard },
          "400": { description: "Machine-readable input error with retry guidance", content: standard },
          "403": { description: "Target is blocked by public HTTPS or SSRF policy", content: standard },
          "422": { description: "Hostname has no public DNS address", content: standard },
          "503": { description: "Trusted DNS or payment path temporarily unavailable", content: standard },
        },
      },
    },
    "/v1/pricing/quote": { post: {
      summary: "Create a signed quote bound to xguard.web.fetch inputs",
      description: "Free. Canonical request is {url, method?, timeout_ms?, max_bytes?, mode?, testnet?}. Common AI-agent envelopes and camelCase aliases are accepted. The response contains the exact automated next step.",
      requestBody: { required: true, content: quoteContent },
      responses: {
        "200": { description: "Signed five-minute quote plus normalized input and exact next-step instructions", content: standard },
        "400": { description: "Machine-readable validation error with accepted fields, values, shapes, and retry example", content: standard },
        "403": { description: "Private, local, metadata, credential-bearing, or XGuard-owned target rejected", content: standard },
        "422": { description: "Hostname definitively has no public DNS address", content: standard },
        "503": { description: "Trusted DNS validation or payment configuration temporarily unavailable; retryable", content: standard },
      },
      "x-xguard-payment-flow": paidFlow,
    } },
    "/v1/tools/web.fetch": { post: {
      summary: "Fetch a public HTTPS resource only after required x402 settlement",
      description: "Payment is mandatory. Call directly with a public HTTPS URL: if no quote is supplied, XGuard creates an input-bound signed quote and returns it inside HTTP 402 and X-XGuard-Quote. Retry only after creating Payment-Signature from Payment-Required. Advanced clients may obtain the same quote first from /v1/pricing/quote. XGuard verifies and settles before any upstream request.",
      parameters: [{ name: "X-XGuard-Quote", in: "header", required: false, description: "Omit on the first call; XGuard returns an input-bound quote in this response header. Send it on the paid retry.", schema: { type: "string" } }, { name: "Payment-Signature", in: "header", required: false, description: "Omit on the first call to receive HTTP 402; required on the settled retry.", schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: fetchInputSchema({ quoteOptional: true }), example: { url: "https://example.com/", method: "GET" } } } },
      responses: { "200": { description: "Settled result, Payment-Response, signed receipt, and ProofRail evidence", content: standard }, "402": { description: "Required x402 v2 Payment-Required challenge, automatically issued input-bound quote, and signed offer", content: standard }, "409": { description: "Replay or idempotency conflict" }, "503": { description: "Ambiguous settlement; no upstream execution" } },
      "x-xguard-payment-flow": paidFlow,
    } },
    "/v1/tools/web.fetch/testnet": { post: { summary: "Base Sepolia testnet form of xguard.web.fetch", description: "Same mandatory one-call x402 v2 flow as mainnet, using Base Sepolia USDC. A first request without a quote automatically returns a signed testnet quote and Payment-Required challenge; test settlement never counts as revenue.", requestBody: { required: true, content: { "application/json": { schema: fetchInputSchema({ quoteOptional: true }) } } }, responses: { "200": { description: "Settled testnet result, signed receipt, and ProofRail evidence" }, "402": { description: "Required Base Sepolia x402 challenge with automatically created signed quote" } }, "x-xguard-payment-flow": { ...paidFlow, network: TESTNET } } },
    "/v1/operations/{payment_identifier}": { get: { summary: "Read a payment/execution state", parameters: [{ name: "payment_identifier", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Explicit financial state", content: standard }, "404": { description: "Unknown identifier" } } } },
    "/v1/health": { get: { summary: "Liveness probe", responses: { "200": { description: "Worker is live" } } } },
    "/v1/ready": { get: { summary: "Dependency readiness probe", responses: { "200": { description: "Ready" }, "503": { description: "Dependency unavailable" } } } },
    "/v1/payment/readiness": { get: { summary: "Inspect production and test payment readiness without exposing secrets", responses: { "200": { description: "Machine-readable rail configuration and facilitator reachability", content: standard } } } },
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
  body.x_xguard = { product: "XGUARD = UNIVERSAL PAID AI AGENT + SECRETLESS GATEWAY", when_to_use: "Use XGuard when an agent needs a paid bounded tool or credential-backed API access without receiving a reusable upstream secret.", actual_capabilities: `${API}/v1/capabilities`, pricing: `${API}/v1/pricing`, quote_request: quoteRequestGuidance(), payment_manifest: `${API}/.well-known/payment-manifest`, payment_readiness: `${API}/v1/payment/readiness`, paid_operations_require_x402: true, testnet_is_revenue: false };
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return new Response(JSON.stringify(body), { status: response.status, headers: next });
}

async function improveLlms(response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const current = await response.clone().text();
  const addition = `\n## Universal paid tool path\n\nUse XGuard when an agent needs a bounded paid tool or credential-backed API access without putting a reusable upstream API key in agent context. The production paid tool is xguard.web.fetch at 0.001 USDC per request; search, inference, routing and data connectors remain disabled until real connectors are configured.\n\n- Capabilities: ${API}/v1/capabilities\n- Pricing: ${API}/v1/pricing\n- Optional signed quote: POST ${API}/v1/pricing/quote\n- Paid execution: POST ${API}/v1/tools/web.fetch\n- Testnet execution: POST ${API}/v1/tools/web.fetch/testnet\n- Payment manifest: ${API}/.well-known/payment-manifest\n- Health: ${API}/v1/health\n- Readiness: ${API}/v1/ready\n\nFastest path: POST {"url":"https://example.com/"} directly to the paid execution URL. XGuard validates the target and returns HTTP 402 with Payment-Required, X-XGuard-Quote, and an input-bound signed offer; no upstream request occurs. Create and sign an official x402 v2 payment, then retry the identical input with Payment-Signature and X-XGuard-Quote. XGuard verifies and settles before controlled execution. HTTP 200 returns Payment-Response, a signed receipt and ProofRail evidence. Payment-Identifier is mandatory; an exact retry returns the stored outcome without a second settlement.\n`;
  const next = new Headers(response.headers);
  next.delete("content-length");
  next.set("x-xguard-version", VERSION);
  return new Response(current.includes("## Universal paid tool path") ? current : current + addition, { status: response.status, headers: next });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = requestId(request);
    const observation = { trafficClass: trafficClass(request), transport: "http" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
    if (request.method === "GET" && url.pathname === "/mcp") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "mcp" });
      return json(mcpDiscovery(env), 200, { allow: "GET, HEAD, POST, OPTIONS", "cache-control": "public, max-age=60" });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/xguard-tools.json") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "xguard_tools" });
      return json(toolsManifest(env), 200, { "cache-control": "public, max-age=120", "x-xguard-request-id": id });
    }
    if (request.method === "HEAD" && url.pathname === "/mcp") return new Response(null, { status: 200, headers: headers({ allow: "GET, HEAD, POST, OPTIONS" }) });
    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "capabilities" });
      return json(capabilities(env), 200, { "cache-control": "public, max-age=60", "x-xguard-request-id": id });
    }
    if (request.method === "GET" && url.pathname === "/v1/pricing") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "pricing" });
      return json(pricing(env), 200, { "cache-control": "public, max-age=60", "x-xguard-request-id": id });
    }
    if (request.method === "GET" && url.pathname === "/v1/preflight") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "preflight" });
      return json(preflightSchema(), 200, { "cache-control": "public, max-age=60", "x-xguard-request-id": id });
    }
    if (request.method === "POST" && url.pathname === "/v1/preflight") {
      const parsed = await jsonBody(request.clone());
      if (parsed.error) return error(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, id, { details: { retry: preflightRequestGuidance() } });
      return handlePreflight(env, parsed.value, id, observation);
    }
    if (request.method === "GET" && url.pathname === "/v1/health") return json({ status: "ok", live: true, version: VERSION, request_id: id, checked_at: new Date().toISOString() }, 200, { "x-xguard-request-id": id });
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/v1/payment/readiness") {
      const state = await readiness(env);
      const response = json({ status: state.production_payment_ready ? "payment_ready" : "payment_not_ready", version: VERSION, request_id: id, ...state }, 200, { "x-xguard-request-id": id, "cache-control": "no-store" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (request.method === "GET" && url.pathname === "/v1/ready") {
      const state = await readiness(env);
      return json({ status: state.ready ? "ready" : "not_ready", version: VERSION, request_id: id, ...state }, state.ready ? 200 : 503, { "x-xguard-request-id": id });
    }
    if (request.method === "GET" && url.pathname === "/v1/metrics") {
      if (!env.PAID_GATEWAY) return error("payment_not_configured", 503, id);
      const metrics = await postStub(gatewayIndex(env), "/index/metrics", {});
      return json({ version: VERSION, request_id: id, health_checks_excluded: true, ...metrics.body }, metrics.ok ? 200 : 503, { "x-xguard-request-id": id });
    }
    if (request.method === "GET" && ["/.well-known/payment-manifest", "/.well-known/payment-manifest.json"].includes(url.pathname)) {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "payment_manifest" });
      return json(paymentManifest(env), 200, { "cache-control": "public, max-age=120" });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/x402-facilitator.json") {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: "facilitator_manifest" });
      return json(facilitatorManifest(env), 200, { "cache-control": "public, max-age=120" });
    }
    if (request.method === "POST" && url.pathname === "/v1/pricing/quote") {
      await observeStage(env, "quote_attempt", id, { traffic_class: observation.trafficClass, transport: "http", tool: TOOL });
      const parsed = await jsonBody(request);
      if (parsed.error) return error(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, id, { details: { retry: quoteRequestGuidance() } });
      return (await issueQuote(env, parsed.value, id, observation)).response;
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
      return augmentMcpTools(paid?.message, response, env);
    }
    let response = await app.fetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/openapi.json") response = await improveOpenApi(response);
    if (request.method === "GET" && url.pathname === "/llms.txt") response = await improveLlms(response);
    if (request.method === "GET" && DISCOVERY_PATHS.has(url.pathname)) {
      await observeStage(env, "discovery", id, { traffic_class: observation.trafficClass, transport: "http", surface: url.pathname.replaceAll("/", "_") || "root" });
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
