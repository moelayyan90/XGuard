import { digestBytes, executionKey, requestDigest, readBoundedBody, responseHeaders as safeResponseHeaders, credentialVariants, MAX_RESULT_BYTES, MAX_STORED_RESULT_BYTES } from "./core/execution-contract.js";
import { publicDns } from "./core/network-policy.js";
import { admitUsage, recordUsage, UsageError } from "./core/agent-usage.js";
import { compileOperation, validateOperationPolicy, operationPolicyAllows, normalizedProviderResult } from "./core/provider-operations.js";
import { recordTelemetry, telemetrySnapshot } from "./core/execution-telemetry.js";
import { validateGovernancePolicy, evaluateForecast, XGuardAuthorizationGateway, reserveDailyExposure, GOVERNANCE_DISCOVERY } from "./core/governance.js";

const VERSION = "1.0.0";
const API = "https://api.xguardgate.com";
const DEFAULT_CREDITS = 1;
const MAX_SECRET_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const BILLING_TIMEOUT_MS = 10_000;
const EGRESS_TIMEOUT_MS = 30_000;
const DEMO_TARGET = "https://demo.xguardgate.com/v1/fixture";
const demoTarget = value => value === DEMO_TARGET ? new URL(DEMO_TARGET) : null;
const enc = new TextEncoder();
const dec = new TextDecoder();

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-egress": VERSION,
    ...headers,
  },
});

const low = value => String(value ?? "").toLowerCase();
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

const PROVIDERS = Object.freeze({
  openai: { header: "authorization", prefix: "Bearer ", hosts: ["api.openai.com"] },
  anthropic: { header: "x-api-key", prefix: "", hosts: ["api.anthropic.com"] },
  github: { header: "authorization", prefix: "Bearer ", hosts: ["api.github.com"] },
  stripe: { header: "authorization", prefix: "Bearer ", hosts: ["api.stripe.com"] },
  slack: { header: "authorization", prefix: "Bearer ", hosts: ["slack.com"] },
  notion: { header: "authorization", prefix: "Bearer ", hosts: ["api.notion.com"] },
  cloudflare: { header: "authorization", prefix: "Bearer ", hosts: ["api.cloudflare.com"] },
  gemini: { header: "x-goog-api-key", prefix: "", hosts: ["generativelanguage.googleapis.com"] },
});

function b64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
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
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseHash(value) {
  const normalized = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function equalHash(left, right) {
  const a = parseHash(left);
  const b = parseHash(right);
  if (!a || !b) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function randomHex() {
  return crypto.randomUUID().replaceAll("-", "");
}

function privateHost(hostname) {
  const host = low(hostname).replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || host.startsWith("::ffff:")) return true;
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    if ((first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf) || (first >= 0xff00 && first <= 0xffff)) return true;
    return false;
  }
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

function safeTarget(value) {
  const raw = String(value || "").trim();
  if (/\\|%(?:2e|2f|5c|25)/i.test(raw)) return null;
  const authorityEnd = raw.indexOf("/", raw.indexOf("://") + 3);
  const rawPath = authorityEnd < 0 ? "/" : raw.slice(authorityEnd).split(/[?#]/, 1)[0];
  if (rawPath.includes("//") || /\/(?:\.{1,2})(?:\/|$)/.test(rawPath)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || privateHost(url.hostname)) return null;
  if (url.hostname === "xguardgate.com" || url.hostname.endsWith(".xguardgate.com")) return null;
  return url;
}

function billingUrl(env) {
  return String(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com").replace(/\/$/, "");
}

function egressCredits(env) {
  const units = Number(env.EGRESS_EXECUTION_CREDITS ?? DEFAULT_CREDITS);
  return Number.isSafeInteger(units) && units > 0 && units <= 1000000 ? units : null;
}

async function billingBalance(env, key) {
  if (!key) return { ok: false, status: 401, credits: 0 };
  try {
    const response = await fetch(`${billingUrl(env)}/v1/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(BILLING_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && !data?.restricted, status: data?.restricted ? 403 : response.status, credits: Number(data?.credits ?? data?.balance ?? 0) };
  } catch {
    return { ok: false, status: 503, credits: 0 };
  }
}

async function consumeCredits(env, key, units, idempotencyKey) {
  try {
    const response = await fetch(`${billingUrl(env)}/v1/consume`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ units }),
      redirect: "manual",
      signal: AbortSignal.timeout(BILLING_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 503 };
  }
}

function keyOf(request) {
  return String(request.headers.get("x-xguard-key") || "").trim();
}

function cleanHeaderName(value) {
  const name = low(value).trim();
  if (!/^[a-z0-9-]{1,64}$/.test(name)) return null;
  if (["host", "content-length", "connection", "proxy-authorization", "cookie"].includes(name)) return null;
  if (name.startsWith("cf-") || name.startsWith("x-xguard-")) return null;
  return name;
}

function normalizeHosts(values) {
  const hosts = [...new Set((Array.isArray(values) ? values : []).map(value => low(value).trim()).filter(Boolean))];
  if (!hosts.length || hosts.length > 16) return null;
  if (hosts.some(host => host.includes("/") || host.includes(":") || privateHost(host) || host === "xguardgate.com" || host.endsWith(".xguardgate.com"))) return null;
  return hosts;
}

function normalizePolicyPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.length > 256 || path.includes("//") || /[?#\\]|%(?:2e|2f|5c|25)/i.test(path)) return null;
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  try {
    const parsed = new URL(normalized, "https://policy.invalid");
    return parsed.pathname === normalized ? normalized : null;
  } catch { return null; }
}

function normalizePaths(values) {
  const source = Array.isArray(values) && values.length ? values : ["/"];
  const normalized = source.map(normalizePolicyPath);
  if (normalized.some(path => !path)) return null;
  const paths = [...new Set(normalized)];
  return paths.length && paths.length <= 32 ? paths : null;
}

function pathMatches(prefix, pathname) {
  const scope = String(prefix || "/").length > 1 ? String(prefix).replace(/\/+$/, "") : "/";
  return scope === "/" || pathname === scope || pathname.startsWith(`${scope}/`);
}

function normalizeMethods(values) {
  const source = Array.isArray(values) && values.length ? values : ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const out = [...new Set(source.map(value => String(value || "").toUpperCase()).filter(value => methods.has(value)))];
  return out.length ? out : null;
}

function providerPolicy(provider, body) {
  const preset = PROVIDERS[provider];
  if (preset) {
    return {
      provider,
      injection: { header: preset.header, prefix: preset.prefix },
      allowed_hosts: preset.hosts,
      allowed_paths: normalizePaths(body?.allowed_paths),
      allowed_methods: normalizeMethods(body?.allowed_methods),
    };
  }
  if (provider !== "custom") return null;
  const header = cleanHeaderName(body?.header_name || body?.header || "authorization");
  const prefix = String(body?.header_prefix || "");
  if (!header || prefix.length > 64 || /[\r\n]/.test(prefix)) return null;
  return {
    provider: "custom",
    injection: { header, prefix },
    allowed_hosts: normalizeHosts(body?.allowed_hosts),
    allowed_paths: normalizePaths(body?.allowed_paths),
    allowed_methods: normalizeMethods(body?.allowed_methods),
  };
}

function targetAllowed(record, target, method) {
  if (!record || !target) return false;
  if (!record.allowed_hosts?.includes(low(target.hostname))) return false;
  if (!record.allowed_methods?.includes(String(method || "GET").toUpperCase())) return false;
  if (!record.allowed_paths?.some(prefix => pathMatches(prefix, target.pathname))) return false;
  return true;
}

function sanitizeHeaders(input, injectionHeader) {
  const out = new Headers();
  const blocked = new Set([
    "host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization",
    "proxy-authenticate", "te", "trailer", "keep-alive", "x-forwarded-for", "x-forwarded-host",
    "x-forwarded-proto", "cf-connecting-ip", "cf-ray", "cf-visitor", "x-xguard-key",
    "x-xguard-capability", low(injectionHeader),
  ]);
  for (const [name, value] of Object.entries(input || {})) {
    const key = low(name);
    if (!blocked.has(key) && !key.startsWith("cf-") && !key.startsWith("x-xguard-")) out.set(name, String(value));
  }
  return out;
}

function keyStub(env) {
  return env.EGRESS_KEYS.get(env.EGRESS_KEYS.idFromName("root-v1"));
}
function credentialStub(env, id) {
  return env.EGRESS_CREDENTIALS.get(env.EGRESS_CREDENTIALS.idFromName(String(id)));
}
function capabilityStub(env, id) {
  return env.EGRESS_CAPABILITIES.get(env.EGRESS_CAPABILITIES.idFromName(String(id)));
}
function tenantStub(env, ownerHash) {
  return env.EGRESS_TENANTS.get(env.EGRESS_TENANTS.idFromName(String(ownerHash)));
}
function meterStub(env) {
  return env.EGRESS_METER.get(env.EGRESS_METER.idFromName("meter-v1"));
}
function registryStub(env) { return env.EGRESS_METER.get(env.EGRESS_METER.idFromName("operator-capability-registry-v1")); }

async function encryptSecret(env, plaintext) {
  const response = await keyStub(env).fetch("https://egress-key/encrypt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plaintext }),
  });
  if (!response.ok) throw new Error("egress_encryption_unavailable");
  return response.json();
}

async function encryptResult(env, plaintext) {
  const response = await keyStub(env).fetch("https://egress-key/encrypt-result", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plaintext }),
  });
  if (!response.ok) throw new Error("egress_encryption_unavailable");
  return response.json();
}

async function decryptSecret(env, envelope) {
  const response = await keyStub(env).fetch("https://egress-key/decrypt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope }),
  });
  if (!response.ok) throw new Error("egress_decryption_unavailable");
  return (await response.json()).plaintext;
}

function publicCredential(record) {
  return {
    id: record.id,
    label: record.label,
    provider: record.provider,
    injection_header: record.injection.header,
    allowed_hosts: record.allowed_hosts,
    allowed_paths: record.allowed_paths,
    allowed_methods: record.allowed_methods,
    active: record.active !== false,
    created_at: record.created_at,
  };
}

function discovery(env) {
  return {
    name: "XGuard Secretless Egress",
    version: VERSION,
    role: "credential broker and egress choke point for AI agents",
    governance: GOVERNANCE_DISCOVERY,
    guarantee: "Agents receive scoped XGuard capabilities, never reusable upstream API credentials. XGuard injects the credential only after scope and Usage Credit checks, then forwards one public HTTPS request without following redirects.",
    credentials: `POST ${API}/v1/egress/credentials`,
    list_credentials: `GET ${API}/v1/egress/credentials`,
    capabilities: `POST ${API}/v1/egress/capabilities`,
    revoke_capability: `DELETE ${API}/v1/egress/capabilities/{id}`,
    fetch: `POST ${API}/v1/egress/fetch`,
    providers: `GET ${API}/v1/egress/providers`,
    public_key: `${API}/.well-known/xguard-egress-key.json`,
    credits_per_authorized_egress_attempt: egressCredits(env),
    outcome: "Execute a delegated API action once per capability and idempotency key, with a gateway-credit budget and a signed, retrievable outcome.",
    idempotency: { field: "idempotency_key", header: "Idempotency-Key", required_for: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], scope: "capability + key + exact request digest", replay: "same encrypted stored response; no additional billing or upstream execution", ambiguity: "no automatic retry or takeover after an unknown outcome", retention: "replay while the capability is valid; records deleted 24 hours after expiry" },
    budgets: { fields: ["max_total_credits", "max_credits_per_call"], scope: "XGuard Usage Credits only; upstream vendor charges are billed to the operator separately", uncertain_attempts: "remain reserved until reconciliation" },
    maximum_response_bytes: MAX_RESULT_BYTES,
    providers_supported: Object.keys(PROVIDERS).concat("custom"),
    controls: [
      "secret never returned to the agent",
      "credential encrypted at rest with per-record AES-GCM key wrapped by XGuard RSA-OAEP authority",
      "short-lived scoped capability",
      "exact HTTPS host allowlist",
      "path-prefix allowlist",
      "HTTP method allowlist",
      "billing before credential release and network egress",
      "manual redirect handling prevents credential forwarding to another host",
      "private/local targets blocked",
      "explicit stable Idempotency-Key for authorization and every execution",
      "mandatory signed authorization and positive request-bound forecast net value",
      "durable halt and operator-wide forecast exposure ledger",
      "no automatic retry after network ambiguity",
      "durable request-bound idempotency and encrypted response replay",
      "atomic per-capability gateway-credit reservations",
    ],
    boundary: "Once an operator keeps upstream credentials only in XGuard and gives agents XGuard capabilities instead, secret-backed calls must pass through the egress gateway unless the operator deliberately re-distributes those credentials elsewhere.",
  };
}

async function createCredential(request, env) {
  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required", checkout_url: env.XGUARD_CHECKOUT_URL || null }, 401);
  const balance = await billingBalance(env, key);
  if (!balance.ok) return json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable" }, balance.status === 404 ? 401 : 503);

  let body;
  try { body = JSON.parse(dec.decode(await readBoundedBody(request.body, 32768))); } catch { return json({ error: "invalid_or_oversized_json" }, 400); }
  const provider = low(body?.provider || "custom");
  const policy = providerPolicy(provider, body);
  if (!policy?.allowed_hosts || !policy.allowed_paths || !policy.allowed_methods) return json({ error: "invalid_credential_policy" }, 400);

  const secret = String(body?.value ?? body?.secret ?? "");
  const secretBytes = enc.encode(secret).byteLength;
  if (!secret || secretBytes > MAX_SECRET_BYTES || /[\r\n]/.test(secret)) return json({ error: "invalid_secret", max_bytes: MAX_SECRET_BYTES }, 400);
  const label = String(body?.label || provider).slice(0, 80);
  const ownerHash = await sha256(key);
  const id = `xcred_${randomHex()}`;

  let envelope;
  try { envelope = await encryptSecret(env, secret); } catch { return json({ error: "credential_encryption_unavailable" }, 503); }
  const record = {
    id,
    owner_hash: ownerHash,
    label,
    provider,
    injection: policy.injection,
    allowed_hosts: policy.allowed_hosts,
    allowed_paths: policy.allowed_paths,
    allowed_methods: policy.allowed_methods,
    envelope,
    active: true,
    created_at: new Date().toISOString(),
  };
  const stored = await credentialStub(env, id).fetch("https://credential/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!stored.ok) return json({ error: "credential_store_unavailable" }, 503);
  await tenantStub(env, ownerHash).fetch("https://tenant/add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(publicCredential(record)),
  }).catch(() => null);
  return json({ credential: publicCredential(record), secret_returned: false }, 201);
}

async function listCredentials(request, env) {
  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required" }, 401);
  const ownerHash = await sha256(key);
  const response = await tenantStub(env, ownerHash).fetch("https://tenant/list");
  return json(await response.json().catch(() => ({ credentials: [] })), response.status);
}

async function deleteCredential(request, env, id) {
  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required" }, 401);
  const ownerHash = await sha256(key);
  const response = await credentialStub(env, id).fetch("https://credential/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_hash: ownerHash }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) await tenantStub(env, ownerHash).fetch("https://tenant/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => null);
  return json(data, response.status);
}

async function issueCapability(request, env) {
  const key = keyOf(request);
  if (!key) return json({ error: "xguard_key_required", checkout_url: env.XGUARD_CHECKOUT_URL || null }, 401);
  const balance = await billingBalance(env, key);
  if (!balance.ok) return json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable" }, balance.status === 404 ? 401 : 503);

  let body;
  try { body = JSON.parse(dec.decode(await readBoundedBody(request.body, 32768))); } catch { return json({ error: "invalid_or_oversized_json" }, 400); }
  const credentialId = String(body?.credential_id || "");
  if (!/^xcred_[a-f0-9]{32}$/i.test(credentialId)) return json({ error: "invalid_credential_id" }, 400);
  const ownerHash = await sha256(key);
  const read = await credentialStub(env, credentialId).fetch("https://credential/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_hash: ownerHash, metadata_only: true }),
  });
  if (!read.ok) return json({ error: read.status === 404 ? "credential_not_found" : "credential_access_denied" }, read.status);
  const credential = await read.json();

  let origin;
  try { origin = new URL(String(body?.target_origin || `https://${credential.allowed_hosts?.[0] || ""}`)); } catch { return json({ error: "invalid_target_origin" }, 400); }
  if (origin.protocol !== "https:" || origin.port || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !credential.allowed_hosts.includes(low(origin.hostname))) {
    return json({ error: "target_origin_not_allowed" }, 403);
  }
  const pathPrefix = normalizePolicyPath(body?.path_prefix || credential.allowed_paths?.[0] || "/");
  if (!pathPrefix || !credential.allowed_paths.some(prefix => pathMatches(prefix, pathPrefix))) return json({ error: "path_scope_not_allowed" }, 403);
  const capMethods = normalizeMethods(body?.allowed_methods || credential.allowed_methods);
  if (!capMethods || capMethods.some(method => !credential.allowed_methods.includes(method))) return json({ error: "method_scope_not_allowed" }, 403);

  const ttlSeconds = Number(body?.ttl_seconds ?? 300);
  const maxCalls = Number(body?.max_calls ?? 1);
  const units = egressCredits(env);
  const maxPerCall = Number(body?.max_credits_per_call ?? units);
  const maxTotal = Number(body?.max_total_credits ?? maxCalls * units);
  let operationPolicy;
  try { operationPolicy = validateOperationPolicy(body.allowed_operations, body.operation_limits, credential.provider); }
  catch (cause) { return json({ error: cause.message }, 400); }
  let governance;
  try { governance = validateGovernancePolicy(body.governance); }
  catch (cause) { return json({ error: cause.message }, 400); }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600 || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000) return json({ error: "invalid_capability_limits" }, 400);
  if (!units) return json({ error: "egress_price_invalid" }, 503);
  if (!Number.isSafeInteger(maxPerCall) || maxPerCall < units || maxPerCall > 1000000 || !Number.isSafeInteger(maxTotal) || maxTotal < units || maxTotal > 1000000000) return json({ error: "invalid_credit_budget" }, 400);
  let billingEnvelope;
  try { billingEnvelope = await encryptSecret(env, key); } catch { return json({ error: "capability_encryption_unavailable" }, 503); }
  const capId = randomHex();
  const capSecret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `xgc_${capId}.${capSecret}`;
  const record = {
    id: capId,
    token_hash: await sha256(token),
    owner_hash: ownerHash,
    credential_id: credentialId,
    target_origin: origin.origin,
    path_prefix: pathPrefix,
    allowed_methods: capMethods,
    max_calls: maxCalls,
    used_calls: 0,
    max_credits_per_call: maxPerCall,
    max_total_credits: maxTotal,
    ...(operationPolicy || {}),
    ...(governance ? { governance, governance_state: "ACTIVE" } : {}),
    reserved_credits: 0,
    billing_envelope: billingEnvelope,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    revoked: false,
  };
  const stored = await capabilityStub(env, capId).fetch("https://capability/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!stored.ok) return json({ error: "capability_store_unavailable" }, 503);
  const indexed = await registryStub(env).fetch("https://meter/operator/issued", { method: "POST", body: JSON.stringify({ id: capId, owner_hash: ownerHash, expires_at: record.expires_at }) }).catch(() => null);
  if (!indexed?.ok) {
    await capabilityStub(env, capId).fetch("https://capability/revoke", { method: "POST", body: JSON.stringify({ owner_hash: ownerHash }) }).catch(() => {});
    return json({ error: "capability_index_unavailable", message: "No capability was issued to the client; retry provisioning." }, 503);
  }
  return json({
    capability: token,
    capability_id: capId,
    credential_id: credentialId,
    target_origin: record.target_origin,
    path_prefix: record.path_prefix,
    allowed_methods: record.allowed_methods,
    ...(operationPolicy || {}),
    ...(governance ? { governance, governance_state: "ACTIVE", governance_contract: GOVERNANCE_DISCOVERY } : {}),
    max_calls: maxCalls,
    max_credits_per_call: maxPerCall,
    max_total_credits: maxTotal,
    budget_scope: "XGuard Usage Credits; excludes upstream provider charges",
    expires_at: record.expires_at,
    note: "Give this scoped capability to the agent. Do not give the agent the upstream credential or XGuard Usage Credit key.",
  }, 201);
}

function parseCapabilityToken(token) {
  const match = String(token || "").match(/^xgc_([a-f0-9]{32})\.([A-Za-z0-9_-]{20,})$/i);
  return match ? { id: match[1].toLowerCase(), token: String(token) } : null;
}

export async function preflightCapability(env, token, plan) {
  const parsed = parseCapabilityToken(token);
  if (!parsed) return json({ error: "valid_xguard_capability_required" }, 401);
  if (!env.EGRESS_CAPABILITIES || !egressCredits(env)) return json({ error: "execution_configuration_unavailable" }, 503);
  return capabilityStub(env, parsed.id).fetch("https://capability/preflight", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, target: plan.target, method: plan.method, operation: plan.operation, operation_context: plan.context, units: egressCredits(env) }) });
}

export async function createControlledDemo(request, env) {
  if (!["EGRESS_KEYS", "EGRESS_CREDENTIALS", "EGRESS_CAPABILITIES", "EGRESS_METER", "PROOF_AUTHORITY"].every(k => env[k])) return json({ error: "demo_not_configured" }, 503);
  const subject = await sha256(request.headers.get("cf-connecting-ip") || "local-demo");
  for (const name of [`demo-admission:${subject}`, "demo-admission:global"]) {
    const admission = await env.EGRESS_METER.get(env.EGRESS_METER.idFromName(name)).fetch("https://meter/demo/admit", { method: "POST" });
    if (!admission.ok) return json({ error: "demo_rate_limited" }, 429, { "retry-after": "60" });
  }
  const id = randomHex(), credentialId = `xcred_${randomHex()}`, secret = `demo_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const token = `xgc_${id}.${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const ownerHash = await sha256(`controlled-demo:${id}`), expiresAt = new Date(Date.now() + 120000).toISOString();
  const credential = { id: credentialId, owner_hash: ownerHash, provider: "xguard-controlled-demo", demo: true, demo_id: id,
    injection: { header: "authorization", prefix: "Bearer " }, allowed_hosts: ["demo.xguardgate.com"], allowed_paths: ["/v1/fixture"], allowed_methods: ["GET"],
    envelope: await encryptSecret(env, secret), active: true, expires_at: expiresAt, created_at: new Date().toISOString() };
  const put = (stub, path, body) => stub.fetch(path, { method: "POST", body: JSON.stringify(body) });
  const configured = await put(env.EGRESS_METER.get(env.EGRESS_METER.idFromName(`controlled-demo:${id}`)), "https://meter/demo/configure", { secret_hash: await sha256(`Bearer ${secret}`), expires_at: expiresAt });
  if (!configured.ok || !(await put(credentialStub(env, credentialId), "https://credential/create", credential)).ok) return json({ error: "demo_setup_failed" }, 503);
  const record = { id, token_hash: await sha256(token), owner_hash: ownerHash, credential_id: credentialId, target_origin: "https://demo.xguardgate.com", path_prefix: "/v1/fixture", allowed_methods: ["GET"],
    max_calls: 1, used_calls: 0, max_credits_per_call: 0, max_total_credits: 0, reserved_credits: 0, billing_envelope: null, demo: true, demo_id: id,
    created_at: new Date().toISOString(), expires_at: expiresAt, revoked: false };
  if (!(await put(capabilityStub(env, id), "https://capability/create", record)).ok) return json({ error: "demo_setup_failed" }, 503);
  return json({ capability: token, capability_id: id, target: DEMO_TARGET, method: "GET", idempotency_key: `demo-${id}`, expires_at: expiresAt,
    cost: { usage_credits: 0, provider_cost: 0 }, mode: "controlled_authenticated_service", network_egress: false,
    description: "A real random server-side credential authenticates an internal read-only fixture. The capability uses the normal encryption, scope, reservation, redaction, durable-result and ProofRail path. No external provider or paid settlement is simulated as revenue." }, 201);
}

function serializeBody(body) {
  if (Object.hasOwn(body || {}, "body_json")) return { data: JSON.stringify(body.body_json), contentType: "application/json" };
  if (Object.hasOwn(body || {}, "body_text")) return { data: String(body.body_text), contentType: body?.content_type || "text/plain; charset=utf-8" };
  if (Object.hasOwn(body || {}, "body_base64")) {
    try { return { data: unb64url(body.body_base64), contentType: body?.content_type || "application/octet-stream" }; } catch { return null; }
  }
  return { data: null, contentType: null };
}

async function egressFetch(request, env) {
  const authorizing = new URL(request.url).pathname === "/v1/egress/authorize";
  const recovering = new URL(request.url).pathname === "/v1/egress/recover";
  let body;
  try { body = JSON.parse(dec.decode(await readBoundedBody(request.body, MAX_BODY_BYTES * 2))); } catch (cause) { return json({ error: cause.message === "response_too_large" ? "request_body_too_large" : "invalid_json" }, cause.message === "response_too_large" ? 413 : 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);
  const parsed = parseCapabilityToken(body?.capability || request.headers.get("x-xguard-capability"));
  if (!parsed) return json({ error: "valid_xguard_capability_required" }, 401);
  const latch = async () => {
    try { await capabilityStub(env, parsed.id).fetch("https://capability/governance/halt", {
      method: "POST", body: JSON.stringify({ token: parsed.token }), signal: AbortSignal.timeout(5000),
    }); } catch { /* A failed durable stop cannot authorize another dispatch. */ }
  };
  const reject = async (value, status) => { await latch(); return json(value, status); };
  try {
  let operationContext;
  if (body.operation) {
    try {
      const plan = compileOperation(body.operation, body.input);
      if (body.target !== plan.target || String(body.method || "GET").toUpperCase() !== plan.method
        || JSON.stringify(body.body_json) !== JSON.stringify(plan.body_json)
        || body.body_text !== undefined || body.body_base64 !== undefined) return reject({ error: "operation_request_mismatch" }, 400);
      body.headers = plan.headers;
      operationContext = plan.context;
    } catch (cause) { return reject({ error: cause.message }, 422); }
  }
  const target = demoTarget(body?.target) || safeTarget(body?.target);
  if (!target) return reject({ error: "public_https_target_required" }, 400);
  const method = String(body?.method || "GET").toUpperCase();
  if (!methods.has(method)) return reject({ error: "unsupported_method" }, 400);
  const serialized = serializeBody(body);
  if (!serialized) return reject({ error: "invalid_body_encoding" }, 400);
  const size = serialized.data == null ? 0 : (typeof serialized.data === "string" ? enc.encode(serialized.data).byteLength : serialized.data.byteLength);
  if (size > MAX_BODY_BYTES) return reject({ error: "request_body_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  if (["GET", "HEAD"].includes(method) && serialized.data !== null) return reject({ error: "body_not_allowed_for_method" }, 400);
  if (["body_json", "body_text", "body_base64"].filter(key => Object.hasOwn(body, key)).length > 1) return reject({ error: "ambiguous_body" }, 400);
  let units = egressCredits(env);
  if (!units || !env.PROOF_AUTHORITY) return reject({ error: "execution_configuration_unavailable" }, 503);
  let key, outgoing;
  try {
    if (!body.idempotency_key && !request.headers.has("idempotency-key")) throw new Error("idempotency_key_required");
    key = executionKey(request, body, method);
    outgoing = sanitizeHeaders(body.headers, "");
    if (serialized.contentType && !outgoing.has("content-type")) outgoing.set("content-type", serialized.contentType);
  } catch (cause) { return reject({ error: cause.message.startsWith("idempotency") || cause.message === "invalid_idempotency_key" ? cause.message : "invalid_headers" }, 400); }
  const digest = await requestDigest(target.toString(), method, outgoing, serialized.data);
  const keyHash = await sha256(key);

  const begun = await capabilityStub(env, parsed.id).fetch(`https://capability/${authorizing ? "authorize" : recovering ? "recover" : "begin"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: parsed.token, target: target.toString(), method, key_hash: keyHash, request_digest: digest, units, operation: body.operation, operation_context: operationContext, governance_authorization: body.governance_authorization }),
  });
  if (authorizing) return begun;
  const cap = await begun.json().catch(() => ({}));
  if (!begun.ok) return json(cap, begun.status);
  if (cap.demo === true) units = 0;
  if (cap.replay) {
    try {
      const stored = JSON.parse(await decryptSecret(env, cap.response_envelope));
      const headers = new Headers(stored.headers);
      headers.set("x-xguard-replay", "true");
      return new Response([204, 205, 304].includes(stored.status) || method === "HEAD" ? null : unb64url(stored.body), { status: stored.status, headers });
    } catch { return json({ error: "execution_result_unavailable", execution_id: cap.execution_id, may_have_executed: true }, 503); }
  }
  const finish = async (response, state, billedCredits = 0) => {
    try {
      const bytes = await readBoundedBody(response.body, MAX_RESULT_BYTES);
      const headers = new Headers(response.headers);
      headers.set("x-xguard-execution-id", cap.execution_id);
      headers.set("x-xguard-egress-capability", parsed.id);
      headers.set("x-xguard-egress-state", state);
      headers.set("x-xguard-demo", String(cap.demo === true));
      headers.set("x-xguard-replay", "false");
      headers.set("x-xguard-request-digest", digest);
      if (billedCredits !== null) headers.set("x-xguard-billed-credits", String(billedCredits));
      const proofResponse = await env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName("proofrail-root-v1")).fetch("https://proofrail/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { v: 1, typ: "xguard-proofrail-egress", iss: API, execution_id: cap.execution_id, capability_id: parsed.id, request_digest: digest, body_sha256: await digestBytes(bytes), target_origin: target.origin, target_path: target.pathname, method, outcome: state, upstream_status: headers.has("x-xguard-upstream-status") ? Number(headers.get("x-xguard-upstream-status")) : null, billed_credits: billedCredits, ...(cap.demo ? { demo: true, revenue: false } : {}), issued_at: new Date().toISOString() } }),
      });
      const signed = await proofResponse.json();
      if (!proofResponse.ok || !signed.proof) throw new Error("proof_unavailable");
      headers.set("x-xguard-proof", signed.proof);
      headers.set("x-xguard-proof-kid", signed.kid);
      headers.set("x-xguard-proof-alg", signed.alg);
      headers.set("access-control-expose-headers", "x-xguard-execution-id,x-xguard-egress-state,x-xguard-replay,x-xguard-request-digest,x-xguard-proof,x-xguard-proof-kid,x-xguard-proof-alg,x-xguard-billed-credits,x-xguard-upstream-status");
      const envelope = await encryptResult(env, JSON.stringify({ status: response.status, headers: [...headers], body: b64url(bytes) }));
      const saved = await capabilityStub(env, parsed.id).fetch("https://capability/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key_hash: keyHash, claim_token: cap.claim_token, response_envelope: envelope, state, billed_credits: billedCredits, governance_halt: state !== "completed" || response.status >= 300 }) });
      if (!saved.ok) throw new Error("result_commit_failed");
      return new Response([204, 205, 304].includes(response.status) || method === "HEAD" ? null : bytes, { status: response.status, headers });
    } catch {
      if (cap.governance) await capabilityStub(env, parsed.id).fetch("https://capability/governance/halt", { method: "POST", body: JSON.stringify({ token: parsed.token }) }).catch(() => {});
      return json({ error: "execution_result_unavailable", execution_id: cap.execution_id, may_have_executed: true, message: "The reserved operation will not be repeated. Retry only the identical request with the same key to retrieve a committed result." }, 503);
    }
  };
  // Every operation using this capability, including direct legacy raw egress,
  // has already passed signed authorization and an atomic capability reservation.
  if (cap.governance) {
    try {
      const daily = await env.EGRESS_METER.get(env.EGRESS_METER.idFromName(`governance-owner:${cap.owner_hash}`)).fetch("https://meter/governance/reserve", {
        method: "POST", body: JSON.stringify({ execution_id: cap.execution_id, amount: cap.economics.reserved_exposure_usd_micros, limit: cap.governance.daily_cost_limit_usd_micros }),
        signal: AbortSignal.timeout(5000),
      });
      if (!daily.ok || !(await daily.json()).allowed) return finish(json({ error: "governance_daily_budget_exceeded" }, 412), "failed_before_execution");
    } catch { return finish(json({ error: "governance_budget_store_unavailable" }, 503), "failed_before_execution"); }
  }
  const stillActive = async () => {
    if (!cap.governance) return true;
    try {
      const check = await capabilityStub(env, parsed.id).fetch("https://capability/governance/dispatch", { method: "POST", body: JSON.stringify({ token: parsed.token, key_hash: keyHash, claim_token: cap.claim_token }) });
      return check.ok;
    } catch { return false; }
  };
  const dns = cap.demo === true && demoTarget(target.href) ? { ok: true } : await publicDns(target.hostname);
  if (!dns.ok) return finish(json({ error: dns.code }, dns.code === "target_not_public" ? 403 : 503), "failed_before_execution");

  const credentialResponse = await credentialStub(env, cap.credential_id).fetch("https://credential/use", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_hash: cap.owner_hash, target: target.toString(), method }),
  });
  const credential = await credentialResponse.json().catch(() => ({}));
  if (!credentialResponse.ok) return finish(json({ error: credential.error || "credential_access_denied" }, credentialResponse.status), "failed_before_execution");

  let billingKey;
  if (!await stillActive()) return finish(json({ error: "governance_halted" }, 423), "failed_before_execution");
  try { billingKey = cap.demo ? null : await decryptSecret(env, cap.billing_envelope); } catch { return finish(json({ error: "billing_key_unavailable" }, 503), "failed_before_execution"); }
  const balance = cap.demo ? { ok: true, credits: 0 } : await billingBalance(env, billingKey);
  if (!balance.ok) return finish(json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable" }, balance.status === 404 ? 401 : 503), "failed_before_execution");
  if (!Number.isFinite(balance.credits) || balance.credits < units) return finish(json({ error: "insufficient_xguard_credits", required: units, checkout_url: env.XGUARD_CHECKOUT_URL || null }, 402), "failed_before_execution");
  const billed = cap.demo ? { ok: true } : await consumeCredits(env, billingKey, units, `xguard-egress:${cap.execution_id}`);
  if (!billed.ok) return finish(json({ error: billed.status === 402 ? "insufficient_xguard_credits" : "billing_commit_failed", checkout_url: env.XGUARD_CHECKOUT_URL || null }, billed.status === 402 ? 402 : 503), billed.status === 402 ? "failed_before_execution" : "billing_ambiguous", billed.status === 402 ? 0 : null);

  let secret;
  if (!await stillActive()) return finish(json({ error: "governance_halted_after_billing" }, 423), "failed_before_execution", units);
  try { secret = await decryptSecret(env, credential.envelope); } catch { return finish(json({ error: "credential_decryption_unavailable" }, 503), "failed_before_execution", units); }
  const headers = sanitizeHeaders(Object.fromEntries(outgoing), credential.injection?.header);
  headers.set(credential.injection.header, `${credential.injection.prefix || ""}${secret}`);
  if (serialized.contentType && !headers.has("content-type")) headers.set("content-type", serialized.contentType);
  if (!["GET", "HEAD"].includes(method)) headers.set("idempotency-key", cap.execution_id);
  headers.set("x-xguard-egress-capability", parsed.id);

  const started = Date.now();
  try {
    if (!await stillActive()) return finish(json({ error: "governance_halted_after_billing" }, 423), "failed_before_execution", units);
    const fetchTarget = cap.demo ? (targetUrl, options) => env.EGRESS_METER.get(env.EGRESS_METER.idFromName(`controlled-demo:${cap.demo_id}`)).fetch("https://meter/demo/provider", options) : fetch;
    const upstream = await fetchTarget(target.toString(), {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : serialized.data,
      redirect: "manual",
      signal: AbortSignal.timeout(EGRESS_TIMEOUT_MS),
    });
    let bytes = await readBoundedBody(upstream.body, MAX_RESULT_BYTES);
    const decoded = dec.decode(bytes);
    if (credentialVariants(secret).some(value => decoded.includes(value))) throw new Error("credential_reflected_by_upstream");
    if (body.operation === "cloudflare.worker.metadata") bytes = enc.encode(JSON.stringify(normalizedProviderResult(body.operation, JSON.parse(decoded))));
    const responseHeaders = safeResponseHeaders(upstream.headers, secret, credential.injection.header);
    responseHeaders.set("x-xguard-egress", VERSION);
    responseHeaders.set("x-xguard-egress-capability", parsed.id);
    responseHeaders.set("x-xguard-billed-credits", String(units));
    responseHeaders.set("x-xguard-upstream-status", String(upstream.status));
    responseHeaders.set("cache-control", "no-store");
    if (!cap.demo) await meterStub(env).fetch("https://meter/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billed_credits: units, upstream_status: upstream.status, latency_ms: Date.now() - started, ambiguous: false }),
    }).catch(() => null);
    return finish(new Response([204, 205, 304].includes(upstream.status) || method === "HEAD" ? null : bytes, { status: upstream.status, headers: responseHeaders }), "completed", units);
  } catch (error) {
    if (!cap.demo) await meterStub(env).fetch("https://meter/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billed_credits: units, latency_ms: Date.now() - started, ambiguous: true }),
    }).catch(() => null);
    return finish(json({ error: "egress_outcome_ambiguous", reason: ["response_too_large", "response_headers_too_large", "credential_reflected_by_upstream"].includes(error.message) ? error.message : "upstream_transport_failed", message: "The authorized attempt was billed. XGuard cannot safely deliver its outcome and will not repeat it.", execution_id: cap.execution_id }, 503), "ambiguous", units);
  }
  } catch {
    await latch();
    return json({ error: "egress_control_unavailable", may_have_executed: true,
      message: "Dispatch stopped. Preserve the request and key; use read-only recovery and reconcile uncertain side effects." }, 503);
  }
}

export class EgressKeyAuthority {
  constructor(state) { this.state = state; }

  async keys() {
    if (!this.keyPromise) this.keyPromise = this.loadKeys().catch(cause => { this.keyPromise = null; throw cause; });
    return this.keyPromise;
  }

  async loadKeys() {
    let record = await this.state.storage.get("keys");
    if (record) return record;
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    record = {
      public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      private_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      kid: `xguard-egress-rsa-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    await this.state.storage.put("keys", record);
    return record;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const record = await this.keys();
    if (path === "/public") return json({ kid: record.kid, alg: "RSA-OAEP-256", jwk: record.public_jwk, created_at: record.created_at }, 200, { "cache-control": "public, max-age=300" });
    if (["/encrypt", "/encrypt-result"].includes(path) && request.method === "POST") {
      const body = await request.json();
      const plaintext = String(body?.plaintext || "");
      if (!plaintext || enc.encode(plaintext).byteLength > (path === "/encrypt-result" ? MAX_STORED_RESULT_BYTES : MAX_SECRET_BYTES)) return json({ error: "invalid_plaintext" }, 400);
      const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(plaintext));
      const raw = await crypto.subtle.exportKey("raw", aes);
      const publicKey = await crypto.subtle.importKey("jwk", record.public_jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
      const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, raw);
      return json({ kid: record.kid, wrapped_key: b64url(wrapped), iv: b64url(iv), ciphertext: b64url(ciphertext) });
    }
    if (path === "/decrypt" && request.method === "POST") {
      const body = await request.json();
      const envelope = body?.envelope || {};
      try {
        const privateKey = await crypto.subtle.importKey("jwk", record.private_jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
        const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, unb64url(envelope.wrapped_key));
        const aes = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(envelope.iv) }, aes, unb64url(envelope.ciphertext));
        return json({ plaintext: dec.decode(plaintext) });
      } catch {
        return json({ error: "decrypt_failed" }, 403);
      }
    }
    return json({ error: "not_found" }, 404);
  }
}

export class EgressCredentialState {
  constructor(state) { this.state = state; }
  async alarm() { if ((await this.state.storage.get("record"))?.demo) await this.state.storage.deleteAll(); }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      if (await this.state.storage.get("record")) return json({ error: "credential_exists" }, 409);
      const record = await request.json();
      await this.state.storage.put("record", record);
      if (record.demo) await this.state.storage.setAlarm(Date.parse(record.expires_at) + 86400000);
      return json({ ok: true }, 201);
    }
    const record = await this.state.storage.get("record");
    if (!record || record.active === false) return json({ error: "credential_not_found" }, 404);
    if (["/read", "/use", "/delete"].includes(path) && request.method === "POST") {
      const body = await request.json();
      if (body?.owner_hash !== record.owner_hash) return json({ error: "credential_access_denied" }, 403);
      if (path === "/delete") {
        record.active = false;
        record.deleted_at = new Date().toISOString();
        await this.state.storage.put("record", record);
        return json({ ok: true, credential_id: record.id });
      }
      if (path === "/use") {
        const target = record.demo ? demoTarget(body?.target) : safeTarget(body?.target);
        const method = String(body?.method || "GET").toUpperCase();
        if (!target || !targetAllowed(record, target, method)) return json({ error: "credential_scope_denied" }, 403);
      }
      if (body?.metadata_only) return json(publicCredential(record));
      return json(record);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class EgressTenantIndex {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const items = (await this.state.storage.get("items")) || {};
    if (path === "/add" && request.method === "POST") {
      const item = await request.json();
      items[item.id] = item;
      await this.state.storage.put("items", items);
      return json({ ok: true });
    }
    if (path === "/remove" && request.method === "POST") {
      const body = await request.json();
      delete items[body?.id];
      await this.state.storage.put("items", items);
      return json({ ok: true });
    }
    if (path === "/list") return json({ credentials: Object.values(items).filter(item => item?.active !== false) });
    return json({ error: "not_found" }, 404);
  }
}

export class EgressCapabilityState {
  constructor(state, env) { this.state = state; this.governor = new XGuardAuthorizationGateway(state.storage, env); }
  async alarm() {
    const record = await this.state.storage.get("record");
    const cleanupAt = Date.parse(record?.expires_at || "") + 86400000;
    if (!record || Date.now() >= cleanupAt) await this.state.storage.deleteAll();
    else await this.state.storage.setAlarm(cleanupAt);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      if (await this.state.storage.get("record")) return json({ error: "capability_exists" }, 409);
      const record = await request.json();
      if (!record.demo) {
        try { record.governance = validateGovernancePolicy(record.governance); }
        catch (cause) { return json({ error: cause.message }, 400); }
        record.governance_state = "ACTIVE";
      }
      await this.state.storage.put("record", record);
      await this.state.storage.setAlarm(Date.parse(record.expires_at) + 86400000);
      return json({ ok: true }, 201);
    }
    const record = await this.state.storage.get("record");
    if (!record) return json({ error: "capability_not_found" }, 404);
    if (path === "/recover" && request.method === "POST") {
      const body = await request.json();
      if (!equalHash(await sha256(body?.token || ""), record.token_hash)) return json({ error: "invalid_capability" }, 403);
      if (record.revoked || Date.now() >= Date.parse(record.expires_at)) return json({ error: "capability_inactive" }, 403);
      if (!/^[a-f0-9]{64}$/.test(body.key_hash || "")) return json({ error: "invalid_execution_request" }, 400);
      const previous = await this.state.storage.get(`execution:${body.key_hash}`);
      if (!previous) return json({ error: "execution_not_found", executed: false }, 404);
      if (previous.request_digest !== body.request_digest) return json({ error: "idempotency_request_conflict" }, 409);
      if (!previous.response_envelope) return json({ error: "execution_outcome_unknown", automatic_reexecution: false }, 409);
      return json({ replay: true, execution_id: previous.execution_id, response_envelope: previous.response_envelope });
    }
    if (path.startsWith("/governance/") && request.method === "POST") {
      const body = await request.json();
      if (!equalHash(await sha256(body?.token || ""), record.token_hash)) return json({ error: "invalid_capability" }, 403);
      if (!record.governance && (record.demo || path === "/governance/dispatch")) return json({ error: "governance_policy_required" }, 412);
      if (path === "/governance/halt") {
        await this.governor.halt("authenticated_client_stop");
        return json({ ok: true, state: "HALTED", remote_side_effects_may_finish: true });
      }
      if (path === "/governance/status") return json({ ok: true, state: record.governance_state || "POLICY_REQUIRED", halt_reason: record.halt_reason || null,
        pending_execution: Boolean(record.pending_execution), revoked: record.revoked, expires_at: record.expires_at });
      if (path === "/governance/dispatch") {
        const operation = await this.state.storage.get(`execution:${body.key_hash}`);
        if (!operation || operation.claim_token !== body.claim_token || operation.state !== "reserved") return json({ error: "execution_claim_invalid" }, 409);
        const current = await this.state.storage.get("record");
        if (current.governance_state === "HALTED" || current.revoked || Date.now() >= Date.parse(current.expires_at)) return json({ error: "governance_halted" }, 423);
        try { if (!evaluateForecast(current.governance, operation.request_digest).allowed) throw new Error("net_value_below_floor"); }
        catch { await this.governor.halt("forecast_invalid_before_dispatch"); return json({ error: "governance_forecast_invalid" }, 412); }
        return json({ ok: true });
      }
      return json({ error: "not_found" }, 404);
    }
    if (path === "/revoke" && request.method === "POST") {
      const body = await request.json();
      if (!equalHash(body.owner_hash, record.owner_hash)) return json({ error: "capability_access_denied" }, 403);
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        await txn.put("record", { ...current, revoked: true, revoked_at: new Date().toISOString() });
      });
      return json({ ok: true, revoked: true, in_flight_execution_may_finish: true });
    }
    if (path === "/complete" && request.method === "POST") {
      const body = await request.json();
      if (!/^[a-f0-9]{64}$/.test(body.key_hash || "") || !["completed", "failed_before_execution", "ambiguous", "billing_ambiguous"].includes(body.state)) return json({ error: "invalid_execution_result" }, 400);
      let result;
      await this.state.storage.transaction(async txn => {
        const key = `execution:${body.key_hash}`;
        const operation = await txn.get(key);
        if (!operation || operation.state !== "reserved" || operation.claim_token !== body.claim_token || !body.response_envelope?.ciphertext) { result = json({ error: "execution_claim_invalid" }, 409); return; }
        if (body.billed_credits !== null && (!Number.isSafeInteger(body.billed_credits) || body.billed_credits < 0 || body.billed_credits > operation.units)) { result = json({ error: "invalid_billed_credits" }, 400); return; }
        await txn.put(key, { ...operation, state: body.state, claim_token: null, billed_credits: body.billed_credits, response_envelope: body.response_envelope, completed_at: new Date().toISOString() });
        if (body.billed_credits === 0) {
          const current = await txn.get("record");
          current.reserved_credits = Math.max(0, current.reserved_credits - operation.units);
          await txn.put("record", current);
        }
        const current = await txn.get("record");
        if (current.governance) {
          if (current.pending_execution === body.key_hash) current.pending_execution = null;
          if (body.governance_halt && current.governance_state !== "HALTED") Object.assign(current, { governance_state: "HALTED", halt_reason: "execution_failed_or_uncertain", halted_at: new Date().toISOString() });
          await txn.put("record", current);
        }
        result = json({ ok: true });
      });
      return result;
    }
    if (["/begin", "/preflight", "/authorize"].includes(path) && request.method === "POST") {
      const body = await request.json();
      if (path !== "/preflight" && (!/^[a-f0-9]{64}$/.test(body.key_hash || "") || !/^[a-f0-9]{64}$/.test(body.request_digest || "")) || !Number.isSafeInteger(body.units) || body.units <= 0) return json({ error: "invalid_execution_request" }, 400);
      if (!equalHash(await sha256(body?.token || ""), record.token_hash)) return json({ error: "invalid_capability" }, 403);
      // Authenticate before latching: a stranger cannot stop another workload by
      // guessing its capability ID or sending an invalid signature without its token.
      // Persisted pre-migration grants fail closed too. There is no request flag,
      // header or configuration switch that can opt external execution out.
      // The server-created demo can only reach its internal read-only fixture.
      if (!record.governance && !record.demo) {
        await this.governor.halt("governance_policy_required");
        return json({ error: "governance_policy_required", state: "HALTED", migration_required: true }, 412);
      }
      if (path === "/authorize" && record.demo) return json({ error: "demo_has_no_external_execution" }, 412);
      if (record.demo) body.units = 0;
      const target = record.demo ? demoTarget(body?.target) : safeTarget(body?.target);
      const method = String(body?.method || "GET").toUpperCase();
      if (!target || target.origin !== record.target_origin || !pathMatches(record.path_prefix, target.pathname) || !record.allowed_methods.includes(method)) { if (record.governance) await this.governor.halt("capability_scope_denied"); return json({ error: "capability_scope_denied" }, 403); }
      if (!operationPolicyAllows(record, body.operation, body.operation_context)) { if (record.governance) await this.governor.halt("capability_operation_denied"); return json({ error: "capability_operation_denied" }, 403); }
      let authorization;
      if (record.governance && path === "/begin") {
        try { authorization = await this.governor.validate(record, body); }
        catch (cause) { await this.governor.halt("authorization_invalid_or_unavailable"); return json({ error: cause.message, state: "HALTED" }, 403); }
      }
      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.revoked) { result = { status: 403, body: { error: "capability_revoked" } }; return; }
        if (Date.now() >= Date.parse(current.expires_at)) { result = { status: 410, body: { error: "capability_expired" } }; return; }
        if (path === "/preflight" || path === "/authorize") {
          if (current.governance_state === "HALTED") { result = { status: 423, body: { error: "governance_halted" } }; return; }
          let economics;
          if (path === "/authorize") {
            try { economics = evaluateForecast(current.governance, body.request_digest); }
            catch (cause) { result = { status: 412, body: { error: cause.message } }; return; }
            if (!economics.allowed) { result = { status: 412, body: { error: "net_expected_value_below_floor", economics } }; return; }
          }
          const remaining = Math.max(0, current.max_total_credits - (current.reserved_credits || 0));
          const allowed = current.used_calls < current.max_calls && body.units <= current.max_credits_per_call && remaining >= body.units;
          result = { status: allowed ? 200 : 402, body: { ok: allowed, ...(allowed ? {} : { error: "capability_budget_exceeded" }), policy_allowed: allowed,
            reserved: false, executed: false, billing_committed: false, billing_balance_checked: false, credits_per_attempt: body.units,
            remaining_calls: Math.max(0, current.max_calls - current.used_calls), remaining_credits: remaining, expires_at: current.expires_at,
            ...(economics ? { economics } : {}), strict_governance: Boolean(current.governance),
            note: "Advisory snapshot; execution rechecks authorization, scope, budget, balance and idempotency atomically." } };
          return;
        }
        const operationKey = `execution:${body.key_hash}`;
        const existing = await txn.get(operationKey);
        if (existing) {
          if (existing.request_digest !== body.request_digest) {
            if (current.governance) await txn.put("record", { ...current, governance_state: "HALTED", halt_reason: "idempotency_request_conflict", halted_at: new Date().toISOString() });
            result = { status: 409, body: { error: "idempotency_request_conflict", execution_id: existing.execution_id } }; return;
          }
          if (existing.response_envelope) { result = { status: 200, body: { replay: true, execution_id: existing.execution_id, response_envelope: existing.response_envelope } }; return; }
          result = { status: 409, body: { error: Date.now() - Date.parse(existing.created_at) > 60000 ? "execution_outcome_unknown" : "execution_in_progress", execution_id: existing.execution_id, retry_with_same_key_only: true, automatic_reexecution: false } };
          return;
        }
        let economics;
        if (current.governance) {
          if (current.governance_state === "HALTED") { result = { status: 423, body: { error: "governance_halted" } }; return; }
          if (Date.now() >= authorization.exp) { result = { status: 412, body: { error: "governance_authorization_expired" } }; return; }
          if (current.pending_execution) { result = { status: 409, body: { error: "governance_execution_pending", automatic_reexecution: false } }; return; }
          try { economics = evaluateForecast(current.governance, body.request_digest); }
          catch (cause) { result = { status: 412, body: { error: cause.message } }; return; }
          if (!economics.allowed) { result = { status: 412, body: { error: "net_expected_value_below_floor", economics } }; return; }
          current.pending_execution = body.key_hash;
        }
        if (current.used_calls >= current.max_calls) { result = { status: 409, body: { error: "capability_exhausted" } }; return; }
        const reserved = current.reserved_credits ?? current.used_calls * DEFAULT_CREDITS;
        const maxPerCall = current.max_credits_per_call ?? DEFAULT_CREDITS;
        const maxTotal = current.max_total_credits ?? current.max_calls * DEFAULT_CREDITS;
        if (body.units > maxPerCall || reserved + body.units > maxTotal) { result = { status: 402, body: { error: "capability_credit_budget_exceeded", required: body.units, remaining: Math.max(0, maxTotal - reserved) } }; return; }
        const operation = { execution_id: `xge_${randomHex()}`, claim_token: randomHex(), request_digest: body.request_digest, units: body.units, state: "reserved", created_at: new Date().toISOString() };
        current.reserved_credits = reserved + body.units;
        current.used_calls += 1;
        current.last_used_at = new Date().toISOString();
        await txn.put("record", current);
        await txn.put(operationKey, operation);
        result = { status: 200, body: { credential_id: current.credential_id, owner_hash: current.owner_hash, billing_envelope: current.billing_envelope, execution_id: operation.execution_id, claim_token: operation.claim_token, used_calls: current.used_calls, max_calls: current.max_calls, ...(current.governance ? { governance: current.governance, economics } : {}), ...(current.demo ? { demo: true, demo_id: current.demo_id } : {}) } };
      });
      if (path === "/authorize" && result.status === 200) {
        try { return json(await this.governor.authorize(record, body, result.body.economics)); }
        catch { await this.governor.halt("governance_signing_unavailable"); return json({ error: "governance_signing_unavailable", state: "HALTED" }, 503); }
      }
      return json(result.body, result.status);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class EgressMeter {
  constructor(state) { this.state = state; }
  async alarm() { if (await this.state.storage.get("controlled-demo")) await this.state.storage.deleteAll(); }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/governance/reserve" && request.method === "POST") {
      try { const value = await reserveDailyExposure(this.state.storage, await request.json()); return json(value, value.allowed ? 200 : 412); }
      catch { return json({ error: "governance_budget_store_unavailable" }, 503); }
    }
    if (path === "/operator/issued" && request.method === "POST") {
      const body = await request.json();
      if (!/^[a-f0-9]{32}$/.test(body.id || "") || !/^[a-f0-9]{64}$/.test(body.owner_hash || "") || !Number.isFinite(Date.parse(body.expires_at))) return json({ error: "invalid_registry_record" }, 400);
      await this.state.storage.put(`operator-cap:${body.id}`, { owner_hash: body.owner_hash, expires_at: body.expires_at, revoked: false });
      if (!await this.state.storage.get("registry-started")) await this.state.storage.put("registry-started", Date.now());
      return json({ ok: true });
    }
    if (path === "/operator/revoked" && request.method === "POST") {
      const body = await request.json(), key = `operator-cap:${body.id}`;
      const record = await this.state.storage.get(key);
      if (record) await this.state.storage.put(key, { ...record, revoked: true });
      return json({ ok: true });
    }
    if (path === "/operator/snapshot" && request.method === "GET") {
      const owners = new Set(); let active = 0, startAfter, examined = 0;
      while (examined < 100000) {
        const rows = await this.state.storage.list({ prefix: "operator-cap:", limit: 1000, ...(startAfter ? { startAfter } : {}) });
        for (const [key, record] of rows) { examined++; startAfter = key; if (!record.revoked && Date.parse(record.expires_at) > Date.now()) { active++; owners.add(record.owner_hash); } else await this.state.storage.delete(key); }
        if (rows.size < 1000) break;
      }
      const started = await this.state.storage.get("registry-started");
      return json({ active_operators: examined < 100000 ? owners.size : null, active_capabilities: examined < 100000 ? active : null,
        observed_since: started ? new Date(started).toISOString() : null, historical_backfill_complete: Boolean(started && Date.now() - started > 3600000),
        definition: "Unrevoked, unexpired operator-issued capabilities; controlled demo capabilities excluded. Pre-release capabilities expire within one hour." });
    }
    if (path === "/demo/admit" && request.method === "POST") {
      const bucket = Math.floor(Date.now() / 60000);
      let allowed;
      await this.state.storage.transaction(async tx => {
        const old = await tx.get("demo-quota"), count = old?.bucket === bucket ? old.count : 0;
        allowed = count < 5;
        if (allowed) await tx.put("demo-quota", { bucket, count: count + 1 });
      });
      return json({ allowed }, allowed ? 200 : 429);
    }
    if (path === "/demo/configure" && request.method === "POST") {
      if (await this.state.storage.get("controlled-demo")) return json({ error: "demo_exists" }, 409);
      const body = await request.json();
      await this.state.storage.put("controlled-demo", body);
      await this.state.storage.setAlarm(Date.parse(body.expires_at) + 86400000);
      return json({ ok: true });
    }
    if (path === "/demo/provider" && request.method === "GET") {
      const record = await this.state.storage.get("controlled-demo");
      if (!record || Date.now() >= Date.parse(record.expires_at) || !equalHash(await sha256(request.headers.get("authorization") || ""), record.secret_hash)) return json({ error: "demo_provider_authentication_failed" }, 403);
      return json({ authenticated: true, fixture: { project: "XGuard controlled demo", operation: "read", message: "The server authenticated your capability-backed request." }, secret_returned: false });
    }
    if (path === "/telemetry/record" && request.method === "POST") {
      await recordTelemetry(this.state.storage, await request.json());
      return json({ ok: true });
    }
    if (path === "/telemetry/snapshot" && request.method === "GET") return json(await telemetrySnapshot(this.state.storage));
    if (request.method === "POST" && ["/agent-usage/admit", "/agent-usage/record"].includes(path)) {
      try {
        if (path === "/agent-usage/admit") {
          const admission = await admitUsage(this.state.storage);
          return json(admission, admission.allowed ? 200 : 429);
        }
        return json(await recordUsage(this.state.storage, await request.json()));
      } catch (cause) {
        const error = cause instanceof UsageError ? cause : new UsageError("usage_store_unavailable", 503, "Usage storage could not commit the event.", true);
        return json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, error.status);
      }
    }
    if (path === "/record" && request.method === "POST") {
      const body = await request.json();
      let output;
      await this.state.storage.transaction(async txn => {
        const meter = (await txn.get("meter")) || { attempts: 0, billed_credits: 0, upstream_2xx: 0, upstream_4xx: 0, upstream_5xx: 0, redirects: 0, ambiguous: 0, latency_ms_total: 0, updated_at: null };
        meter.attempts += 1;
        meter.billed_credits += Number(body?.billed_credits || 0);
        meter.latency_ms_total += Number(body?.latency_ms || 0);
        if (body?.ambiguous) meter.ambiguous += 1;
        else {
          const status = Number(body?.upstream_status || 0);
          if (status >= 200 && status < 300) meter.upstream_2xx += 1;
          else if (status >= 300 && status < 400) meter.redirects += 1;
          else if (status >= 400 && status < 500) meter.upstream_4xx += 1;
          else if (status >= 500) meter.upstream_5xx += 1;
        }
        meter.updated_at = new Date().toISOString();
        await txn.put("meter", meter);
        output = meter;
      });
      return json(output);
    }
    if (path === "/stats") {
      const meter = (await this.state.storage.get("meter")) || { attempts: 0, billed_credits: 0, upstream_2xx: 0, upstream_4xx: 0, upstream_5xx: 0, redirects: 0, ambiguous: 0, latency_ms_total: 0, updated_at: null };
      return json({ ...meter, average_latency_ms: meter.attempts ? Math.round(meter.latency_ms_total / meter.attempts) : 0 });
    }
    return json({ error: "not_found" }, 404);
  }
}

export const __test = { providerPolicy, targetAllowed, parseCapabilityToken, safeTarget, sanitizeHeaders, normalizePolicyPath, pathMatches, privateHost, equalHash };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if ((path === "/v1/egress" || path === "/.well-known/xguard-egress.json") && ["GET", "HEAD"].includes(request.method)) {
      const response = json(discovery(env), 200, { "cache-control": "public, max-age=120" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === "/.well-known/xguard-egress-key.json" && ["GET", "HEAD"].includes(request.method)) {
      const response = await keyStub(env).fetch("https://egress-key/public");
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === "/v1/egress/providers" && request.method === "GET") {
      return json({ providers: Object.fromEntries(Object.entries(PROVIDERS).map(([name, value]) => [name, { hosts: value.hosts, injection_header: value.header }])), custom: { requires: ["header_name", "allowed_hosts"] } });
    }
    if (path === "/v1/egress/credentials" && request.method === "POST") return createCredential(request, env);
    if (path === "/v1/egress/credentials" && request.method === "GET") return listCredentials(request, env);
    if (path.startsWith("/v1/egress/credentials/") && request.method === "DELETE") {
      const id = path.split("/").pop();
      if (!/^xcred_[a-f0-9]{32}$/i.test(id || "")) return json({ error: "invalid_credential_id" }, 400);
      return deleteCredential(request, env, id);
    }
    if (path === "/v1/egress/capabilities" && request.method === "POST") return issueCapability(request, env);
    if (/^\/v1\/egress\/capabilities\/[a-f0-9]{32}$/.test(path) && request.method === "DELETE") {
      const key = keyOf(request);
      if (!key) return json({ error: "xguard_key_required" }, 401);
      const id = path.split("/").pop();
      const response = await capabilityStub(env, id).fetch("https://capability/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner_hash: await sha256(key) }) });
      if (response.ok) await registryStub(env).fetch("https://meter/operator/revoked", { method: "POST", body: JSON.stringify({ id }) });
      return response;
    }
    if (["/v1/egress/fetch", "/v1/egress/authorize", "/v1/egress/recover"].includes(path) && request.method === "POST") return egressFetch(request, env);
    if (["/v1/egress/halt", "/v1/egress/governance-status"].includes(path) && request.method === "POST") {
      let body;
      try { body = JSON.parse(dec.decode(await readBoundedBody(request.body, 8192))); } catch { return json({ error: "invalid_json" }, 400); }
      const parsed = parseCapabilityToken(body.capability);
      if (!parsed) return json({ error: "valid_xguard_capability_required" }, 401);
      return capabilityStub(env, parsed.id).fetch(`https://capability/governance/${path.endsWith("/halt") ? "halt" : "status"}`, { method: "POST", body: JSON.stringify({ token: parsed.token }) });
    }
    if (path === "/v1/egress/pricing" && request.method === "GET") return json({ credits_per_authorized_egress_attempt: egressCredits(env), billing_boundary: "XGuard Usage Credits are consumed before credential release and before outbound network egress.", failed_billing: "no upstream request is sent", upstream_failure_after_billing: "the egress attempt remains billed; XGuard never auto-replays an ambiguous attempt", checkout_url: env.XGUARD_CHECKOUT_URL || null });
    if (path === "/v1/egress/stats" && request.method === "GET") return meterStub(env).fetch("https://meter/stats");
    return null;
  },
};
