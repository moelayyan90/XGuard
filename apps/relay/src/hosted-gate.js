const API = "https://api.xguardgate.com";
const VERSION = "5.0.1";
const BASE_CAIP = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_PAYMENT_HEADER_BYTES = 48 * 1024;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-hosted-gate": VERSION,
    ...headers,
  },
});

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(value) {
  const normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function header(request, name, max = 4096) {
  const value = String(request.headers.get(name) || "").trim();
  return value.length <= max ? value : "";
}

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}

function sameHex(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function isPositiveAtomic(value) {
  if (!/^[0-9]+$/.test(String(value || ""))) return false;
  try { return BigInt(value) > 0n; } catch { return false; }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function paymentRequirementFromRequest(request) {
  const network = header(request, "x-xguard-network", 128) || BASE_CAIP;
  const asset = header(request, "x-xguard-asset", 128) || (network === BASE_CAIP ? BASE_USDC : "");
  const payTo = header(request, "x-xguard-pay-to", 128);
  const amount = header(request, "x-xguard-amount", 128);
  const resourceUrl = safeHttpsUrl(header(request, "x-xguard-resource-url", 4096));
  const description = header(request, "x-xguard-description", 512) || "Paid access through XGuard Hosted Gate";
  const mimeType = header(request, "x-xguard-mime-type", 128) || "application/json";
  const timeoutRaw = header(request, "x-xguard-timeout-seconds", 32) || "60";
  const timeout = Number.parseInt(timeoutRaw, 10);

  if (network !== BASE_CAIP) throw new Error("hosted_gate_network_not_supported");
  if (!sameHex(asset, BASE_USDC)) throw new Error("hosted_gate_asset_not_supported");
  if (!isAddress(payTo) || /^0x0{40}$/i.test(payTo)) throw new Error("invalid_pay_to");
  if (!isPositiveAtomic(amount)) throw new Error("invalid_amount");
  if (!resourceUrl) throw new Error("invalid_resource_url");
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 300) throw new Error("invalid_timeout");

  return {
    resource: {
      url: resourceUrl.toString(),
      description,
      mimeType,
      serviceName: "XGuard Hosted Gate",
      tags: ["x402", "xguard", "payment-gate"],
      iconUrl: "https://xguardgate.com/logo.png",
    },
    requirements: {
      scheme: "exact",
      network: BASE_CAIP,
      amount,
      asset: BASE_USDC,
      payTo,
      maxTimeoutSeconds: timeout,
      extra: { name: "USD Coin", version: "2" },
    },
  };
}

export function decodePaymentSignature(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > MAX_PAYMENT_HEADER_BYTES) return null;
  try {
    const payload = JSON.parse(base64ToUtf8(raw));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function acceptedMatches(payload, resource, requirements) {
  if (!payload || payload.x402Version !== 2 || !payload.accepted || !payload.payload) return false;
  const accepted = payload.accepted;
  if (accepted.scheme !== requirements.scheme) return false;
  if (accepted.network !== requirements.network) return false;
  if (String(accepted.amount || "") !== requirements.amount) return false;
  if (!sameHex(accepted.asset, requirements.asset)) return false;
  if (!sameHex(accepted.payTo, requirements.payTo)) return false;
  if (payload.resource?.url && payload.resource.url !== resource.url) return false;
  return true;
}

function paymentRequired(resource, requirements, error = "PAYMENT-SIGNATURE header is required") {
  const body = { x402Version: 2, error, resource, accepts: [requirements], extensions: {} };
  return json(body, 402, { "payment-required": utf8ToBase64(JSON.stringify(body)) });
}

function internalHeaders(request) {
  const headers = new Headers({ "content-type": "application/json" });
  const key = header(request, "x-xguard-key", 4096);
  if (key) {
    headers.set("x-xguard-key", key);
    headers.set("authorization", `Bearer ${key}`);
  }
  return headers;
}

async function callFacilitator(worker, path, body, request, env, ctx) {
  return worker.fetch(new Request(`${API}${path}`, {
    method: "POST",
    headers: internalHeaders(request),
    body: JSON.stringify(body),
  }), env, ctx);
}

export async function hostedGateResponse(request, env, ctx, worker) {
  const url = new URL(request.url);

  if (url.pathname === "/v1/gate" && request.method === "GET") {
    return json({
      name: "XGuard Hosted Gate",
      version: VERSION,
      protocol: "x402-v2-http",
      endpoint: `${API}/v1/gate/authorize`,
      facilitator: API,
      supported: [{ scheme: "exact", network: BASE_CAIP, asset: BASE_USDC }],
      request_headers: {
        resource: "X-XGuard-Resource-URL",
        pay_to: "X-XGuard-Pay-To",
        amount_atomic: "X-XGuard-Amount",
        payment_signature: "PAYMENT-SIGNATURE",
        usage_credits_key: "X-XGuard-Key (optional during free allowance)",
      },
      success: "2xx allows the reverse proxy to reach its origin; PAYMENT-RESPONSE is returned after settlement",
      failure: "402 challenges/denials and 5xx ambiguous settlement failures stay fail-closed",
    });
  }

  if (url.pathname !== "/v1/gate/authorize") return null;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });

  let configured;
  try {
    configured = paymentRequirementFromRequest(request);
  } catch (error) {
    return json({ error: String(error?.message || "invalid_gate_configuration") }, 400);
  }

  const signature = request.headers.get("payment-signature");
  if (!signature) return paymentRequired(configured.resource, configured.requirements);

  const paymentPayload = decodePaymentSignature(signature);
  if (!paymentPayload) return paymentRequired(configured.resource, configured.requirements, "Invalid PAYMENT-SIGNATURE header");
  if (!acceptedMatches(paymentPayload, configured.resource, configured.requirements)) {
    return paymentRequired(configured.resource, configured.requirements, "Payment payload does not match this gateway policy");
  }

  const facilitatorBody = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: configured.requirements,
  };

  const verifyResponse = await callFacilitator(worker, "/verify", facilitatorBody, request, env, ctx);
  const verifyData = await verifyResponse.clone().json().catch(() => null);
  if (!verifyResponse.ok || verifyData?.isValid !== true) {
    const reason = verifyData?.invalidReason || "Payment verification failed";
    return paymentRequired(configured.resource, configured.requirements, reason);
  }

  const settleResponse = await callFacilitator(worker, "/settle", facilitatorBody, request, env, ctx);
  const settleData = await settleResponse.clone().json().catch(() => null);
  if (!settleResponse.ok || settleData?.success !== true) {
    if (settleResponse.status >= 500) {
      return json({ error: "settlement_ambiguous_or_unavailable", detail: settleData || undefined }, 503, {
        "retry-after": settleResponse.headers.get("retry-after") || "5",
        "x-xguard-settlement-safety": settleResponse.headers.get("x-xguard-settlement-safety") || "fail-closed",
      });
    }
    return paymentRequired(configured.resource, configured.requirements, settleData?.errorReason || "Payment settlement failed");
  }

  const headers = {
    "payment-response": utf8ToBase64(JSON.stringify(settleData)),
    "x-xguard-gate-authorized": "1",
  };
  const receiptId = settleResponse.headers.get("x-xguard-receipt-id");
  if (receiptId) headers["x-xguard-receipt-id"] = receiptId;
  const upstream = settleResponse.headers.get("x-xguard-upstream");
  if (upstream) headers["x-xguard-upstream"] = upstream;

  return new Response(null, { status: 204, headers });
}
