import { strictPublicHttpsTarget } from "./universal-security-guard.js";

const INGRESS_PATH = "/v1/webhooks/in/";
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const CHUNK_BYTES = 96 * 1024;
const MAX_ATTEMPTS = 7;
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000];

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

interface ResilientWebhookEnv {
  DB: D1Database;
  WEBHOOK_DELIVERY_QUEUE: DurableObjectNamespace<WebhookDeliveryQueue>;
  WEBHOOK_RATE_LIMITER: RateLimit;
}

interface WebhookRouteRow {
  route_id: string;
  merchant_id: string;
  provider: string;
  destination_url: string;
}

interface QueueMeta {
  eventId: string;
  routeId: string;
  provider: string;
  destinationUrl: string;
  headers: Array<[string, string]>;
  bodyChunks: number;
  bodyBytes: number;
  attempt: number;
  deliveredUpstream: boolean;
  deliveredStatus: number | null;
  deliveredLatencyMs: number | null;
}

interface EnqueueInput {
  eventId: string;
  routeId: string;
  provider: string;
  destinationUrl: string;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
}

interface WebhookDeliveryEnv {
  DB: D1Database;
}

export async function resilientWebhookIngressResponse(
  request: Request,
  env: ResilientWebhookEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(INGRESS_PATH)) return null;

  const token = decodePathSegment(url.pathname.slice(INGRESS_PATH.length));
  if (token === null || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return jsonResponse({ error: "webhook_route_not_found" }, 404);
  if (request.method !== "POST")
    return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });

  const tokenHash = await sha256Hex(new TextEncoder().encode(token));
  try {
    const rate = await env.WEBHOOK_RATE_LIMITER.limit({
      key: `webhook:${tokenHash.slice(0, 32)}`,
    });
    if (!rate.success)
      return jsonResponse({ error: "webhook_rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch {
    return jsonResponse({ error: "webhook_protection_unavailable" }, 503, {
      "Retry-After": "5",
    });
  }

  const route = await env.DB.prepare(
    `SELECT route_id,merchant_id,provider,destination_url
       FROM universal_webhook_routes
      WHERE token_sha256=? AND active=1`,
  )
    .bind(tokenHash)
    .first<WebhookRouteRow>();

  if (route === null)
    return jsonResponse({ error: "webhook_route_not_found" }, 404);

  const destination = strictPublicHttpsTarget(route.destination_url);
  if (destination === null) {
    await env.DB.prepare(
      "UPDATE universal_webhook_routes SET active=0,updated_at=? WHERE route_id=?",
    )
      .bind(new Date().toISOString(), route.route_id)
      .run()
      .catch(() => undefined);
    return jsonResponse({ error: "webhook_route_destination_invalid" }, 503);
  }

  let body: ArrayBuffer;
  try {
    body = await boundedBody(request, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    return jsonResponse({ error: errorCode(error) }, 413);
  }

  const receivedAt = new Date().toISOString();
  const bodySha256 = await sha256Hex(new Uint8Array(body));
  const forwarded = forwardHeaders(request.headers);
  const signatureNames = SIGNATURE_HEADERS.filter((name) =>
    request.headers.has(name),
  );
  const signatureEvidence = signatureNames
    .map((name) => `${name}:${request.headers.get(name) ?? ""}`)
    .join("\n");
  const signatureEvidenceSha256 =
    signatureEvidence === ""
      ? null
      : await sha256Hex(new TextEncoder().encode(signatureEvidence));
  const eventId = `whe_${crypto.randomUUID()}`;
  const contentType = request.headers.get("content-type")?.slice(0, 256) ?? null;

  await env.DB.prepare(
    `INSERT INTO universal_webhook_events(
       event_id,route_id,merchant_id,provider,received_at,body_sha256,
       body_bytes,content_type,signature_header_names_json,
       signature_evidence_sha256,delivery_state
     ) VALUES(?,?,?,?,?,?,?,?,?,?,'RECEIVED')`,
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
      JSON.stringify(signatureNames),
      signatureEvidenceSha256,
    )
    .run();

  await env.DB.prepare(
    "UPDATE universal_webhook_routes SET last_event_at=?,updated_at=? WHERE route_id=?",
  )
    .bind(receivedAt, receivedAt, route.route_id)
    .run();

  forwarded.set("x-xguard-event-id", eventId);
  forwarded.set("x-xguard-route-id", route.route_id);
  forwarded.set("x-xguard-provider", route.provider);
  forwarded.set("x-xguard-body-sha256", bodySha256);
  forwarded.set("x-xguard-received-at", receivedAt);

  try {
    const stub = env.WEBHOOK_DELIVERY_QUEUE.getByName(eventId);
    await stub.enqueue({
      eventId,
      routeId: route.route_id,
      provider: route.provider,
      destinationUrl: destination.toString(),
      headers: [...forwarded.entries()],
      body,
    });
  } catch {
    await env.DB.prepare(
      `UPDATE universal_webhook_events
          SET delivery_state='DELIVERY_FAILED'
        WHERE event_id=?`,
    )
      .bind(eventId)
      .run()
      .catch(() => undefined);
    return jsonResponse(
      {
        error: "webhook_delivery_queue_unavailable",
        eventId,
        acceptedByXGuard: true,
      },
      503,
      { "Retry-After": "5" },
    );
  }

  return jsonResponse(
    {
      ok: true,
      eventId,
      acceptedByXGuard: true,
      delivery: "queued",
      retryPolicy: {
        maxAttempts: MAX_ATTEMPTS,
        backoffSeconds: RETRY_DELAYS_MS.map((value) => value / 1000),
      },
      bodySha256,
    },
    202,
  );
}

export class WebhookDeliveryQueue {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: WebhookDeliveryEnv,
  ) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    if (strictPublicHttpsTarget(input.destinationUrl) === null)
      throw new Error("unsafe_webhook_destination");
    if (input.body.byteLength > MAX_WEBHOOK_BODY_BYTES)
      throw new Error("webhook_body_too_large");

    const body = new Uint8Array(input.body);
    const chunkCount = Math.ceil(body.byteLength / CHUNK_BYTES);
    const writes: Record<string, ArrayBuffer> = {};
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(body.byteLength, start + CHUNK_BYTES);
      const chunk = body.slice(start, end);
      writes[`body:${index}`] = exactArrayBuffer(chunk);
    }
    if (Object.keys(writes).length > 0) await this.state.storage.put(writes);

    const meta: QueueMeta = {
      eventId: input.eventId,
      routeId: input.routeId,
      provider: input.provider,
      destinationUrl: input.destinationUrl,
      headers: input.headers,
      bodyChunks: chunkCount,
      bodyBytes: body.byteLength,
      attempt: 0,
      deliveredUpstream: false,
      deliveredStatus: null,
      deliveredLatencyMs: null,
    };
    await this.state.storage.put("meta", meta);
    await this.state.storage.setAlarm(Date.now() + 10);
  }

  async alarm(): Promise<void> {
    const meta = await this.state.storage.get<QueueMeta>("meta");
    if (meta === undefined) return;

    if (meta.deliveredUpstream) {
      try {
        await this.markDelivered(meta);
        await this.cleanup(meta);
      } catch {
        await this.state.storage.setAlarm(Date.now() + 5_000);
      }
      return;
    }

    const destination = strictPublicHttpsTarget(meta.destinationUrl);
    if (destination === null) {
      await this.markFailed(meta, null, 0).catch(() => undefined);
      await this.cleanup(meta);
      return;
    }

    const body = await this.readBody(meta);
    const headers = new Headers(meta.headers);
    const started = Date.now();
    let response: Response | null = null;
    try {
      response = await fetch(
        new Request(destination.toString(), {
          method: "POST",
          headers,
          body,
          redirect: "manual",
        }),
      );
    } catch {
      response = null;
    }
    const latencyMs = Math.max(0, Date.now() - started);

    if (response !== null && response.status >= 200 && response.status < 300) {
      await response.body?.cancel().catch(() => undefined);
      meta.deliveredUpstream = true;
      meta.deliveredStatus = response.status;
      meta.deliveredLatencyMs = latencyMs;
      await this.state.storage.put("meta", meta);
      try {
        await this.markDelivered(meta);
        await this.cleanup(meta);
      } catch {
        await this.state.storage.setAlarm(Date.now() + 5_000);
      }
      return;
    }

    const status = response?.status ?? null;
    await response?.body?.cancel().catch(() => undefined);
    meta.attempt += 1;
    await this.state.storage.put("meta", meta);
    await this.markFailed(meta, status, latencyMs).catch(() => undefined);

    if (meta.attempt >= MAX_ATTEMPTS) {
      await this.cleanup(meta);
      return;
    }

    const delay = RETRY_DELAYS_MS[Math.min(meta.attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
    await this.state.storage.setAlarm(Date.now() + delay);
  }

  private async readBody(meta: QueueMeta): Promise<ArrayBuffer> {
    const output = new Uint8Array(meta.bodyBytes);
    let offset = 0;
    for (let index = 0; index < meta.bodyChunks; index += 1) {
      const chunk = await this.state.storage.get<ArrayBuffer>(`body:${index}`);
      if (chunk === undefined) throw new Error("webhook_delivery_body_missing");
      const bytes = new Uint8Array(chunk);
      output.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return exactArrayBuffer(output);
  }

  private async markDelivered(meta: QueueMeta): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE universal_webhook_events
          SET delivery_state='DELIVERED',destination_status=?,
              destination_latency_ms=?,delivered_at=?
        WHERE event_id=?`,
    )
      .bind(
        meta.deliveredStatus,
        meta.deliveredLatencyMs,
        new Date().toISOString(),
        meta.eventId,
      )
      .run();
  }

  private async markFailed(
    meta: QueueMeta,
    status: number | null,
    latencyMs: number,
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE universal_webhook_events
          SET delivery_state='DELIVERY_FAILED',destination_status=?,
              destination_latency_ms=?
        WHERE event_id=?`,
    )
      .bind(status, latencyMs, meta.eventId)
      .run();
  }

  private async cleanup(meta: QueueMeta): Promise<void> {
    const keys = ["meta"];
    for (let index = 0; index < meta.bodyChunks; index += 1)
      keys.push(`body:${index}`);
    await this.state.storage.delete(keys);
  }
}

async function boundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) throw new Error("invalid_content_length");
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)
      throw new Error("webhook_body_too_large");
  }

  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error("webhook_body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return exactArrayBuffer(output);
}

function forwardHeaders(source: Headers): Headers {
  const output = new Headers();
  const contentType = source.get("content-type");
  if (contentType !== null) output.set("content-type", contentType.slice(0, 512));
  for (const name of SIGNATURE_HEADERS) {
    const value = source.get(name);
    if (value !== null && value.length <= 16 * 1024) output.set(name, value);
  }
  return output;
}

function decodePathSegment(value: string): string | null {
  if (value === "" || value.includes("/")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "webhook_error";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
