const VERSION = "1.0.0";
const API = "https://api.xguardgate.com";
const DEFAULT_CREDITS = 1;
const MAX_SECRET_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
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

function randomHex() {
  return crypto.randomUUID().replaceAll("-", "");
}

function privateHost(hostname) {
  const host = low(hostname).replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return true;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function safeTarget(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || privateHost(url.hostname)) return null;
  if (url.hostname === "xguardgate.com" || url.hostname === "api.xguardgate.com") return null;
  return url;
}

function billingUrl(env) {
  return String(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com").replace(/\/$/, "");
}

function egressCredits(env) {
  return Math.max(1, Math.trunc(Number(env.EGRESS_EXECUTION_CREDITS || DEFAULT_CREDITS)));
}

async function billingBalance(env, key) {
  if (!key) return { ok: false, status: 401, credits: 0 };
  try {
    const response = await fetch(`${billingUrl(env)}/v1/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, credits: Number(data?.credits ?? data?.balance ?? 0) };
  } catch {
    return { ok: false, status: 503, credits: 0 };
  }
}

async function consumeCredits(env, key, units) {
  try {
    const response = await fetch(`${billingUrl(env)}/v1/consume`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ units }),
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
  if (hosts.some(host => host.includes("/") || host.includes(":") || privateHost(host) || host === "xguardgate.com" || host === "api.xguardgate.com")) return null;
  return hosts;
}

function normalizePaths(values) {
  const source = Array.isArray(values) && values.length ? values : ["/"];
  const paths = [...new Set(source.map(value => String(value || "").trim()).filter(value => value.startsWith("/") && value.length <= 256))];
  return paths.length && paths.length <= 32 ? paths : null;
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
  if (!record.allowed_paths?.some(prefix => target.pathname.startsWith(prefix))) return false;
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

async function encryptSecret(env, plaintext) {
  const response = await keyStub(env).fetch("https://egress-key/encrypt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plaintext }),
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
    guarantee: "Agents receive scoped XGuard capabilities, never reusable upstream API credentials. XGuard injects the credential only after scope and Usage Credit checks, then forwards one public HTTPS request without following redirects.",
    credentials: `POST ${API}/v1/egress/credentials`,
    list_credentials: `GET ${API}/v1/egress/credentials`,
    capabilities: `POST ${API}/v1/egress/capabilities`,
    fetch: `POST ${API}/v1/egress/fetch`,
    providers: `GET ${API}/v1/egress/providers`,
    public_key: `${API}/.well-known/xguard-egress-key.json`,
    credits_per_authorized_egress_attempt: egressCredits(env),
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
      "automatic Idempotency-Key for unsafe methods",
      "no automatic retry after network ambiguity",
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
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
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
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
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
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || !credential.allowed_hosts.includes(low(origin.hostname))) {
    return json({ error: "target_origin_not_allowed" }, 403);
  }
  const pathPrefix = String(body?.path_prefix || credential.allowed_paths?.[0] || "/");
  if (!pathPrefix.startsWith("/") || !credential.allowed_paths.some(prefix => pathPrefix.startsWith(prefix))) return json({ error: "path_scope_not_allowed" }, 403);
  const capMethods = normalizeMethods(body?.allowed_methods || credential.allowed_methods);
  if (!capMethods || capMethods.some(method => !credential.allowed_methods.includes(method))) return json({ error: "method_scope_not_allowed" }, 403);

  const ttlSeconds = Math.max(30, Math.min(3600, Math.trunc(Number(body?.ttl_seconds || 300))));
  const maxCalls = Math.max(1, Math.min(1000, Math.trunc(Number(body?.max_calls || 1))));
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
  return json({
    capability: token,
    credential_id: credentialId,
    target_origin: record.target_origin,
    path_prefix: record.path_prefix,
    allowed_methods: record.allowed_methods,
    max_calls: maxCalls,
    expires_at: record.expires_at,
    note: "Give this scoped capability to the agent. Do not give the agent the upstream credential or XGuard Usage Credit key.",
  }, 201);
}

function parseCapabilityToken(token) {
  const match = String(token || "").match(/^xgc_([a-f0-9]{32})\.([A-Za-z0-9_-]{20,})$/i);
  return match ? { id: match[1].toLowerCase(), token: String(token) } : null;
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
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = parseCapabilityToken(body?.capability || request.headers.get("x-xguard-capability"));
  if (!parsed) return json({ error: "valid_xguard_capability_required" }, 401);
  const target = safeTarget(body?.target);
  if (!target) return json({ error: "public_https_target_required" }, 400);
  const method = String(body?.method || "GET").toUpperCase();
  if (!methods.has(method)) return json({ error: "unsupported_method" }, 400);
  const serialized = serializeBody(body);
  if (!serialized) return json({ error: "invalid_body_encoding" }, 400);
  const size = serialized.data == null ? 0 : (typeof serialized.data === "string" ? enc.encode(serialized.data).byteLength : serialized.data.byteLength);
  if (size > MAX_BODY_BYTES) return json({ error: "request_body_too_large", max_bytes: MAX_BODY_BYTES }, 413);

  const begun = await capabilityStub(env, parsed.id).fetch("https://capability/begin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: parsed.token, target: target.toString(), method }),
  });
  const cap = await begun.json().catch(() => ({}));
  if (!begun.ok) return json(cap, begun.status);

  const credentialResponse = await credentialStub(env, cap.credential_id).fetch("https://credential/use", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_hash: cap.owner_hash, target: target.toString(), method }),
  });
  const credential = await credentialResponse.json().catch(() => ({}));
  if (!credentialResponse.ok) return json({ error: credential.error || "credential_access_denied" }, credentialResponse.status);

  let billingKey;
  try { billingKey = await decryptSecret(env, cap.billing_envelope); } catch { return json({ error: "billing_key_unavailable" }, 503); }
  const units = egressCredits(env);
  const balance = await billingBalance(env, billingKey);
  if (!balance.ok) return json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable" }, balance.status === 404 ? 401 : 503);
  if (balance.credits < units) return json({ error: "insufficient_xguard_credits", credits: balance.credits, required: units, checkout_url: env.XGUARD_CHECKOUT_URL || null }, 402);
  const billed = await consumeCredits(env, billingKey, units);
  if (!billed.ok) return json({ error: billed.status === 402 ? "insufficient_xguard_credits" : "billing_commit_failed", checkout_url: env.XGUARD_CHECKOUT_URL || null }, billed.status === 402 ? 402 : 503);

  let secret;
  try { secret = await decryptSecret(env, credential.envelope); } catch { return json({ error: "credential_decryption_unavailable" }, 503); }
  const headers = sanitizeHeaders(body?.headers, credential.injection?.header);
  headers.set(credential.injection.header, `${credential.injection.prefix || ""}${secret}`);
  if (serialized.contentType && !headers.has("content-type")) headers.set("content-type", serialized.contentType);
  if (!["GET", "HEAD"].includes(method) && !headers.has("idempotency-key")) headers.set("idempotency-key", `xge_${cap.execution_id}`);
  headers.set("x-xguard-egress-capability", parsed.id);

  const started = Date.now();
  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : serialized.data,
      redirect: "manual",
    });
    await meterStub(env).fetch("https://meter/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billed_credits: units, upstream_status: upstream.status, latency_ms: Date.now() - started, ambiguous: false }),
    }).catch(() => null);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("server");
    responseHeaders.set("x-xguard-egress", VERSION);
    responseHeaders.set("x-xguard-egress-capability", parsed.id);
    responseHeaders.set("x-xguard-billed-credits", String(units));
    responseHeaders.set("x-xguard-upstream-status", String(upstream.status));
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (error) {
    await meterStub(env).fetch("https://meter/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billed_credits: units, latency_ms: Date.now() - started, ambiguous: true }),
    }).catch(() => null);
    return json({ error: "egress_outcome_ambiguous", message: "XGuard billed the authorized egress attempt before releasing the credential. The network outcome is unknown and XGuard will not replay it automatically.", execution_id: cap.execution_id }, 503, { "x-xguard-egress-state": "ambiguous" });
  }
}

export class EgressKeyAuthority {
  constructor(state) { this.state = state; }

  async keys() {
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
    if (path === "/encrypt" && request.method === "POST") {
      const body = await request.json();
      const plaintext = String(body?.plaintext || "");
      if (!plaintext || enc.encode(plaintext).byteLength > MAX_SECRET_BYTES) return json({ error: "invalid_plaintext" }, 400);
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
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      if (await this.state.storage.get("record")) return json({ error: "credential_exists" }, 409);
      const record = await request.json();
      await this.state.storage.put("record", record);
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
        const target = safeTarget(body?.target);
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
  constructor(state) { this.state = state; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      if (await this.state.storage.get("record")) return json({ error: "capability_exists" }, 409);
      const record = await request.json();
      await this.state.storage.put("record", record);
      return json({ ok: true }, 201);
    }
    const record = await this.state.storage.get("record");
    if (!record) return json({ error: "capability_not_found" }, 404);
    if (path === "/begin" && request.method === "POST") {
      const body = await request.json();
      if (await sha256(body?.token || "") !== record.token_hash) return json({ error: "invalid_capability" }, 403);
      const target = safeTarget(body?.target);
      const method = String(body?.method || "GET").toUpperCase();
      if (!target || target.origin !== record.target_origin || !target.pathname.startsWith(record.path_prefix) || !record.allowed_methods.includes(method)) return json({ error: "capability_scope_denied" }, 403);
      let result;
      await this.state.storage.transaction(async txn => {
        const current = await txn.get("record");
        if (current.revoked) { result = { status: 403, body: { error: "capability_revoked" } }; return; }
        if (Date.now() >= Date.parse(current.expires_at)) { result = { status: 410, body: { error: "capability_expired" } }; return; }
        if (current.used_calls >= current.max_calls) { result = { status: 409, body: { error: "capability_exhausted" } }; return; }
        current.used_calls += 1;
        current.last_used_at = new Date().toISOString();
        await txn.put("record", current);
        result = { status: 200, body: { credential_id: current.credential_id, owner_hash: current.owner_hash, billing_envelope: current.billing_envelope, execution_id: `xge_${randomHex()}`, used_calls: current.used_calls, max_calls: current.max_calls } };
      });
      return json(result.body, result.status);
    }
    return json({ error: "not_found" }, 404);
  }
}

export class EgressMeter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
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

export const __test = { providerPolicy, targetAllowed, parseCapabilityToken, safeTarget, sanitizeHeaders };

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
      return json({ providers: Object.fromEntries(Object.entries(PROVIDERS).map(([name, value]) => [name, { hosts: value.hosts, injection_header: value.header }])).constructor ? undefined : undefined });
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
    if (path === "/v1/egress/fetch" && request.method === "POST") return egressFetch(request, env);
    if (path === "/v1/egress/pricing" && request.method === "GET") return json({ credits_per_authorized_egress_attempt: egressCredits(env), billing_boundary: "XGuard Usage Credits are consumed before credential release and before outbound network egress.", failed_billing: "no upstream request is sent", upstream_failure_after_billing: "the egress attempt remains billed; XGuard never auto-replays an ambiguous attempt", checkout_url: env.XGUARD_CHECKOUT_URL || null });
    if (path === "/v1/egress/stats" && request.method === "GET") return meterStub(env).fetch("https://meter/stats");
    return null;
  },
};
