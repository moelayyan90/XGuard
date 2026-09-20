import { readPublicJson } from "./core/public-contract.js";
import { digestBytes } from "./core/execution-contract.js";
import { AGENT_USAGE_PATH, AGENT_USAGE_VERSION, MAX_USAGE_BYTES, UsageError,
  normalizeAgentUsagePayload, requestedUsageTenant, resolveUsageTenant, usageEventKeys } from "./core/agent-usage.js";

const ORIGINS = new Set(["https://xguardgate.com", "https://api.xguardgate.com"]);
const ALLOWED_HEADERS = ["authorization", "x-xguard-key", "content-type", "idempotency-key", "x-request-id"];

function operatorKey(request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer ([^\s,]{20,200})$/i)?.[1];
  const alternate = request.headers.get("x-xguard-key");
  if ((!bearer && authorization !== null) || (alternate !== null && !/^[^\s,]{20,200}$/.test(alternate)) || (bearer && alternate && bearer !== alternate)) {
    throw new UsageError("invalid_operator_key", 401, "Supply one valid operator key using Bearer authorization or X-XGuard-Key.");
  }
  if (!bearer && !alternate) throw new UsageError("tenant_identity_required", 401, "A trusted tenant identity is required before usage can be recorded.");
  return bearer || alternate;
}

async function authenticateUsageOperator(env, key) {
  let url;
  try { url = new URL("/v1/balance", env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com"); } catch {}
  if (!url || url.protocol !== "https:" || url.username || url.password) throw new UsageError("usage_identity_unavailable", 503, "The identity service is unavailable.", true);
  let response, data;
  try {
    // Workers supports manual/follow, not redirect:error. Never forward the key
    // to a redirected origin; non-2xx replies below fail authentication closed.
    response = await fetch(url.href, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${key}`, accept: "application/json" } });
    // Never treat arbitrary HTTP 200 pages or an incomplete reply as authentication.
    const parsed = await readPublicJson(response, MAX_USAGE_BYTES);
    data = parsed.value;
  } catch { throw new UsageError("usage_identity_unavailable", 503, "The identity service is unavailable.", true); }
  if ([401, 404].includes(response.status)) throw new UsageError("invalid_operator_key", 401, "The operator key is not provisioned.");
  if (response.status === 403 || data?.restricted === true) throw new UsageError("operator_restricted", 403, "This operator account is restricted.");
  if (!response.ok || !data || !Number.isSafeInteger(data.credits) || data.credits < 0) throw new UsageError("usage_identity_unavailable", 503, "The identity service could not verify this operator key.", true);
  return digestBytes(key);
}

function meter(env, name) {
  if (!env.EGRESS_METER) throw new UsageError("usage_store_unavailable", 503, "Durable usage storage is unavailable.", true);
  return env.EGRESS_METER.get(env.EGRESS_METER.idFromName(name));
}
async function admit(stub) {
  const response = await stub.fetch("https://meter/agent-usage/admit", { method: "POST" });
  const value = await response.json();
  if (response.status === 429) {
    const error = new UsageError("usage_rate_limited", 429, "Too many usage requests. Retry with the same event identifier after Retry-After.", true);
    error.retryAfter = value.retry_after_seconds || 60;
    throw error;
  }
  if (!response.ok || value.allowed !== true) throw new UsageError("usage_store_unavailable", 503, "Durable usage admission is unavailable.", true);
}

export async function handleAgentUsageRoute(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== AGENT_USAGE_PATH) return null;
  const requestId = `xgr_${crypto.randomUUID().replaceAll("-", "")}`;
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "vary": "Origin",
    "x-content-type-options": "nosniff", "x-xguard-agent-usage-version": AGENT_USAGE_VERSION, "x-xguard-request-id": requestId };
  const origin = request.headers.get("origin");
  if (ORIGINS.has(origin)) Object.assign(headers, { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": ALLOWED_HEADERS.join(", "), "access-control-expose-headers": "x-xguard-request-id, retry-after", "access-control-max-age": "600" });
  const reply = (body, status = 200) => new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers });
  let tenantHash;
  const log = (event, fields = {}) => console.info(JSON.stringify({ event, request_id: requestId, source_surface: "agent_token_usage_http", ...(tenantHash ? { tenant_hash: tenantHash } : {}), ...fields }));
  try {
    if (origin !== null && !ORIGINS.has(origin)) throw new UsageError("origin_not_allowed", 403, "This origin is not allowed for usage ingestion.");
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const requested = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
      if ((method && method !== "POST") || requested.some(name => !ALLOWED_HEADERS.includes(name))) throw new UsageError("cors_request_not_allowed", 403, "The requested CORS method or headers are not allowed.");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") { headers.allow = "POST, OPTIONS"; throw new UsageError("method_not_allowed", 405, "Use POST to record a usage event."); }
    log("agent_token_usage_received");
    const key = operatorKey(request);
    // Cloudflare supplies CF-Connecting-IP. Unknown sources share a bounded bucket;
    // client request IDs and claimed tenants cannot create new admission buckets.
    const ipHash = await digestBytes(request.headers.get("cf-connecting-ip") || "unknown");
    await admit(meter(env, `agent-usage-ingress:${ipHash}`));
    const parsed = await readPublicJson(request, MAX_USAGE_BYTES);
    if (parsed.error) throw new UsageError(parsed.error, parsed.error === "payload_too_large" ? 413 : 400, "Supply one complete UTF-8 JSON usage object of at most 16384 bytes.");
    const record = normalizeAgentUsagePayload(parsed.value);
    const requestedTenant = requestedUsageTenant(url, parsed.value);
    const keys = await usageEventKeys(request, parsed.value);
    const keyHash = await authenticateUsageOperator(env, key);
    const tenant = resolveUsageTenant(requestedTenant, keyHash, env.XGUARD_USAGE_TENANT_BINDINGS);
    tenantHash = await digestBytes(tenant);
    const stub = meter(env, `agent-usage-tenant:${tenantHash}`);
    await admit(stub);
    const response = await stub.fetch("https://meter/agent-usage/record", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...record, tenant, keys, request_id: requestId }) });
    const result = await response.json();
    if (!response.ok) throw new UsageError(result.error?.code || "usage_store_unavailable", response.status === 409 ? 409 : response.status === 403 ? 403 : 503,
      result.error?.message || "The usage event could not be committed.", response.status >= 500);
    if (!result.accepted || !result.request_id) throw new UsageError("usage_store_unavailable", 503, "The usage event could not be confirmed.", true);
    headers["x-xguard-request-id"] = result.request_id;
    log(result.duplicate ? "agent_token_usage_duplicate" : "agent_token_usage_recorded", { ...result.usage, event_request_id: result.request_id });
    return reply(result);
  } catch (cause) {
    const error = cause instanceof UsageError ? cause : new UsageError("usage_store_unavailable", 503, "Usage ingestion is temporarily unavailable. Retry with the same event identifier.", true);
    if (error.status === 401) headers["www-authenticate"] = 'Bearer realm="XGuard usage"';
    if (error.retryAfter) headers["retry-after"] = String(error.retryAfter);
    log("agent_token_usage_rejected", { code: error.code, status: error.status });
    return reply({ ok: false, accepted: false, request_id: requestId, error: { code: error.code, message: error.message, retryable: error.retryable } }, error.status);
  }
}
