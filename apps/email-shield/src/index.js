import { verifyEmail } from "./verifier.js";
import { docsHtml, openApi, privacyHtml, siteHtml } from "./site.js";

const VERSION = "3.0.0";
const PRODUCT = "XGuard Email Shield";
const FREE_CREDITS = 100;
const MAX_BATCH = 100;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = crypto.randomUUID();
    try {
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), id);
      if (request.method === "GET" && url.pathname === "/") return html(siteHtml(), id);
      if (request.method === "GET" && url.pathname === "/docs") return html(docsHtml(), id);
      if (request.method === "GET" && url.pathname === "/privacy") return html(privacyHtml(), id);
      if (request.method === "GET" && url.pathname === "/healthz") return json({ status: "ok", service: PRODUCT, version: VERSION }, 200, id);
      if (request.method === "GET" && url.pathname === "/v1/status") return status(env, id);
      if (request.method === "GET" && url.pathname === "/openapi.json") return json(openApi(url.origin), 200, id);
      if (request.method === "POST" && url.pathname === "/v1/keys/free") return freeKey(request, env, id);
      if (request.method === "POST" && url.pathname === "/v1/verify") return one(request, env, ctx, id);
      if (request.method === "POST" && url.pathname === "/v1/verify/batch") return batch(request, env, ctx, id);
      if (request.method === "GET" && url.pathname === "/v1/usage") return usage(request, env, id);
      return json({ error: "not_found" }, 404, id);
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", requestId: id, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
      return json({ error: "internal_error", requestId: id }, 500, id);
    }
  }
};

async function status(env, id) {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ service: PRODUCT, status: "operational", version: VERSION, verification: ["syntax","dns_mx","null_mx","disposable","role","typo"], mailboxProbe: env.MAILBOX_VERIFY_URL ? "upstream_enabled" : "not_enabled" }, 200, id);
  } catch { return json({ service: PRODUCT, status: "degraded", version: VERSION }, 503, id); }
}

async function freeKey(request, env, id) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const claim = await sha256(`${day}:${ip}`);
  if (await env.DB.prepare("SELECT 1 FROM free_key_claims WHERE claim_hash=?").bind(claim).first()) return json({ error: "free_key_already_claimed_today" }, 409, id);
  const raw = `xg_live_${token(32)}`;
  const hash = await sha256(raw);
  const prefix = raw.slice(0, 16);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO api_keys(key_hash,key_prefix,credits_remaining,active,created_at) VALUES(?,?,?,?,?)").bind(hash, prefix, FREE_CREDITS, 1, now),
      env.DB.prepare("INSERT INTO free_key_claims(claim_hash,key_prefix,claimed_at) VALUES(?,?,?)").bind(claim, prefix, now)
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return json({ error: "free_key_already_claimed_today" }, 409, id);
    throw error;
  }
  return json({ apiKey: raw, credits: FREE_CREDITS, prefix, warning: "Store this key now. XGuard stores only its hash." }, 201, id);
}

async function charge(request, env, units) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { error: "missing_api_key", status: 401 };
  const raw = auth.slice(7).trim();
  if (!/^xg_live_[A-Za-z0-9_-]{40,60}$/.test(raw)) return { error: "invalid_api_key", status: 401 };
  const hash = await sha256(raw);
  const row = await env.DB.prepare("UPDATE api_keys SET credits_remaining=credits_remaining-?,checks_total=checks_total+?,last_used_at=? WHERE key_hash=? AND active=1 AND credits_remaining>=? RETURNING key_prefix,credits_remaining").bind(units, units, new Date().toISOString(), hash, units).first();
  if (row) return { prefix: row.key_prefix, remaining: Number(row.credits_remaining) };
  const exists = await env.DB.prepare("SELECT active,credits_remaining FROM api_keys WHERE key_hash=?").bind(hash).first();
  if (!exists || Number(exists.active) !== 1) return { error: "invalid_api_key", status: 401 };
  return { error: "insufficient_credits", status: 402 };
}

async function one(request, env, ctx, id) {
  const body = await readJson(request, 8192);
  if (!body || typeof body.email !== "string") return json({ error: "email_required" }, 400, id);
  const auth = await charge(request, env, 1);
  if (auth.error) return json({ error: auth.error }, auth.status, id);
  const result = await verifyEmail(body.email, env);
  ctx.waitUntil(record(env, auth.prefix, 1, result.decision === "reject" ? 1 : 0));
  return json({ ...result, creditsRemaining: auth.remaining }, 200, id);
}
async function batch(request, env, ctx, id) {
  const body = await readJson(request, 65536);
  if (!body || !Array.isArray(body.emails)) return json({ error: "emails_array_required" }, 400, id);
  if (body.emails.length < 1 || body.emails.length > MAX_BATCH || body.emails.some((x) => typeof x !== "string")) return json({ error: "batch_size_must_be_1_to_100" }, 400, id);
  const auth = await charge(request, env, body.emails.length);
  if (auth.error) return json({ error: auth.error }, auth.status, id);
  const results = [];
  for (let i = 0; i < body.emails.length; i += 10) results.push(...await Promise.all(body.emails.slice(i, i + 10).map((x) => verifyEmail(x, env))));
  const rejected = results.filter((x) => x.decision === "reject").length;
  ctx.waitUntil(record(env, auth.prefix, results.length, rejected));
  return json({ results, count: results.length, creditsRemaining: auth.remaining }, 200, id);
}
async function usage(request, env, id) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "missing_api_key" }, 401, id);
  const row = await env.DB.prepare("SELECT key_prefix,credits_remaining,checks_total,active,created_at,last_used_at FROM api_keys WHERE key_hash=?").bind(await sha256(auth.slice(7).trim())).first();
  if (!row || Number(row.active) !== 1) return json({ error: "invalid_api_key" }, 401, id);
  return json({ keyPrefix: row.key_prefix, creditsRemaining: Number(row.credits_remaining), checksTotal: Number(row.checks_total), createdAt: row.created_at, lastUsedAt: row.last_used_at }, 200, id);
}
async function record(env, prefix, checks, rejected) {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO usage_daily(key_prefix,day,checks,rejected) VALUES(?,?,?,?) ON CONFLICT(key_prefix,day) DO UPDATE SET checks=checks+excluded.checks,rejected=rejected+excluded.rejected").bind(prefix, day, checks, rejected).run();
}

async function readJson(request, max) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > max || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch { return null; } finally { reader.releaseLock(); }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function token(bytes) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function json(body, status, id) { return cors(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }), id); }
function html(body, id) { return cors(new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' https://api.xguardgate.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'" } }), id); }
function cors(response, id) { const h = new Headers(response.headers); h.set("Access-Control-Allow-Origin", "*"); h.set("Access-Control-Allow-Headers", "Authorization, Content-Type"); h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); h.set("X-Request-ID", id); h.set("Referrer-Policy", "no-referrer"); h.set("X-Frame-Options", "DENY"); return new Response(response.body, { status: response.status, headers: h }); }
