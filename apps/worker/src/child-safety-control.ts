import { childSafetyMediaResponse } from "./child-safety-media.js";
import { childSafetyResponse } from "./child-safety.js";
import { authenticateMerchant } from "./mainnet-billing.js";

const SESSION_COOKIE = "xg_child_safety_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const ID_MAX = 256;

interface ChildSafetyControlEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

interface MerchantIdentity {
  merchantId: string;
  name: string;
}

interface TraceInput {
  eventId?: string;
  actorId?: string;
  targetId?: string;
}

interface SummaryRow {
  total_scans: number;
  critical_scans: number;
  high_scans: number;
  blocked_scans: number;
  frozen_scans: number;
  earned_micro_usd: number;
}

interface DashboardSummary {
  windowHours: number;
  totalScans: number;
  criticalScans: number;
  highScans: number;
  blockedScans: number;
  frozenScans: number;
  earnedMicroUsd: number;
  earnedUsd: string;
}

interface RiskActorRow {
  actor_hash: string;
  high_risk_events: number;
  unique_targets: number;
  last_seen: string;
}

interface RecentScanRow {
  external_event_id: string;
  content_kind: string;
  risk_level: string;
  action: string;
  categories_json: string;
  actor_hash: string | null;
  target_hash: string | null;
  fee_micro_usd: number;
  created_at: string;
}

export async function childSafetyControlResponse(
  request: Request,
  env: ChildSafetyControlEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/child-safety/dashboard") {
    if (request.method !== "GET") return methodNotAllowed();
    return dashboardPage(request, env);
  }

  if (url.pathname === "/child-safety/dashboard/login") {
    if (request.method !== "POST") return methodNotAllowed();
    return dashboardLogin(request, env);
  }

  if (url.pathname === "/child-safety/dashboard/logout") {
    if (request.method !== "POST") return methodNotAllowed();
    return dashboardLogout(request, env);
  }

  if (url.pathname === "/v1/child-safety/dashboard/summary") {
    if (request.method !== "GET") return methodNotAllowed();
    const merchant = await authenticateRequest(request, env.DB);
    if (merchant === null) return json({ error: "unauthorized" }, 401);
    return json(await dashboardSummary(env.DB, merchant.merchantId, 24));
  }

  if (url.pathname === "/v1/child-safety/dashboard/recent") {
    if (request.method !== "GET") return methodNotAllowed();
    const merchant = await authenticateRequest(request, env.DB);
    if (merchant === null) return json({ error: "unauthorized" }, 401);
    return json({ recent: await recentScans(env.DB, merchant.merchantId, 50) });
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/v1/child-safety/scan" ||
      url.pathname.startsWith("/v1/child-safety/media/"))
  ) {
    return trackedScan(request, env);
  }

  const media = await childSafetyMediaResponse(request, env);
  if (media !== null) return media;
  return childSafetyResponse(request, env);
}

async function trackedScan(
  request: Request,
  env: ChildSafetyControlEnv,
): Promise<Response> {
  const input = await readTraceInput(request.clone() as unknown as Request);
  const url = new URL(request.url);

  const response = url.pathname.startsWith("/v1/child-safety/media/")
    ? await childSafetyMediaResponse(request.clone() as unknown as Request, env)
    : await childSafetyResponse(request.clone() as unknown as Request, env);

  if (response === null) return json({ error: "scan_route_unavailable" }, 404);
  if (!response.ok) return response;

  const actorId = boundedId(input.actorId);
  const targetId = boundedId(input.targetId);
  if (!actorId && !targetId) return response;

  const merchant = await authenticateRequest(request, env.DB);
  if (merchant === null) return response;

  const responseBody: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const eventId =
    responseBody &&
    typeof responseBody === "object" &&
    !Array.isArray(responseBody)
      ? clean((responseBody as Record<string, unknown>).eventId, 160)
      : clean(input.eventId, 160);
  if (!eventId) return response;

  const actorHash = actorId ? await sha256(actorId) : "";
  const targetHash = targetId ? await sha256(targetId) : "";
  await env.DB.prepare(
    "UPDATE child_safety_scans SET actor_hash=CASE WHEN ?<>'' THEN ? ELSE actor_hash END,target_hash=CASE WHEN ?<>'' THEN ? ELSE target_hash END WHERE merchant_id=? AND external_event_id=?",
  )
    .bind(
      actorHash,
      actorHash,
      targetHash,
      targetHash,
      merchant.merchantId,
      eventId,
    )
    .run();

  if (
    !actorHash ||
    !responseBody ||
    typeof responseBody !== "object" ||
    Array.isArray(responseBody)
  ) {
    return response;
  }

  const pattern = await actorRiskPattern(
    env.DB,
    merchant.merchantId,
    actorHash,
  );
  return json({
    ...(responseBody as Record<string, unknown>),
    actorTracking: {
      rawActorIdStored: false,
      rawTargetIdStored: false,
      highRiskEvents30d: pattern.highRiskEvents,
      uniqueTargets30d: pattern.uniqueTargets,
      repeatRiskFlag: pattern.highRiskEvents >= 3 && pattern.uniqueTargets >= 2,
      humanReviewRecommended:
        pattern.highRiskEvents >= 3 && pattern.uniqueTargets >= 2,
    },
  });
}

async function dashboardLogin(
  request: Request,
  env: ChildSafetyControlEnv,
): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const apiKey = clean(form?.get("apiKey"), 256);
  if (!apiKey) return dashboardLoginPage("API key is required.", 400);

  const merchant = await authenticateMerchant(env.DB, apiKey);
  if (merchant === null) return dashboardLoginPage("Invalid API key.", 401);

  const token = randomToken(32);
  const hash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    "DELETE FROM child_safety_dashboard_sessions WHERE expires_at_epoch<?",
  )
    .bind(now)
    .run();
  await env.DB.prepare(
    "INSERT INTO child_safety_dashboard_sessions(session_hash,merchant_id,expires_at_epoch,created_at) VALUES(?,?,?,?)",
  )
    .bind(hash, merchant.merchantId, expires, new Date().toISOString())
    .run();

  return new Response(null, {
    status: 303,
    headers: {
      Location: "/child-safety/dashboard",
      "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/child-safety/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`,
      "Cache-Control": "no-store",
    },
  });
}

async function dashboardLogout(
  request: Request,
  env: ChildSafetyControlEnv,
): Promise<Response> {
  const token = cookieValue(
    request.headers.get("cookie") ?? "",
    SESSION_COOKIE,
  );
  if (token) {
    const hash = await sha256(token);
    await env.DB.prepare(
      "DELETE FROM child_safety_dashboard_sessions WHERE session_hash=?",
    )
      .bind(hash)
      .run();
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/child-safety/dashboard",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/child-safety/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      "Cache-Control": "no-store",
    },
  });
}

async function dashboardPage(
  request: Request,
  env: ChildSafetyControlEnv,
): Promise<Response> {
  const merchant = await dashboardMerchant(request, env.DB);
  if (merchant === null) return dashboardLoginPage();

  const summary = await dashboardSummary(env.DB, merchant.merchantId, 24);
  const recent = await recentScans(env.DB, merchant.merchantId, 25);
  const actors = await topRiskActors(env.DB, merchant.merchantId, 10);

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>XGuard Child Safety Dashboard</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#f8fafc;background:#07111f}*{box-sizing:border-box}body{margin:0;background:linear-gradient(160deg,#07111f,#0b1729 55%,#101927);min-height:100vh}.wrap{max-width:1180px;margin:auto;padding:28px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:24px;font-weight:800}.sub{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:28px 0}.card,.panel{border:1px solid #243246;background:#0d1929;border-radius:16px;padding:18px}.metric{font-size:30px;font-weight:800;margin-top:8px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}.danger{color:#fb7185}.warn{color:#fbbf24}.ok{color:#34d399}.panels{display:grid;grid-template-columns:1.25fr .75fr;gap:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #1f2c3d}th{color:#94a3b8;font-weight:600}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#17263a;font-size:11px}.btn{border:1px solid #334155;background:#101d30;color:#fff;border-radius:10px;padding:9px 12px;cursor:pointer}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.panels{grid-template-columns:1fr}.wrap{padding:18px}}
</style>
</head>
<body><main class="wrap">
<div class="top"><div><div class="brand">XGuard Child Safety</div><div class="sub">${escapeHtml(merchant.name)} · last 24 hours</div></div><form method="post" action="/child-safety/dashboard/logout"><button class="btn">Sign out</button></form></div>
<section class="grid">
${metric("Scans", summary.totalScans, "")}
${metric("Critical", summary.criticalScans, "danger")}
${metric("High", summary.highScans, "warn")}
${metric("Blocked", summary.blockedScans, "warn")}
${metric("Frozen chats", summary.frozenScans, "danger")}
${metric("Gross revenue", `$${summary.earnedUsd}`, "ok")}
</section>
<section class="panels">
<div class="panel"><h2>Recent safety decisions</h2><table><thead><tr><th>Time</th><th>Kind</th><th>Risk</th><th>Action</th><th>Categories</th></tr></thead><tbody>${recent.map(recentRowHtml).join("") || `<tr><td colspan="5" class="sub">No scans yet.</td></tr>`}</tbody></table></div>
<div class="panel"><h2>Repeat-risk actors</h2><div class="sub">Pseudonymous hashes only. Raw account IDs are not stored.</div><table><thead><tr><th>Actor</th><th>High risk</th><th>Targets</th></tr></thead><tbody>${actors.map(actorRowHtml).join("") || `<tr><td colspan="3" class="sub">No repeat-risk actors.</td></tr>`}</tbody></table></div>
</section>
</main></body></html>`);
}

function dashboardLoginPage(message = "", status = 200): Response {
  return html(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Child Safety Dashboard</title><style>body{margin:0;background:#07111f;color:#f8fafc;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(430px,calc(100% - 32px));padding:28px;background:#0d1929;border:1px solid #243246;border-radius:18px}h1{margin-top:0}label{display:block;color:#94a3b8;margin-bottom:8px}input{width:100%;padding:13px;border-radius:10px;border:1px solid #334155;background:#07111f;color:#fff}button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#f8fafc;color:#07111f;font-weight:800}.error{color:#fb7185;margin-bottom:12px}.note{font-size:12px;color:#94a3b8;margin-top:12px}</style></head><body><form class="box" method="post" action="/child-safety/dashboard/login"><h1>XGuard Child Safety</h1><p>Merchant operations dashboard</p>${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}<label>Merchant API key</label><input type="password" name="apiKey" autocomplete="off" required><button type="submit">Open dashboard</button><div class="note">The API key is exchanged for a short-lived HttpOnly dashboard session and is not stored in browser storage.</div></form></body></html>`,
    status,
  );
}

async function dashboardSummary(
  db: D1Database,
  merchantId: string,
  hours: number,
): Promise<DashboardSummary> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS total_scans,SUM(CASE WHEN risk_level='CRITICAL' THEN 1 ELSE 0 END) AS critical_scans,SUM(CASE WHEN risk_level='HIGH' THEN 1 ELSE 0 END) AS high_scans,SUM(CASE WHEN action='BLOCK' THEN 1 ELSE 0 END) AS blocked_scans,SUM(CASE WHEN action='FREEZE_CHAT' THEN 1 ELSE 0 END) AS frozen_scans,COALESCE(SUM(fee_micro_usd),0) AS earned_micro_usd FROM child_safety_scans WHERE merchant_id=? AND created_at>=?",
    )
    .bind(merchantId, since)
    .first<SummaryRow>();
  const totalScans = numeric(row?.total_scans);
  const criticalScans = numeric(row?.critical_scans);
  const highScans = numeric(row?.high_scans);
  const blockedScans = numeric(row?.blocked_scans);
  const frozenScans = numeric(row?.frozen_scans);
  const earnedMicroUsd = numeric(row?.earned_micro_usd);
  return {
    windowHours: hours,
    totalScans,
    criticalScans,
    highScans,
    blockedScans,
    frozenScans,
    earnedMicroUsd,
    earnedUsd: (earnedMicroUsd / 1_000_000).toFixed(3),
  };
}

async function recentScans(
  db: D1Database,
  merchantId: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      "SELECT external_event_id,content_kind,risk_level,action,categories_json,actor_hash,target_hash,fee_micro_usd,created_at FROM child_safety_scans WHERE merchant_id=? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(merchantId, Math.min(100, Math.max(1, limit)))
    .all<RecentScanRow>();
  return (result.results ?? []).map((row) => ({
    eventId: row.external_event_id,
    contentKind: row.content_kind,
    riskLevel: row.risk_level,
    action: row.action,
    categories: safeJsonArray(row.categories_json),
    actorHash: shortHash(row.actor_hash),
    targetHash: shortHash(row.target_hash),
    feeUsd: (numeric(row.fee_micro_usd) / 1_000_000).toFixed(3),
    createdAt: row.created_at,
  }));
}

async function topRiskActors(
  db: D1Database,
  merchantId: string,
  limit: number,
): Promise<RiskActorRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .prepare(
      "SELECT actor_hash,COUNT(*) AS high_risk_events,COUNT(DISTINCT target_hash) AS unique_targets,MAX(created_at) AS last_seen FROM child_safety_scans WHERE merchant_id=? AND actor_hash IS NOT NULL AND actor_hash<>'' AND risk_level IN ('HIGH','CRITICAL') AND created_at>=? GROUP BY actor_hash ORDER BY high_risk_events DESC,unique_targets DESC LIMIT ?",
    )
    .bind(merchantId, since, Math.min(50, Math.max(1, limit)))
    .all<RiskActorRow>();
  return result.results ?? [];
}

async function actorRiskPattern(
  db: D1Database,
  merchantId: string,
  actorHash: string,
): Promise<{ highRiskEvents: number; uniqueTargets: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS high_risk_events,COUNT(DISTINCT target_hash) AS unique_targets FROM child_safety_scans WHERE merchant_id=? AND actor_hash=? AND risk_level IN ('HIGH','CRITICAL') AND created_at>=?",
    )
    .bind(merchantId, actorHash, since)
    .first<{ high_risk_events: number; unique_targets: number }>();
  return {
    highRiskEvents: numeric(row?.high_risk_events),
    uniqueTargets: numeric(row?.unique_targets),
  };
}

async function dashboardMerchant(
  request: Request,
  db: D1Database,
): Promise<MerchantIdentity | null> {
  const token = cookieValue(
    request.headers.get("cookie") ?? "",
    SESSION_COOKIE,
  );
  if (!token) return null;
  const hash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "DELETE FROM child_safety_dashboard_sessions WHERE expires_at_epoch<?",
    )
    .bind(now)
    .run();
  const row = await db
    .prepare(
      "SELECT m.merchant_id,m.name FROM child_safety_dashboard_sessions s JOIN merchants m ON m.merchant_id=s.merchant_id WHERE s.session_hash=? AND s.expires_at_epoch>=? AND m.active=1",
    )
    .bind(hash, now)
    .first<{ merchant_id: string; name: string }>();
  return row === null ? null : { merchantId: row.merchant_id, name: row.name };
}

async function authenticateRequest(
  request: Request,
  db: D1Database,
): Promise<MerchantIdentity | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return null;
  const token = authorization.slice(prefix.length).trim();
  if (!token) return null;
  return authenticateMerchant(db, token);
}

async function readTraceInput(request: Request): Promise<TraceInput> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as TraceInput)
      : {};
  } catch {
    return {};
  }
}

function boundedId(value: unknown): string {
  const id = clean(value, ID_MAX);
  return id.length >= 1 ? id : "";
}

function cookieValue(cookie: string, name: string): string {
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    if (trimmed.slice(0, index) === name) return trimmed.slice(index + 1);
  }
  return "";
}

function randomToken(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function shortHash(value: string | null): string | null {
  return value ? `${value.slice(0, 12)}…` : null;
}

function numeric(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function recentRowHtml(row: Record<string, unknown>): string {
  const categories = Array.isArray(row.categories)
    ? row.categories.join(", ")
    : "";
  return `<tr><td>${escapeHtml(String(row.createdAt ?? ""))}</td><td>${escapeHtml(String(row.contentKind ?? ""))}</td><td><span class="pill">${escapeHtml(String(row.riskLevel ?? ""))}</span></td><td>${escapeHtml(String(row.action ?? ""))}</td><td>${escapeHtml(categories)}</td></tr>`;
}

function actorRowHtml(row: RiskActorRow): string {
  const flagged =
    numeric(row.high_risk_events) >= 3 && numeric(row.unique_targets) >= 2;
  return `<tr><td>${escapeHtml(`${row.actor_hash.slice(0, 12)}…`)}${flagged ? ` <span class="pill danger">repeat risk</span>` : ""}</td><td>${numeric(row.high_risk_events)}</td><td>${numeric(row.unique_targets)}</td></tr>`;
}

function metric(
  label: string,
  value: string | number,
  className: string,
): string {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="metric ${className}">${escapeHtml(String(value))}</div></div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed" }, 405);
}

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: apiHeaders() });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
