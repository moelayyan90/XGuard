import { safeGenericHttpsTarget } from "./generic-http-connector.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";

const ROUTES_PATH = "/v1/webhooks/routes";
const EVENTS_PATH = "/v1/webhooks/events/";
const INGRESS_PATH = "/v1/webhooks/in/";
const MAX_MANAGEMENT_BODY_BYTES = 16 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const TOKEN_BYTES = 32;
const MAX_FORWARD_HEADER_VALUE_BYTES = 16 * 1024;

const SIGNATURE_HEADERS = [
  "stripe-signature",
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
  "x-square-hmacsha256-signature",
  "x-shopify-hmac-sha256",
  "x-wc-webhook-signature",
  "x-cc-webhook-signature",
  "webhook-signature",
  "signature",
  "signature-input",
] as const;

const BLOCKED_FORWARD_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface UniversalWebhookEnv {
  DB: D1Database;
}

interface WebhookRouteRow {
  route_id: string;
  merchant_id: string;
  provider: string;
  label: string | null;
  destination_url: string;
  active: number;
  created_at: string;
  updated_at: string;
  last_event_at: string | null;
}

interface WebhookIngressRouteRow extends WebhookRouteRow {
  token_sha256: string;
}

interface WebhookEventRow {
  event_id: string;
  route_id: string;
  merchant_id: string;
  provider: string;
  received_at: string;
  body_sha256: string;
  body_bytes: number;
  content_type: string | null;
  signature_header_names_json: string;
  signature_evidence_sha256: string | null;
  delivery_state: string;
  destination_status: number | null;
  destination_latency_ms: number | null;
  delivered_at: string | null;
}

export async function universalWebhookResponse(
  request: Request,
  env: UniversalWebhookEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === ROUTES_PATH) {
    if (request.method === "POST") return createWebhookRoute(request, env);
    if (request.method === "GET") return listWebhookRoutes(request, env);
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      Allow: "GET, POST",
    });
  }

  if (url.pathname.startsWith(`${ROUTES_PATH}/`)) {
    const routeId = decodePathSegment(
      url.pathname.slice(ROUTES_PATH.length + 1),
    );
    if (routeId === null)
      return jsonResponse({ error: "invalid_route_id" }, 400);
    if (request.method === "DELETE")
      return deactivateWebhookRoute(request, env, routeId);
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      Allow: "DELETE",
    });
  }

  if (url.pathname.startsWith(EVENTS_PATH)) {
    const eventId = decodePathSegment(url.pathname.slice(EVENTS_PATH.length));
    if (eventId === null)
      return jsonResponse({ error: "invalid_event_id" }, 400);
    if (request.method === "GET")
      return readWebhookEvent(request, env, eventId);
    return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }

  if (url.pathname.startsWith(INGRESS_PATH)) {
    const token = decodePathSegment(url.pathname.slice(INGRESS_PATH.length));
    if (token === null || !validIngressToken(token))
      return jsonResponse({ error: "webhook_route_not_found" }, 404);
    if (request.method !== "POST")
      return jsonResponse({ error: "method_not_allowed" }, 405, {
        Allow: "POST",
      });
    return ingestWebhook(request, env, token);
  }

  return null;
}

async function createWebhookRoute(
  request: Request,
  env: UniversalWebhookEnv,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = await boundedJsonObject(request, MAX_MANAGEMENT_BODY_BYTES);
  } catch (error) {
    return jsonResponse({ error: errorCode(error) }, 400);
  }

  const provider = normalizeProvider(body.provider);
  if (provider === null)
    return jsonResponse({ error: "invalid_webhook_provider" }, 400);

  const rawDestination =
    typeof body.destinationUrl === "string" ? body.destinationUrl.trim() : "";
  const destination = safeGenericHttpsTarget(rawDestination);
  if (destination === null)
    return jsonResponse({ error: "unsafe_or_invalid_destination_url" }, 400);

  const label = normalizeLabel(body.label);
  const token = randomIngressToken();
  const tokenHash = await sha256Hex(new TextEncoder().encode(token));
  const routeId = `whr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO universal_webhook_routes(
       route_id, merchant_id, provider, label, token_sha256, destination_url,
       active, created_at, updated_at
     ) VALUES(?,?,?,?,?,?,1,?,?)`,
  )
    .bind(
      routeId,
      access.merchant.merchantId,
      provider,
      label,
      tokenHash,
      destination.toString(),
      now,
      now,
    )
    .run();

  const origin = new URL(request.url).origin;
  return jsonResponse(
    {
      routeId,
      provider,
      label,
      destinationUrl: destination.toString(),
      webhookUrl: `${origin}${INGRESS_PATH}${token}`,
      active: true,
      transport: "universal-webhook-ingress",
      x402Required: false,
      warning:
        "The webhook URL contains a high-entropy route token and is shown only now. Store it in the provider dashboard as the webhook destination.",
    },
    201,
  );
}

async function listWebhookRoutes(
  request: Request,
  env: UniversalWebhookEnv,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  const rows = await env.DB.prepare(
    `SELECT route_id, merchant_id, provider, label, destination_url, active,
            created_at, updated_at, last_event_at
       FROM universal_webhook_routes
      WHERE merchant_id=?
      ORDER BY created_at DESC
      LIMIT 200`,
  )
    .bind(access.merchant.merchantId)
    .all<WebhookRouteRow>();

  return jsonResponse({
    routes: (rows.results ?? []).map(publicRoute),
    x402Required: false,
  });
}

async function deactivateWebhookRoute(
  request: Request,
  env: UniversalWebhookEnv,
  routeId: string,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  const result = await env.DB.prepare(
    `UPDATE universal_webhook_routes
        SET active=0, updated_at=?
      WHERE route_id=? AND merchant_id=? AND active=1`,
  )
    .bind(new Date().toISOString(), routeId, access.merchant.merchantId)
    .run();

  if ((result.meta.changes ?? 0) === 0)
    return jsonResponse({ error: "webhook_route_not_found" }, 404);
  return jsonResponse({ routeId, active: false });
}

async function readWebhookEvent(
  request: Request,
  env: UniversalWebhookEnv,
  eventId: string,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  const row = await env.DB.prepare(
    `SELECT event_id, route_id, merchant_id, provider, received_at, body_sha256,
            body_bytes, content_type, signature_header_names_json,
            signature_evidence_sha256, delivery_state, destination_status,
            destination_latency_ms, delivered_at
       FROM universal_webhook_events
      WHERE event_id=? AND merchant_id=?`,
  )
    .bind(eventId, access.merchant.merchantId)
    .first<WebhookEventRow>();

  if (row === null)
    return jsonResponse({ error: "webhook_event_not_found" }, 404);

  return jsonResponse({
    eventId: row.event_id,
    routeId: row.route_id,
    provider: row.provider,
    receivedAt: row.received_at,
    bodySha256: row.body_sha256,
    bodyBytes: row.body_bytes,
    contentType: row.content_type,
    signatureHeaderNames: parseStringArray(row.signature_header_names_json),
    signatureEvidenceSha256: row.signature_evidence_sha256,
    deliveryState: row.delivery_state,
    destinationStatus: row.destination_status,
    destinationLatencyMs: row.destination_latency_ms,
    deliveredAt: row.delivered_at,
    rawBodyStored: false,
    x402Required: false,
  });
}

async function ingestWebhook(
  request: Request,
  env: UniversalWebhookEnv,
  token: string,
): Promise<Response> {
  const tokenHash = await sha256Hex(new TextEncoder().encode(token));
  const route = await env.DB.prepare(
    `SELECT route_id, merchant_id, provider, label, token_sha256, destination_url,
            active, created_at, updated_at, last_event_at
       FROM universal_webhook_routes
      WHERE token_sha256=? AND active=1`,
  )
    .bind(tokenHash)
    .first<WebhookIngressRouteRow>();

  if (route === null)
    return jsonResponse({ error: "webhook_route_not_found" }, 404);

  let body: ArrayBuffer;
  try {
    body = await boundedWebhookBody(request);
  } catch (error) {
    return jsonResponse({ error: errorCode(error) }, 413);
  }

  const destination = safeGenericHttpsTarget(route.destination_url);
  if (destination === null) {
    await deactivateBrokenRoute(env.DB, route.route_id);
    return jsonResponse({ error: "webhook_route_destination_invalid" }, 503);
  }

  const receivedAt = new Date().toISOString();
  const bodySha256 = await sha256Hex(new Uint8Array(body));
  const signatureEvidence = await signatureEvidenceFor(request.headers);
  const eventId = `whe_${crypto.randomUUID()}`;
  const contentType =
    request.headers.get("content-type")?.slice(0, 256) ?? null;

  await env.DB.prepare(
    `INSERT INTO universal_webhook_events(
       event_id, route_id, merchant_id, provider, received_at, body_sha256,
       body_bytes, content_type, signature_header_names_json,
       signature_evidence_sha256, delivery_state
     ) VALUES(?,?,?,?,?,?,?,?,?,?, 'RECEIVED')`,
  )
    .bind(
      eventId,
      route.route_id,
      route.merchant_id,
      route.provider,
      receivedAt,
      bodySha256,
      body.byteLength,
      contentType,
      JSON.stringify(signatureEvidence.names),
      signatureEvidence.sha256,
    )
    .run();

  await env.DB.prepare(
    `UPDATE universal_webhook_routes
        SET last_event_at=?, updated_at=?
      WHERE route_id=?`,
  )
    .bind(receivedAt, receivedAt, route.route_id)
    .run();

  const headers = forwardHeaders(request.headers);
  headers.set("x-xguard-event-id", eventId);
  headers.set("x-xguard-route-id", route.route_id);
  headers.set("x-xguard-provider", route.provider);
  headers.set("x-xguard-body-sha256", bodySha256);
  headers.set("x-xguard-received-at", receivedAt);

  const started = Date.now();
  let destinationResponse: Response;
  try {
    destinationResponse = await fetch(
      new Request(destination.toString(), {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      }),
    );
  } catch {
    await updateDeliveryState(
      env.DB,
      eventId,
      "DELIVERY_FAILED",
      null,
      Date.now() - started,
    );
    return jsonResponse(
      {
        error: "webhook_destination_unavailable",
        eventId,
        acceptedByXGuard: true,
      },
      502,
    );
  }

  const latencyMs = Math.max(0, Date.now() - started);
  const status = destinationResponse.status;
  await destinationResponse.body?.cancel().catch(() => undefined);

  if (status < 200 || status >= 300) {
    await updateDeliveryState(
      env.DB,
      eventId,
      "DELIVERY_FAILED",
      status,
      latencyMs,
    );
    return jsonResponse(
      {
        error: "webhook_destination_rejected",
        eventId,
        destinationStatus: status,
        acceptedByXGuard: true,
      },
      502,
    );
  }

  await updateDeliveryState(env.DB, eventId, "DELIVERED", status, latencyMs);
  return jsonResponse({
    ok: true,
    eventId,
    provider: route.provider,
    bodySha256,
    delivered: true,
    x402Required: false,
  });
}

async function updateDeliveryState(
  db: D1Database,
  eventId: string,
  state: "DELIVERED" | "DELIVERY_FAILED",
  status: number | null,
  latencyMs: number,
): Promise<void> {
  const deliveredAt = state === "DELIVERED" ? new Date().toISOString() : null;
  await db
    .prepare(
      `UPDATE universal_webhook_events
          SET delivery_state=?, destination_status=?, destination_latency_ms=?, delivered_at=?
        WHERE event_id=?`,
    )
    .bind(state, status, latencyMs, deliveredAt, eventId)
    .run();
}

async function deactivateBrokenRoute(
  db: D1Database,
  routeId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      "UPDATE universal_webhook_routes SET active=0, updated_at=? WHERE route_id=?",
    )
    .bind(now, routeId)
    .run();
}

function publicRoute(row: WebhookRouteRow): Record<string, unknown> {
  return {
    routeId: row.route_id,
    provider: row.provider,
    label: row.label,
    destinationUrl: row.destination_url,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventAt: row.last_event_at,
  };
}

export function normalizeProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider)) return null;
  return provider;
}

function normalizeLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (label === "") return null;
  return label.slice(0, 120);
}

function validIngressToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function randomIngressToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function boundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error("request_body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("request_body_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
  if (!isRecord(parsed)) throw new Error("request_body_must_be_object");
  return parsed;
}

async function boundedWebhookBody(request: Request): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES)
    throw new Error("webhook_body_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_WEBHOOK_BODY_BYTES)
    throw new Error("webhook_body_too_large");
  return body;
}

export function forwardHeaders(incoming: Headers): Headers {
  const outgoing = new Headers();
  for (const [name, value] of incoming.entries()) {
    const lower = name.toLowerCase();
    if (BLOCKED_FORWARD_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-")) continue;
    if (lower.startsWith("x-forwarded-")) continue;
    if (lower.startsWith("x-xguard-")) continue;
    if (value.length > MAX_FORWARD_HEADER_VALUE_BYTES) continue;
    outgoing.set(lower, value);
  }
  return outgoing;
}

async function signatureEvidenceFor(headers: Headers): Promise<{
  names: string[];
  sha256: string | null;
}> {
  const entries: string[] = [];
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) entries.push(`${name}:${value}`);
  }
  if (entries.length === 0) return { names: [], sha256: null };
  entries.sort();
  return {
    names: entries.map((entry) => entry.slice(0, entry.indexOf(":"))),
    sha256: await sha256Hex(new TextEncoder().encode(entries.join("\n"))),
  };
}

async function sha256Hex(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodePathSegment(value: string): string | null {
  if (value === "" || value.includes("/")) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded === "" || decoded.includes("/")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "webhook_gateway_error";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
