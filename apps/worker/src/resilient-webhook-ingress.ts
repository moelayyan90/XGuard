import { strictPublicHttpsTarget } from "./universal-security-guard.js";

const INGRESS_PATH = "/v1/webhooks/in/";
const MAX_BODY_BYTES = 1024 * 1024;
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

type IngressEnv = {
  DB: D1Database;
  WEBHOOK_DELIVERY_QUEUE: DurableObjectNamespace<WebhookDeliveryQueue>;
  WEBHOOK_RATE_LIMITER: RateLimit;
};
type DeliveryEnv = { DB: D1Database };
type RouteRow = {
  route_id: string;
  merchant_id: string;
  provider: string;
  destination_url: string;
};
type QueueMeta = {
  eventId: string;
  routeId: string;
  provider: string;
  destinationUrl: string;
  headers: Array<[string, string]>;
  bodyBytes: number;
  bodyChunks: number;
  attempt: number;
  deliveredUpstream: boolean;
  deliveredStatus: number | null;
  deliveredLatencyMs: number | null;
};
type EnqueueInput = Omit<
  QueueMeta,
  | "bodyBytes"
  | "bodyChunks"
  | "attempt"
  | "deliveredUpstream"
  | "deliveredStatus"
  | "deliveredLatencyMs"
> & { body: ArrayBuffer };

export async function resilientWebhookIngressResponse(
  request: Request,
  env: IngressEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(INGRESS_PATH)) return null;
  const token = decodeSegment(url.pathname.slice(INGRESS_PATH.length));
  if (token === null || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return json({ error: "webhook_route_not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });

  const tokenHash = await sha256(new TextEncoder().encode(token));
  try {
    const rate = await env.WEBHOOK_RATE_LIMITER.limit({
      key: `webhook:${tokenHash.slice(0, 32)}`,
    });
    if (!rate.success)
      return json({ error: "webhook_rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch {
    return json({ error: "webhook_protection_unavailable" }, 503, {
      "Retry-After": "5",
    });
  }

  const route = await env.DB.prepare(
    `SELECT route_id,merchant_id,provider,destination_url
       FROM universal_webhook_routes
      WHERE token_sha256=? AND active=1`,
  )
    .bind(tokenHash)
    .first<RouteRow>();
  if (route === null) return json({ error: "webhook_route_not_found" }, 404);

  const destination = strictPublicHttpsTarget(route.destination_url);
  if (destination === null) {
    await env.DB.prepare(
      "UPDATE universal_webhook_routes SET active=0,updated_at=? WHERE route_id=?",
    )
      .bind(new Date().toISOString(), route.route_id)
      .run()
      .catch(() => undefined);
    return json({ error: "webhook_route_destination_invalid" }, 503);
  }

  let body: ArrayBuffer;
  try {
    body = await boundedBody(request);
  } catch (error) {
    return json({ error: errorCode(error) }, 413);
  }

  const receivedAt = new Date().toISOString();
  const bodySha256 = await sha256(new Uint8Array(body));
  const eventId = `whe_${crypto.randomUUID()}`;
  const signatureNames = SIGNATURE_HEADERS.filter((name) =>
    request.headers.has(name),
  );
  const signatureEvidence = signatureNames
    .map((name) => `${name}:${request.headers.get(name) ?? ""}`)
    .join("\n");
  const signatureEvidenceSha256 = signatureEvidence
    ? await sha256(new TextEncoder().encode(signatureEvidence))
    : null;

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
      request.headers.get("content-type")?.slice(0, 256) ?? null,
      JSON.stringify(signatureNames),
      signatureEvidenceSha256,
    )
    .run();
  await env.DB.prepare(
    "UPDATE universal_webhook_routes SET last_event_at=?,updated_at=? WHERE route_id=?",
  )
    .bind(receivedAt, receivedAt, route.route_id)
    .run();

  const headers = forwardedHeaders(request.headers);
  headers.set("x-xguard-event-id", eventId);
  headers.set("x-xguard-route-id", route.route_id);
  headers.set("x-xguard-provider", route.provider);
  headers.set("x-xguard-body-sha256", bodySha256);
  headers.set("x-xguard-received-at", receivedAt);

  try {
    const stub = env.WEBHOOK_DELIVERY_QUEUE.getByName(eventId);
    await stub.enqueue({
      eventId,
      routeId: route.route_id,
      provider: route.provider,
      destinationUrl: destination.toString(),
      headers: [...headers.entries()],
      body,
    });
  } catch {
    await markFailed(env.DB, eventId, null, null).catch(() => undefined);
    return json(
      {
        error: "webhook_delivery_queue_unavailable",
        eventId,
        acceptedByXGuard: true,
      },
      503,
      { "Retry-After": "5" },
    );
  }

  return json(
    {
      ok: true,
      eventId,
      acceptedByXGuard: true,
      delivery: "queued",
      retryPolicy: {
        maxAttempts: MAX_ATTEMPTS,
        backoffSeconds: RETRY_DELAYS_MS.map((delay) => delay / 1000),
      },
      bodySha256,
    },
    202,
  );
}

export class WebhookDeliveryQueue {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: DeliveryEnv,
  ) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    if (strictPublicHttpsTarget(input.destinationUrl) === null)
      throw new Error("unsafe_webhook_destination");
    if (input.body.byteLength > MAX_BODY_BYTES)
      throw new Error("webhook_body_too_large");

    const bytes = new Uint8Array(input.body);
    const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
    for (let index = 0; index < chunks; index += 1) {
      const start = index * CHUNK_BYTES;
      await this.state.storage.put(
        `body:${index}`,
        exactBuffer(
          bytes.slice(start, Math.min(bytes.byteLength, start + CHUNK_BYTES)),
        ),
      );
    }
    const meta: QueueMeta = {
      eventId: input.eventId,
      routeId: input.routeId,
      provider: input.provider,
      destinationUrl: input.destinationUrl,
      headers: input.headers,
      bodyBytes: bytes.byteLength,
      bodyChunks: chunks,
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
        await markDelivered(
          this.env.DB,
          meta.eventId,
          meta.deliveredStatus,
          meta.deliveredLatencyMs,
        );
        await this.cleanup(meta);
      } catch {
        await this.state.storage.setAlarm(Date.now() + 5_000);
      }
      return;
    }

    const target = strictPublicHttpsTarget(meta.destinationUrl);
    if (target === null) {
      await markFailed(this.env.DB, meta.eventId, null, null).catch(
        () => undefined,
      );
      await this.cleanup(meta);
      return;
    }

    const body = await this.readBody(meta);
    const started = Date.now();
    let response: Response | null = null;
    try {
      response = await fetch(
        new Request(target.toString(), {
          method: "POST",
          headers: new Headers(meta.headers),
          body,
          redirect: "manual",
        }),
      );
    } catch {
      response = null;
    }
    const latency = Math.max(0, Date.now() - started);

    if (response !== null && response.status >= 200 && response.status < 300) {
      await response.body?.cancel().catch(() => undefined);
      meta.deliveredUpstream = true;
      meta.deliveredStatus = response.status;
      meta.deliveredLatencyMs = latency;
      await this.state.storage.put("meta", meta);
      try {
        await markDelivered(
          this.env.DB,
          meta.eventId,
          response.status,
          latency,
        );
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
    await markFailed(this.env.DB, meta.eventId, status, latency).catch(
      () => undefined,
    );
    if (meta.attempt >= MAX_ATTEMPTS) {
      await this.cleanup(meta);
      return;
    }
    const delay =
      RETRY_DELAYS_MS[Math.min(meta.attempt - 1, RETRY_DELAYS_MS.length - 1)] ??
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
    await this.state.storage.setAlarm(Date.now() + delay);
  }

  private async readBody(meta: QueueMeta): Promise<ArrayBuffer> {
    const output = new Uint8Array(meta.bodyBytes);
    let offset = 0;
    for (let index = 0; index < meta.bodyChunks; index += 1) {
      const chunk = await this.state.storage.get<ArrayBuffer>(`body:${index}`);
      if (chunk === undefined) throw new Error("webhook_body_missing");
      const bytes = new Uint8Array(chunk);
      output.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return exactBuffer(output);
  }

  private async cleanup(meta: QueueMeta): Promise<void> {
    await this.state.storage.delete("meta");
    for (let index = 0; index < meta.bodyChunks; index += 1)
      await this.state.storage.delete(`body:${index}`);
  }
}

async function markDelivered(
  db: D1Database,
  eventId: string,
  status: number | null,
  latency: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE universal_webhook_events
          SET delivery_state='DELIVERED',destination_status=?,
              destination_latency_ms=?,delivered_at=?
        WHERE event_id=?`,
    )
    .bind(status, latency, new Date().toISOString(), eventId)
    .run();
}

async function markFailed(
  db: D1Database,
  eventId: string,
  status: number | null,
  latency: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE universal_webhook_events
          SET delivery_state='DELIVERY_FAILED',destination_status=?,
              destination_latency_ms=?
        WHERE event_id=?`,
    )
    .bind(status, latency, eventId)
    .run();
}

async function boundedBody(request: Request): Promise<ArrayBuffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
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
      if (total > MAX_BODY_BYTES) {
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
  return exactBuffer(output);
}

function forwardedHeaders(source: Headers): Headers {
  const output = new Headers();
  const contentType = source.get("content-type");
  if (contentType) output.set("content-type", contentType.slice(0, 512));
  for (const name of SIGNATURE_HEADERS) {
    const value = source.get(name);
    if (value !== null && value.length <= 16 * 1024) output.set(name, value);
  }
  return output;
}

function decodeSegment(value: string): string | null {
  if (!value || value.includes("/")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function json(
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
  return error instanceof Error
    ? error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_")
    : "webhook_error";
}
