import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  XGuardError,
  bindEconomicIntent,
  parseJsonStrict,
  readHttpBodyTextCapped,
} from "@xguard/core/edge";
import {
  EconomicIntentCoordinator,
  type EconomicIntentSnapshot,
} from "./economic-intent-coordinator.js";
import {
  parseEconomicX402Envelope,
  settleEconomicX402,
  verifyEconomicX402,
} from "./x402-economic-adapter.js";

export { EconomicIntentCoordinator };

const MAX_JSON_BYTES = 64 * 1024;
const MAX_RESOURCE_RESPONSE_BYTES = 512 * 1024;
const RESOURCE_TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
const FORBIDDEN_OUTBOUND_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface EconomicFirewallEnv {
  ECONOMIC_INTENT_COORDINATOR: DurableObjectNamespace<EconomicIntentCoordinator>;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  PREVIEW_API_TOKEN: string;
  X402_FACILITATOR_URL: string;
}

type Variables = { requestId: string; merchantId: string };
type AppContext = Context<{
  Bindings: EconomicFirewallEnv;
  Variables: Variables;
}>;

const app = new Hono<{ Bindings: EconomicFirewallEnv; Variables: Variables }>();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  const started = performance.now();
  await next();
  context.header("X-Request-ID", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Cache-Control", "no-store");
  console.log(
    JSON.stringify({
      event: "economic_firewall_request_complete",
      requestId,
      path: context.req.path,
      method: context.req.method,
      status: context.res.status,
      latencyMs: Math.round(performance.now() - started),
    }),
  );
});

app.use("/v1/*", requirePreviewMerchant);

app.get("/", (context) =>
  context.json({
    name: "XGuard Economic Firewall",
    version: "0.1.0-preview",
    mode: "isolated-preview",
    guarantee:
      "One Intent -> One Authorization -> One Fulfillment -> One Settlement",
    endpoints: {
      createIntent: "POST /v1/intents",
      getIntent: "GET /v1/intents/:intentId",
      authorize: "POST /v1/intents/:intentId/authorize",
      x402Authorize: "POST /v1/intents/:intentId/x402/authorize",
      execute: "POST /v1/intents/:intentId/execute",
      settle: "POST /v1/intents/:intentId/settle",
      x402Settle: "POST /v1/intents/:intentId/x402/settle",
    },
  }),
);

app.get("/healthz", (context) =>
  context.json({ status: "ok", mode: "isolated-preview" }),
);

app.post("/v1/intents", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const body = await jsonBody(context.req.raw);
    const resource = record(body.resource, "resource");
    const money = record(body.money, "money");
    const method = requiredString(
      resource.method,
      "resource.method",
    ).toUpperCase();
    if (!ALLOWED_METHODS.has(method))
      throw new XGuardError(
        "BAD_REQUEST",
        "resource.method is not allowed",
        400,
      );
    const url = requiredString(resource.url, "resource.url");
    assertSafeResourceUrl(url);

    const binding = bindEconomicIntent({
      merchantId,
      actorId: optionalString(body.actorId, "actorId"),
      protocol: requiredString(body.protocol, "protocol"),
      resource: {
        method,
        url,
        bodyHash: optionalHash(resource.bodyHash, "resource.bodyHash"),
      },
      money: {
        maxAmountMicroUsd: requiredSafeInteger(
          money.maxAmountMicroUsd,
          "money.maxAmountMicroUsd",
        ),
        currency: requiredString(money.currency, "money.currency"),
        network: optionalString(money.network, "money.network"),
        asset: optionalString(money.asset, "money.asset"),
      },
      expiresAt: requiredString(body.expiresAt, "expiresAt"),
      nonce: requiredString(body.nonce, "nonce"),
      metadataHash: optionalHash(body.metadataHash, "metadataHash"),
    });

    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(
      binding.intentId,
    );
    const created = await stub.create(merchantId, binding);
    if (created.kind === "CONFLICT")
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Intent identifier is already bound to different terms",
        409,
      );
    return context.json(
      created.snapshot,
      created.kind === "CREATED" ? 201 : 200,
      { "X-XGuard-Intent-ID": binding.intentId },
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

app.get("/v1/intents/:intentId", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const snapshot =
      await context.env.ECONOMIC_INTENT_COORDINATOR.getByName(
        intentId,
      ).getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    return context.json(snapshot);
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/intents/:intentId/x402/authorize", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    if (snapshot.state !== "BOUND" && snapshot.state !== "AUTHORIZED")
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `x402 authorization cannot run from state ${snapshot.state}`,
        409,
      );
    const raw = await jsonBody(context.req.raw);
    const envelope = parseEconomicX402Envelope(raw, snapshot.terms);
    const verified = await verifyEconomicX402(
      context.env.X402_FACILITATOR_URL,
      envelope,
    );
    if (!verified.isValid)
      return context.json(
        {
          authorized: false,
          invalidReason: verified.invalidReason ?? "x402_invalid_authorization",
          invalidMessage:
            verified.invalidMessage ?? "x402 authorization was rejected",
        },
        402,
      );
    const authorized = await stub.recordAuthorization({
      merchantId,
      authorization: envelope.raw,
      authorizedAmountMicroUsd: envelope.amountMicroUsd,
    });
    return context.json(
      {
        authorized: true,
        payer: envelope.payer,
        payTo: envelope.payTo,
        amountMicroUsd: envelope.amountMicroUsd,
        intent: authorized,
      },
      200,
      {
        "X-XGuard-Intent-ID": authorized.intentId,
        "X-XGuard-State": authorized.state,
        "X-XGuard-Protocol": "x402",
      },
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/intents/:intentId/authorize", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const body = await jsonBody(context.req.raw);
    if (!("authorization" in body))
      throw new XGuardError("BAD_REQUEST", "authorization is required", 400);
    const snapshot = await context.env.ECONOMIC_INTENT_COORDINATOR.getByName(
      intentId,
    ).recordAuthorization({
      merchantId,
      authorization: rpcSafeJson(body.authorization),
      authorizedAmountMicroUsd: requiredSafeInteger(
        body.authorizedAmountMicroUsd,
        "authorizedAmountMicroUsd",
      ),
    });
    return context.json(snapshot, 200, {
      "X-XGuard-Intent-ID": snapshot.intentId,
      "X-XGuard-State": snapshot.state,
    });
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/intents/:intentId/execute", async (context) => {
  const merchantId = context.get("merchantId");
  const intentId = intentIdParam(context.req.param("intentId"));
  const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
  let executionId: string | null = null;
  try {
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    if (snapshot.state !== "AUTHORIZED" || snapshot.authorizationHash === null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `Intent cannot execute from state ${snapshot.state}`,
        409,
      );

    assertSafeResourceUrl(snapshot.terms.resource.url);
    const body = await jsonBody(context.req.raw);
    const outbound = prepareOutboundRequest(snapshot, body);
    executionId = crypto.randomUUID();
    await stub.beginExecution({
      merchantId,
      authorizationHash: snapshot.authorizationHash,
      executionId,
    });

    const response = await fetch(snapshot.terms.resource.url, {
      method: snapshot.terms.resource.method,
      headers: outbound.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS),
      ...(outbound.body === undefined ? {} : { body: outbound.body }),
    });
    const responseBody = await readBytesCapped(
      response,
      MAX_RESOURCE_RESPONSE_BYTES,
    );
    const fulfillment = {
      status: response.status,
      bodySha256: sha256BytesHex(responseBody),
      byteLength: responseBody.byteLength,
      contentType: response.headers.get("content-type"),
      location: response.headers.get("location"),
    };
    const fulfilled = await stub.recordFulfillment({
      merchantId,
      executionId,
      fulfillment,
    });

    const headers = responseHeaders(response.headers);
    headers.set("X-XGuard-Intent-ID", intentId);
    headers.set("X-XGuard-Execution-ID", executionId);
    headers.set("X-XGuard-State", fulfilled.state);
    const mayHaveBody =
      snapshot.terms.resource.method !== "HEAD" &&
      response.status !== 204 &&
      response.status !== 205 &&
      response.status !== 304;
    return new Response(mayHaveBody ? toArrayBuffer(responseBody) : null, {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (executionId !== null) {
      await stub
        .quarantine(merchantId, `execution_uncertain:${errorCode(error)}`)
        .catch(() => undefined);
    }
    return errorJson(context, error);
  }
});

app.post("/v1/intents/:intentId/x402/settle", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    const raw = await jsonBody(context.req.raw);
    const envelope = parseEconomicX402Envelope(raw, snapshot.terms);
    if (snapshot.authorizationHash !== envelope.authorizationHash)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "x402 settlement envelope is not the authorization bound to this Intent",
        409,
      );
    if (snapshot.state === "FINAL")
      return context.json(snapshot, 200, {
        "X-XGuard-Replayed": "true",
        "X-XGuard-Intent-ID": snapshot.intentId,
        "X-XGuard-State": snapshot.state,
        "X-XGuard-Protocol": "x402",
      });
    if (snapshot.state !== "FULFILLED" || snapshot.executionId === null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `x402 settlement cannot run from state ${snapshot.state}`,
        409,
      );

    const result = await settleEconomicX402(
      context.env.X402_FACILITATOR_URL,
      envelope,
    );
    if (!result.success)
      return context.json(
        {
          settled: false,
          result,
          intentId: snapshot.intentId,
          state: snapshot.state,
        },
        409,
      );

    await stub.recordSettlement({
      merchantId,
      executionId: snapshot.executionId,
      protocol: "x402",
      settlement: rpcSafeJson(result),
      chargedAmountMicroUsd: envelope.amountMicroUsd,
    });
    const finalized = await stub.getSnapshot(merchantId);
    if (finalized === null)
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Finalized intent disappeared",
        500,
      );
    return context.json({ settled: true, result, intent: finalized }, 200, {
      "X-XGuard-Replayed": "false",
      "X-XGuard-Intent-ID": finalized.intentId,
      "X-XGuard-State": finalized.state,
      "X-XGuard-Protocol": "x402",
      ...(finalized.proof === null
        ? {}
        : { "X-XGuard-Proof-Hash": finalized.proof.proofHash }),
    });
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/intents/:intentId/settle", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const body = await jsonBody(context.req.raw);
    if (!("settlement" in body))
      throw new XGuardError("BAD_REQUEST", "settlement is required", 400);
    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    if (snapshot.executionId === null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Intent has no execution to settle",
        409,
      );
    const protocol = requiredString(body.protocol, "protocol").toLowerCase();
    if (protocol !== snapshot.terms.protocol)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Settlement protocol does not match the bound intent",
        409,
      );
    await stub.recordSettlement({
      merchantId,
      executionId: snapshot.executionId,
      protocol,
      settlement: rpcSafeJson(body.settlement),
      chargedAmountMicroUsd: requiredSafeInteger(
        body.chargedAmountMicroUsd,
        "chargedAmountMicroUsd",
      ),
    });
    const finalized = await stub.getSnapshot(merchantId);
    if (finalized === null)
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Finalized intent disappeared",
        500,
      );
    return context.json(finalized, 200, {
      "X-XGuard-Intent-ID": finalized.intentId,
      "X-XGuard-State": finalized.state,
      ...(finalized.proof === null
        ? {}
        : { "X-XGuard-Proof-Hash": finalized.proof.proofHash }),
    });
  } catch (error) {
    return errorJson(context, error);
  }
});

app.notFound((context) => context.json({ error: "not_found" }, 404));
app.onError((error, context) => errorJson(context, error));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<EconomicFirewallEnv>;

async function requirePreviewMerchant(
  context: AppContext,
  next: Next,
): Promise<Response | void> {
  const configured = context.env.PREVIEW_API_TOKEN?.trim();
  if (configured === undefined || configured.length < 24)
    return context.json({ error: "preview_auth_not_configured" }, 503);
  const authorization = context.req.header("authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer "))
    return context.json({ error: "bearer_token_required" }, 401);
  const supplied = authorization.slice("Bearer ".length);
  const suppliedBytes = new TextEncoder().encode(supplied);
  const configuredBytes = new TextEncoder().encode(configured);
  if (
    suppliedBytes.byteLength !== configuredBytes.byteLength ||
    !timingSafeEqual(suppliedBytes, configuredBytes)
  )
    return context.json({ error: "invalid_bearer_token" }, 401);

  const merchantId = "preview_isolated";
  context.set("merchantId", merchantId);
  const key = `economic:${merchantId}`;
  try {
    const [client, global] = await Promise.all([
      context.env.REQUEST_RATE_LIMITER.limit({ key }),
      context.env.GLOBAL_RATE_LIMITER.limit({ key: "economic-global" }),
    ]);
    if (!client.success || !global.success)
      return context.json({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch {
    return context.json({ error: "protection_unavailable" }, 503);
  }
  await next();
}

function prepareOutboundRequest(
  snapshot: EconomicIntentSnapshot,
  request: Record<string, unknown>,
): { headers: Headers; body: ArrayBuffer | undefined } {
  const method = snapshot.terms.resource.method;
  const rawHeaders =
    request.headers === undefined ? {} : record(request.headers, "headers");
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value !== "string")
      throw new XGuardError(
        "BAD_REQUEST",
        `headers.${key} must be a string`,
        400,
      );
    const normalized = key.trim().toLowerCase();
    if (
      normalized.startsWith("cf-") ||
      FORBIDDEN_OUTBOUND_HEADERS.has(normalized)
    )
      throw new XGuardError(
        "BAD_REQUEST",
        `Outbound header ${key} is not allowed`,
        400,
      );
    headers.set(key, value);
  }

  if (method === "GET" || method === "HEAD") {
    if (request.body !== undefined && request.body !== null)
      throw new XGuardError(
        "BAD_REQUEST",
        `${method} intent cannot include a body`,
        400,
      );
    if (snapshot.terms.resource.bodyHash !== null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `${method} intent must bind a null bodyHash`,
        409,
      );
    return { headers, body: undefined };
  }

  let bytes: Uint8Array | undefined;
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === "string") {
      bytes = new TextEncoder().encode(request.body);
    } else {
      const encoded = JSON.stringify(request.body);
      bytes = new TextEncoder().encode(encoded);
      if (!headers.has("content-type"))
        headers.set("content-type", "application/json; charset=utf-8");
    }
  }
  const expected = snapshot.terms.resource.bodyHash;
  if (expected === null) {
    if (bytes !== undefined && bytes.byteLength > 0)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Intent did not authorize an HTTP request body",
        409,
      );
  } else {
    if (bytes === undefined)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Intent requires the bound HTTP request body",
        409,
      );
    if (sha256BytesHex(bytes) !== expected)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "HTTP request body does not match the bound intent hash",
        409,
      );
  }
  return {
    headers,
    body: bytes === undefined ? undefined : toArrayBuffer(bytes),
  };
}

function assertSafeResourceUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new XGuardError("BAD_REQUEST", "resource.url must be absolute", 400);
  }
  if (url.protocol !== "https:")
    throw new XGuardError(
      "BAD_REQUEST",
      "Only HTTPS resource URLs are allowed",
      400,
    );
  if (url.username !== "" || url.password !== "")
    throw new XGuardError(
      "BAD_REQUEST",
      "Resource URL credentials are forbidden",
      400,
    );
  if (url.port !== "" && url.port !== "443")
    throw new XGuardError(
      "BAD_REQUEST",
      "Resource URL must use HTTPS port 443",
      400,
    );
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Private, local, and literal-IP resource hosts are forbidden",
      400,
    );
}

async function readBytesCapped(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared)) {
    if (BigInt(declared) > BigInt(maximumBytes))
      throw new XGuardError(
        "BAD_REQUEST",
        `Resource response exceeds ${maximumBytes} bytes`,
        502,
      );
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes)
        throw new XGuardError(
          "BAD_REQUEST",
          `Resource response exceeds ${maximumBytes} bytes`,
          502,
        );
      chunks.push(next.value);
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
  return output;
}

function responseHeaders(source: Headers): Headers {
  const result = new Headers();
  for (const key of [
    "content-type",
    "content-language",
    "etag",
    "last-modified",
    "location",
  ]) {
    const value = source.get(key);
    if (value !== null) result.set(key, value);
  }
  return result;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.toLowerCase();
  if (contentType !== "application/json")
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  return record(
    parseJsonStrict(
      await readHttpBodyTextCapped(
        request,
        MAX_JSON_BYTES,
        "Economic Firewall body",
      ),
    ),
    "body",
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", `${field} must be an object`, 400);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new XGuardError("BAD_REQUEST", `${field} is required`, 400);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a string or null`,
      400,
    );
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function optionalHash(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value))
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a SHA-256 hex digest or null`,
      400,
    );
  return value.toLowerCase();
}

function rpcSafeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function requiredSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a non-negative safe integer`,
      400,
    );
  return value;
}

function intentIdParam(value: string): string {
  if (!/^xi_[0-9a-f]{40}$/.test(value))
    throw new XGuardError("BAD_REQUEST", "Invalid intentId", 400);
  return value;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function sha256BytesHex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorJson(context: AppContext, error: unknown): Response {
  if (error instanceof XGuardError)
    return context.json(
      { error: error.code.toLowerCase(), message: error.message },
      statusCode(error.status),
    );
  console.error(
    JSON.stringify({
      event: "economic_firewall_error",
      requestId: context.get("requestId"),
      code: errorCode(error),
    }),
  );
  return context.json({ error: "internal_error" }, 500);
}

function statusCode(
  value: number,
): 400 | 401 | 402 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502 | 503 {
  if (
    value === 400 ||
    value === 401 ||
    value === 402 ||
    value === 403 ||
    value === 404 ||
    value === 409 ||
    value === 413 ||
    value === 415 ||
    value === 429 ||
    value === 500 ||
    value === 502 ||
    value === 503
  )
    return value;
  return 500;
}

function errorCode(error: unknown): string {
  if (error instanceof XGuardError) return error.code.toLowerCase();
  if (error instanceof Error && error.name !== "")
    return error.name.toLowerCase();
  return "unknown";
}
