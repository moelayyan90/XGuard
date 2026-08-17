import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  earnGatewayFee,
  releaseGatewayFee,
  reserveGatewayFee,
} from "./universal-gateway-billing.js";

const DISCOVERY_PATH = "/.well-known/xguard.json";
const VAULT_PATH = "/v1/gateway/vault";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_PROVIDER_KEY_LENGTH = 4096;

interface AutoInvokeEnv {
  DB: D1Database;
  XGUARD_MODEL_FEE_MICRO_USD?: string;
}

type ProviderId = "openai" | "anthropic" | "gemini";

interface ProviderRoute {
  provider: ProviderId;
  upstreamUrl: string;
  operation: string;
}

interface CredentialRow {
  ciphertext: string;
  iv: string;
  key_version: string;
}

export async function autoInvokeResponse(
  request: Request,
  env: AutoInvokeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    url.pathname === DISCOVERY_PATH &&
    (request.method === "GET" || request.method === "HEAD")
  )
    return discoveryResponse(request, url.origin);

  if (url.pathname === VAULT_PATH || url.pathname.startsWith(`${VAULT_PATH}/`))
    return vaultResponse(request, env);

  const route = await classifyAutoInvokeRoute(request);
  if (route === null) return null;

  return executeAutoInvoke(request, env, route);
}

export async function classifyAutoInvokeRoute(
  request: Request,
): Promise<ProviderRoute | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/v1/messages")
    return {
      provider: "anthropic",
      upstreamUrl: `https://api.anthropic.com${path}${url.search}`,
      operation: `${request.method}:${path}`,
    };

  if (path.startsWith("/v1beta/openai/")) {
    const suffix = path.slice("/v1beta/openai".length);
    return {
      provider: "gemini",
      upstreamUrl: `https://generativelanguage.googleapis.com/v1beta/openai${suffix}${url.search}`,
      operation: `${request.method}:${path}`,
    };
  }

  if (!isOpenAiCompatiblePath(path)) return null;
  const model =
    merchantTokenFromStandardClient(request) === null
      ? null
      : await readModel(request);
  if (model?.toLowerCase().startsWith("gemini-")) {
    const suffix = path.startsWith("/v1") ? path.slice(3) : path;
    return {
      provider: "gemini",
      upstreamUrl: `https://generativelanguage.googleapis.com/v1beta/openai${suffix}${url.search}`,
      operation: `${request.method}:${path}`,
    };
  }

  return {
    provider: "openai",
    upstreamUrl: `https://api.openai.com${path}${url.search}`,
    operation: `${request.method}:${path}`,
  };
}

async function executeAutoInvoke(
  request: Request,
  env: AutoInvokeEnv,
  route: ProviderRoute,
): Promise<Response> {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method))
    return jsonResponse({ error: "auto_invoke_method_not_supported" }, 405, {
      Allow: "GET, POST, PUT, PATCH, DELETE",
    });

  const merchantToken = merchantTokenFromStandardClient(request);
  if (merchantToken === null)
    return jsonResponse(
      {
        error: "xguard_key_required",
        message:
          "Use your XGuard merchant API key as the standard client API key. XGuard then invokes itself automatically for every compatible request.",
        discovery: DISCOVERY_PATH,
      },
      401,
    );

  const authRequest = requestWithMerchantAuthorization(request, merchantToken);
  const access = await authorizeMerchantScope(authRequest, env, "billing");
  if (!access.ok) return access.response;

  const providerKey = await loadProviderCredential(
    env.DB,
    access.merchant.merchantId,
    route.provider,
    merchantToken,
  );
  if (providerKey === null)
    return jsonResponse(
      {
        error: "provider_not_linked",
        provider: route.provider,
        oneTimeSetup: {
          method: "POST",
          path: VAULT_PATH,
          body: { provider: route.provider, apiKey: "<provider-api-key>" },
          authorization: "Bearer <XGuard merchant API key>",
        },
        message:
          "Link this provider once. After that, normal SDK requests invoke XGuard automatically with no XGuard-specific request headers.",
      },
      428,
    );

  const requestId = autoRequestId(request);
  const feeMicroUsd = modelFee(env);
  let reservation;
  try {
    reservation = await reserveGatewayFee(env.DB, {
      merchantId: access.merchant.merchantId,
      requestId,
      kind: "MODEL",
      provider: route.provider,
      operation: route.operation,
      amountMicroUsd: feeMicroUsd,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "insufficient_service_balance")
      return jsonResponse(
        {
          error: code,
          message:
            "Top up the XGuard prepaid balance. The provider itself is still paid with the linked BYOK credential.",
        },
        402,
      );
    if (
      code === "gateway_event_already_earned" ||
      code === "gateway_event_in_progress"
    )
      return jsonResponse({ error: code }, 409);
    return jsonResponse({ error: code }, 400);
  }

  const headers = upstreamHeaders(request.headers, route.provider, providerKey);
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(
      new Request(route.upstreamUrl, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? null
            : request.body,
        redirect: "manual",
      }),
    );
  } catch {
    const accounting = await releaseAutoInvokeReservation(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    );
    return autoResponse(
      { error: "upstream_unavailable", provider: route.provider },
      502,
      requestId,
      0,
      route.provider,
      0,
      accounting,
    );
  }

  const latencyMs = Math.max(0, Date.now() - started);
  if (isAutoInvokeRedirectStatus(upstream.status)) {
    const accounting = await releaseAutoInvokeReservation(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    );
    return autoResponse(
      {
        error: "upstream_redirect_rejected",
        provider: route.provider,
        upstreamStatus: upstream.status,
      },
      502,
      requestId,
      0,
      route.provider,
      latencyMs,
      accounting,
    );
  }

  if (!isAutoInvokeBillableStatus(upstream.status)) {
    const accounting = await releaseAutoInvokeReservation(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    );
    return proxiedResponse(
      upstream,
      requestId,
      0,
      route.provider,
      latencyMs,
      accounting,
    );
  }

  const accounting = await finalizeAutoInvokeSuccess(env.DB, {
    merchantId: access.merchant.merchantId,
    eventKey: reservation.eventKey,
    upstreamStatus: upstream.status,
    latencyMs,
    requestBytes: contentLength(request.headers),
    responseBytes: contentLength(upstream.headers),
  });
  return proxiedResponse(
    upstream,
    requestId,
    accounting === "earned" ? feeMicroUsd : 0,
    route.provider,
    latencyMs,
    accounting,
  );
}

export function isAutoInvokeBillableStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

export function isAutoInvokeRedirectStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

export type AutoInvokeAccountingState =
  "earned" | "released" | "pending-release";

export async function finalizeAutoInvokeSuccess(
  db: D1Database,
  input: {
    merchantId: string;
    eventKey: string;
    upstreamStatus: number;
    latencyMs: number;
    requestBytes?: number;
    responseBytes?: number;
  },
): Promise<AutoInvokeAccountingState> {
  try {
    await earnGatewayFee(db, input);
    return "earned";
  } catch {
    return releaseAutoInvokeReservation(db, input.merchantId, input.eventKey);
  }
}

export async function releaseAutoInvokeReservation(
  db: D1Database,
  merchantId: string,
  eventKey: string,
): Promise<Exclude<AutoInvokeAccountingState, "earned">> {
  try {
    await releaseGatewayFee(db, merchantId, eventKey);
    return "released";
  } catch {
    return "pending-release";
  }
}

async function vaultResponse(
  request: Request,
  env: AutoInvokeEnv,
): Promise<Response> {
  const token = bearerToken(request);
  if (token === null)
    return jsonResponse({ error: "xguard_bearer_key_required" }, 401);

  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;
  const url = new URL(request.url);

  if (url.pathname === VAULT_PATH && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT provider,updated_at FROM gateway_provider_credentials WHERE merchant_id=? ORDER BY provider",
    )
      .bind(access.merchant.merchantId)
      .all<{ provider: ProviderId; updated_at: string }>();
    return jsonResponse({
      providers: result.results.map((row) => ({
        provider: row.provider,
        linked: true,
        updatedAt: row.updated_at,
      })),
      secretsReturned: false,
      autoInvoke: true,
    });
  }

  if (url.pathname === VAULT_PATH && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await jsonObject(request);
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
    let provider: ProviderId;
    try {
      provider = parseProvider(body.provider);
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (apiKey.length < 8 || apiKey.length > MAX_PROVIDER_KEY_LENGTH)
      return jsonResponse({ error: "invalid_provider_api_key" }, 400);

    const encrypted = await encryptProviderCredential(
      apiKey,
      token,
      access.merchant.merchantId,
      provider,
    );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO gateway_provider_credentials(
         merchant_id,provider,ciphertext,iv,key_version,created_at,updated_at
       ) VALUES(?,?,?,?,'v1',?,?)
       ON CONFLICT(merchant_id,provider) DO UPDATE SET
         ciphertext=excluded.ciphertext,
         iv=excluded.iv,
         key_version='v1',
         updated_at=excluded.updated_at`,
    )
      .bind(
        access.merchant.merchantId,
        provider,
        encrypted.ciphertext,
        encrypted.iv,
        now,
        now,
      )
      .run();
    return jsonResponse(
      {
        provider,
        linked: true,
        encryptedAtRest: true,
        autoInvokeReady: true,
        secretEchoed: false,
      },
      201,
    );
  }

  if (
    url.pathname.startsWith(`${VAULT_PATH}/`) &&
    request.method === "DELETE"
  ) {
    let provider: ProviderId;
    try {
      provider = parseProvider(
        decodeURIComponent(url.pathname.slice(`${VAULT_PATH}/`.length)),
      );
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
    await env.DB.prepare(
      "DELETE FROM gateway_provider_credentials WHERE merchant_id=? AND provider=?",
    )
      .bind(access.merchant.merchantId, provider)
      .run();
    return jsonResponse({ provider, linked: false });
  }

  return jsonResponse({ error: "vault_method_not_allowed" }, 405, {
    Allow: "GET, POST, DELETE",
  });
}

async function loadProviderCredential(
  db: D1Database,
  merchantId: string,
  provider: ProviderId,
  token: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT ciphertext,iv,key_version FROM gateway_provider_credentials WHERE merchant_id=? AND provider=?",
    )
    .bind(merchantId, provider)
    .first<CredentialRow>();
  if (row === null) return null;
  if (row.key_version !== "v1")
    throw new Error("unsupported_vault_key_version");
  return decryptProviderCredential(
    row.ciphertext,
    row.iv,
    token,
    merchantId,
    provider,
  );
}

export async function encryptProviderCredential(
  plaintext: string,
  merchantToken: string,
  merchantId: string,
  provider: ProviderId,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(merchantToken);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: exactArrayBuffer(iv),
      additionalData: exactArrayBuffer(vaultAad(merchantId, provider)),
    },
    key,
    exactArrayBuffer(new TextEncoder().encode(plaintext)),
  );
  return {
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    iv: base64Url(iv),
  };
}

export async function decryptProviderCredential(
  ciphertext: string,
  iv: string,
  merchantToken: string,
  merchantId: string,
  provider: ProviderId,
): Promise<string> {
  const key = await vaultKey(merchantToken);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: exactArrayBuffer(fromBase64Url(iv)),
      additionalData: exactArrayBuffer(vaultAad(merchantId, provider)),
    },
    key,
    exactArrayBuffer(fromBase64Url(ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export async function rewrapProviderCredentialRecord(input: {
  ciphertext: string;
  iv: string;
  oldMerchantToken: string;
  newMerchantToken: string;
  merchantId: string;
  provider: ProviderId;
}): Promise<{ ciphertext: string; iv: string }> {
  const plaintext = await decryptProviderCredential(
    input.ciphertext,
    input.iv,
    input.oldMerchantToken,
    input.merchantId,
    input.provider,
  );
  return encryptProviderCredential(
    plaintext,
    input.newMerchantToken,
    input.merchantId,
    input.provider,
  );
}

export async function rewrapProviderCredentials(
  db: D1Database,
  merchantId: string,
  oldMerchantToken: string,
  newMerchantToken: string,
): Promise<number> {
  const result = await db
    .prepare(
      "SELECT provider,ciphertext,iv,key_version FROM gateway_provider_credentials WHERE merchant_id=? ORDER BY provider",
    )
    .bind(merchantId)
    .all<CredentialRow & { provider: ProviderId }>();
  if (result.results.length === 0) return 0;
  const updates: D1PreparedStatement[] = [];
  const updatedAt = new Date().toISOString();
  for (const row of result.results) {
    if (row.key_version !== "v1")
      throw new Error("unsupported_vault_key_version");
    const wrapped = await rewrapProviderCredentialRecord({
      ciphertext: row.ciphertext,
      iv: row.iv,
      oldMerchantToken,
      newMerchantToken,
      merchantId,
      provider: row.provider,
    });
    updates.push(
      db
        .prepare(
          "UPDATE gateway_provider_credentials SET ciphertext=?,iv=?,updated_at=? WHERE merchant_id=? AND provider=? AND key_version='v1'",
        )
        .bind(
          wrapped.ciphertext,
          wrapped.iv,
          updatedAt,
          merchantId,
          row.provider,
        ),
    );
  }
  await db.batch(updates);
  return updates.length;
}

function discoveryResponse(request: Request, origin: string): Response {
  const body = {
    name: "XGuard",
    mode: "zero-study-auto-invoke",
    principle:
      "Configure XGuard once, then compatible SDK requests invoke XGuard automatically.",
    standardClients: {
      openai: {
        baseURL: `${origin}/v1`,
        apiKey: "use your XGuard merchant API key",
        automaticProviderInference: ["openai", "gemini-by-model-prefix"],
      },
      anthropic: {
        baseURL: origin,
        apiKey: "use your XGuard merchant API key",
        nativeMessagesPath: "/v1/messages",
      },
      geminiOpenAICompatibility: {
        baseURL: `${origin}/v1beta/openai`,
        apiKey: "use your XGuard merchant API key",
      },
    },
    oneTimeProviderLink: {
      method: "POST",
      path: VAULT_PATH,
      authorization: "Bearer <XGuard merchant API key>",
      body: { provider: "openai|anthropic|gemini", apiKey: "<provider key>" },
    },
    automaticBehavior: [
      "identify provider from the standard request path and model",
      "load the linked encrypted BYOK credential",
      "reserve XGuard usage fee",
      "forward the request to the provider",
      "release the fee on failed upstream execution",
      "earn the fee only on successful upstream execution",
      "return the provider response with XGuard execution metadata",
    ],
    xguardSpecificHeaderRequiredPerRequest: false,
  };
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(body, null, 2),
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function upstreamHeaders(
  source: Headers,
  provider: ProviderId,
  providerKey: string,
): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "x-goog-api-key" ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "cookie" ||
      lower === "accept-encoding" ||
      lower.startsWith("cf-") ||
      lower.startsWith("x-forwarded-") ||
      lower.startsWith("x-xguard-")
    )
      continue;
    headers.set(name, value);
  }

  if (provider === "anthropic") {
    headers.set("x-api-key", providerKey);
    if (!headers.has("anthropic-version"))
      headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${providerKey}`);
  }
  return headers;
}

function proxiedResponse(
  upstream: Response,
  requestId: string,
  feeMicroUsd: number,
  provider: ProviderId,
  latencyMs: number,
  accounting: AutoInvokeAccountingState,
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.set("X-XGuard-Auto-Invoked", "true");
  headers.set("X-XGuard-Request-Id", requestId);
  headers.set("X-XGuard-Fee-Micro-Usd", String(feeMicroUsd));
  headers.set("X-XGuard-Provider", provider);
  headers.set("X-XGuard-Upstream-Latency-Ms", String(latencyMs));
  headers.set("X-XGuard-Accounting", accounting);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function autoResponse(
  value: Record<string, unknown>,
  status: number,
  requestId: string,
  feeMicroUsd: number,
  provider: ProviderId,
  latencyMs: number,
  accounting?: AutoInvokeAccountingState,
): Response {
  const headers: Record<string, string> = {
    "X-XGuard-Auto-Invoked": "true",
    "X-XGuard-Request-Id": requestId,
    "X-XGuard-Fee-Micro-Usd": String(feeMicroUsd),
    "X-XGuard-Provider": provider,
    "X-XGuard-Upstream-Latency-Ms": String(latencyMs),
  };
  if (accounting !== undefined) headers["X-XGuard-Accounting"] = accounting;
  return jsonResponse(value, status, headers);
}

function requestWithMerchantAuthorization(
  request: Request,
  token: string,
): Request {
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

function merchantTokenFromStandardClient(request: Request): string | null {
  return bearerToken(request) ?? xApiKeyToken(request);
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (value === null || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return /^xg_live_[A-Za-z0-9_-]{40,}$/.test(token) ? token : null;
}

function xApiKeyToken(request: Request): string | null {
  const token = request.headers.get("x-api-key")?.trim() ?? "";
  return /^xg_live_[A-Za-z0-9_-]{40,}$/.test(token) ? token : null;
}

function isOpenAiCompatiblePath(path: string): boolean {
  return (
    path === "/v1/responses" ||
    path === "/v1/chat/completions" ||
    path === "/v1/embeddings" ||
    path === "/v1/images/generations" ||
    path === "/v1/audio/speech" ||
    path === "/v1/audio/transcriptions" ||
    path === "/v1/audio/translations" ||
    path.startsWith("/v1/files/") ||
    path === "/v1/files" ||
    path.startsWith("/v1/batches/") ||
    path === "/v1/batches"
  );
}

async function readModel(request: Request): Promise<string | null> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const value = await boundedJsonValue(request, true);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const model = (value as Record<string, unknown>).model;
    return typeof model === "string" ? model.trim() : null;
  } catch {
    return null;
  }
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const value = await boundedJsonValue(request, false);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("json_object_required");
  return value as Record<string, unknown>;
}

async function boundedJsonValue(
  request: Request,
  cloneRequest: boolean,
): Promise<unknown> {
  const target = cloneRequest ? request.clone() : request;
  const rawLength = target.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^[0-9]+$/.test(rawLength)) throw new Error("invalid_content_length");
    const declared = Number(rawLength);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > MAX_JSON_BODY_BYTES
    )
      throw new Error("request_body_too_large");
  }
  if (target.body === null) throw new Error("json_body_required");

  const reader = target.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("request_body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function parseProvider(value: unknown): ProviderId {
  if (value === "openai" || value === "anthropic" || value === "gemini")
    return value;
  throw new Error("unsupported_provider");
}

function modelFee(env: AutoInvokeEnv): number {
  const raw = env.XGUARD_MODEL_FEE_MICRO_USD ?? "10";
  if (!/^[0-9]+$/.test(raw)) throw new Error("invalid_gateway_fee_config");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000)
    throw new Error("invalid_gateway_fee_config");
  return value;
}

function autoRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,96}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

async function vaultKey(token: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`xguard-vault-v1:${token}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function vaultAad(merchantId: string, provider: ProviderId): Uint8Array {
  return new TextEncoder().encode(`xguard:${merchantId}:${provider}:v1`);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function contentLength(headers: Headers): number {
  const raw = headers.get("content-length");
  if (raw === null || !/^[0-9]+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "gateway_error";
}
