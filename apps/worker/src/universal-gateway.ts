import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  earnGatewayFee,
  gatewayEventKey,
  releaseGatewayFee,
  reserveGatewayFee,
  type GatewayEventKind,
} from "./universal-gateway-billing.js";

const PROXY_PREFIX = "/v1/gateway/proxy/";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_ANALYSIS_CANDIDATES = 50;

interface UniversalGatewayEnv {
  DB: D1Database;
  XGUARD_MODEL_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_SOURCE_FEE_MICRO_USD?: string;
  XGUARD_ANALYSIS_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
}

interface ProviderDefinition {
  id: string;
  kind: "MODEL" | "TOOL";
  baseUrl: string;
  auth: "bearer" | "x-api-key" | "x-goog-api-key";
  label: string;
}

const PROVIDERS: Record<string, ProviderDefinition> = {
  openai: {
    id: "openai",
    kind: "MODEL",
    baseUrl: "https://api.openai.com",
    auth: "bearer",
    label: "OpenAI",
  },
  anthropic: {
    id: "anthropic",
    kind: "MODEL",
    baseUrl: "https://api.anthropic.com",
    auth: "x-api-key",
    label: "Anthropic",
  },
  gemini: {
    id: "gemini",
    kind: "MODEL",
    baseUrl: "https://generativelanguage.googleapis.com",
    auth: "x-goog-api-key",
    label: "Google Gemini",
  },
  github: {
    id: "github",
    kind: "TOOL",
    baseUrl: "https://api.github.com",
    auth: "bearer",
    label: "GitHub API",
  },
  slack: {
    id: "slack",
    kind: "TOOL",
    baseUrl: "https://slack.com/api",
    auth: "bearer",
    label: "Slack API",
  },
};

export type GatewayDelegate = (request: Request) => Promise<Response>;

export async function universalGatewayResponse(
  request: Request,
  env: UniversalGatewayEnv,
  delegate: GatewayDelegate,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/gateway")) return null;

  if (url.pathname === "/v1/gateway/capabilities" && request.method === "GET")
    return jsonResponse({
      name: "XGuard Universal Gateway",
      version: 1,
      billing: {
        modelMicroUsd: feeForKind(env, "MODEL"),
        toolMicroUsd: feeForKind(env, "TOOL"),
        sourceMicroUsd: feeForKind(env, "SOURCE"),
        analysisMicroUsd: feeForKind(env, "ANALYSIS"),
        securityMicroUsd: feeForKind(env, "SECURITY"),
        paymentSettlementMicroUsd: "see /.well-known/x402/facilitator.json",
        chargingModel: "prepaid-per-successful-gateway-event",
      },
      gateways: ["payment", "model", "tool", "source", "analysis", "security"],
      providers: Object.values(PROVIDERS).map(({ id, kind, label }) => ({
        id,
        kind: kind.toLowerCase(),
        label,
        byok: true,
      })),
      endpoints: {
        proxy: "/v1/gateway/proxy/{provider}/{upstream-path}",
        sourceSearch: "/v1/gateway/sources/search",
        analyze: "/v1/gateway/analyze",
        securityInspect: "/v1/gateway/security/inspect",
        payment: { verify: "/verify", settle: "/settle" },
      },
    });

  if (url.pathname === "/v1/gateway/quote" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await jsonObject(request);
      const kind = parseKind(body.kind);
      return jsonResponse({ kind, feeMicroUsd: feeForKind(env, kind) });
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
  }

  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  if (url.pathname === "/v1/gateway/security/inspect") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return billLocalOperation(
      request,
      env,
      access.merchant.merchantId,
      "SECURITY",
      "xguard",
      "security.inspect",
      async () => securityInspection(await jsonObject(request)),
    );
  }

  if (url.pathname === "/v1/gateway/analyze") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return billLocalOperation(
      request,
      env,
      access.merchant.merchantId,
      "ANALYSIS",
      "xguard",
      "provider.rank",
      async () => analyzeCandidates(await jsonObject(request)),
    );
  }

  if (url.pathname === "/v1/gateway/sources/search") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return billDelegatedSourceSearch(
      request,
      env,
      access.merchant.merchantId,
      delegate,
    );
  }

  if (url.pathname.startsWith(PROXY_PREFIX))
    return billProviderProxy(request, env, access.merchant.merchantId);

  return jsonResponse({ error: "gateway_endpoint_not_found" }, 404);
}

async function billProviderProxy(
  request: Request,
  env: UniversalGatewayEnv,
  merchantId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const remainder = url.pathname.slice(PROXY_PREFIX.length);
  const slash = remainder.indexOf("/");
  const providerId = (slash === -1 ? remainder : remainder.slice(0, slash)).toLowerCase();
  const suffix = slash === -1 ? "/" : remainder.slice(slash);
  const provider = PROVIDERS[providerId];
  if (provider === undefined) return jsonResponse({ error: "unsupported_gateway_provider" }, 404);
  if (!safeProxySuffix(suffix)) return jsonResponse({ error: "invalid_upstream_path" }, 400);
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS")
    return jsonResponse(
      { error: "proxy_method_not_billable", message: "Use POST, PUT, PATCH or DELETE for provider execution" },
      405,
      { Allow: "POST, PUT, PATCH, DELETE" },
    );

  const upstreamKey = request.headers.get("x-xguard-upstream-key")?.trim() ?? "";
  if (upstreamKey.length < 8 || upstreamKey.length > 4096)
    return jsonResponse({ error: "upstream_key_required" }, 401);

  const requestId = gatewayRequestId(request);
  const operation = `${request.method}:${suffix}`.slice(0, 160);
  const feeMicroUsd = feeForKind(env, provider.kind);
  const reserved = await reserveOrResponse(env, {
    merchantId,
    requestId,
    kind: provider.kind,
    provider: provider.id,
    operation,
    amountMicroUsd: feeMicroUsd,
  });
  if (reserved instanceof Response) return reserved;

  const target = upstreamUrl(provider.baseUrl, suffix, url.search);
  const headers = upstreamHeaders(request.headers, provider, upstreamKey);
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(
      new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }),
    );
  } catch {
    await releaseGatewayFee(env.DB, merchantId, reserved.eventKey).catch(() => undefined);
    return gatewayResponse(
      { error: "upstream_unavailable", provider: provider.id },
      502,
      requestId,
      0,
    );
  }

  const latencyMs = Math.max(0, Date.now() - started);
  if (upstream.status < 200 || upstream.status >= 400) {
    await releaseGatewayFee(env.DB, merchantId, reserved.eventKey).catch(() => undefined);
    return proxiedResponse(upstream, requestId, 0, provider.id, latencyMs);
  }

  await earnGatewayFee(env.DB, {
    merchantId,
    eventKey: reserved.eventKey,
    upstreamStatus: upstream.status,
    latencyMs,
    requestBytes: contentLength(request.headers),
    responseBytes: contentLength(upstream.headers),
  });
  return proxiedResponse(upstream, requestId, feeMicroUsd, provider.id, latencyMs);
}

async function billDelegatedSourceSearch(
  request: Request,
  env: UniversalGatewayEnv,
  merchantId: string,
  delegate: GatewayDelegate,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await jsonObject(request);
  } catch (error) {
    return jsonResponse({ error: errorCode(error) }, 400);
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 240)
    return jsonResponse({ error: "invalid_source_query" }, 400);

  const requestId = gatewayRequestId(request);
  const feeMicroUsd = feeForKind(env, "SOURCE");
  const reserved = await reserveOrResponse(env, {
    merchantId,
    requestId,
    kind: "SOURCE",
    provider: "xguard-catalog",
    operation: "discovery.search",
    amountMicroUsd: feeMicroUsd,
  });
  if (reserved instanceof Response) return reserved;

  const started = Date.now();
  let sourceResponse: Response;
  try {
    const target = new URL(request.url);
    target.pathname = "/discovery/search";
    target.search = `?query=${encodeURIComponent(query)}`;
    sourceResponse = await delegate(new Request(target.toString()));
  } catch {
    await releaseGatewayFee(env.DB, merchantId, reserved.eventKey).catch(() => undefined);
    return gatewayResponse({ error: "source_search_unavailable" }, 503, requestId, 0);
  }

  const latencyMs = Math.max(0, Date.now() - started);
  if (!sourceResponse.ok) {
    await releaseGatewayFee(env.DB, merchantId, reserved.eventKey).catch(() => undefined);
    return proxiedResponse(sourceResponse, requestId, 0, "xguard-catalog", latencyMs);
  }
  await earnGatewayFee(env.DB, {
    merchantId,
    eventKey: reserved.eventKey,
    upstreamStatus: sourceResponse.status,
    latencyMs,
    responseBytes: contentLength(sourceResponse.headers),
  });
  return proxiedResponse(sourceResponse, requestId, feeMicroUsd, "xguard-catalog", latencyMs);
}

async function billLocalOperation(
  request: Request,
  env: UniversalGatewayEnv,
  merchantId: string,
  kind: "ANALYSIS" | "SECURITY",
  provider: string,
  operation: string,
  execute: () => Promise<Record<string, unknown>>,
): Promise<Response> {
  const requestId = gatewayRequestId(request);
  const feeMicroUsd = feeForKind(env, kind);
  const reserved = await reserveOrResponse(env, {
    merchantId,
    requestId,
    kind,
    provider,
    operation,
    amountMicroUsd: feeMicroUsd,
  });
  if (reserved instanceof Response) return reserved;

  const started = Date.now();
  try {
    const result = await execute();
    const latencyMs = Math.max(0, Date.now() - started);
    await earnGatewayFee(env.DB, {
      merchantId,
      eventKey: reserved.eventKey,
      upstreamStatus: 200,
      latencyMs,
      requestBytes: contentLength(request.headers),
    });
    return gatewayResponse(result, 200, requestId, feeMicroUsd, {
      "X-XGuard-Gateway-Kind": kind.toLowerCase(),
    });
  } catch (error) {
    await releaseGatewayFee(env.DB, merchantId, reserved.eventKey).catch(() => undefined);
    return gatewayResponse({ error: errorCode(error) }, 400, requestId, 0);
  }
}

async function reserveOrResponse(
  env: UniversalGatewayEnv,
  input: {
    merchantId: string;
    requestId: string;
    kind: GatewayEventKind;
    provider: string;
    operation: string;
    amountMicroUsd: number;
  },
): Promise<Awaited<ReturnType<typeof reserveGatewayFee>> | Response> {
  try {
    return await reserveGatewayFee(env.DB, input);
  } catch (error) {
    const code = errorCode(error);
    if (code === "insufficient_service_balance")
      return gatewayResponse(
        {
          error: code,
          message: "Top up the XGuard prepaid service balance before executing billable gateway traffic",
        },
        402,
        input.requestId,
        0,
      );
    if (code === "gateway_event_already_earned" || code === "gateway_event_in_progress")
      return gatewayResponse({ error: code }, 409, input.requestId, 0);
    return gatewayResponse({ error: code }, 400, input.requestId, 0);
  }
}

function securityInspection(body: Record<string, unknown>): Record<string, unknown> {
  const flags: string[] = [];
  const targetRaw = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
  if (targetRaw !== "") {
    let target: URL;
    try {
      target = new URL(targetRaw);
    } catch {
      throw new Error("invalid_target_url");
    }
    if (target.protocol !== "https:") flags.push("PLAINTEXT_TARGET");
    if (isPrivateHostname(target.hostname)) flags.push("PRIVATE_OR_LOCAL_TARGET");
    for (const key of target.searchParams.keys())
      if (/token|secret|password|api[_-]?key|authorization/i.test(key)) {
        flags.push("CREDENTIAL_IN_QUERY");
        break;
      }
  }

  const method = typeof body.method === "string" ? body.method.toUpperCase() : "GET";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) flags.push("MUTATING_REQUEST");
  const headerNames = Array.isArray(body.headerNames)
    ? body.headerNames.filter((value): value is string => typeof value === "string")
    : [];
  if (headerNames.some((name) => /authorization|api-key|x-api-key|cookie/i.test(name)))
    flags.push("CREDENTIAL_BEARING_REQUEST");

  const denied = flags.includes("PLAINTEXT_TARGET") || flags.includes("PRIVATE_OR_LOCAL_TARGET");
  const decision = denied ? "DENY" : flags.length > 0 ? "REVIEW" : "ALLOW";
  return {
    decision,
    flags: [...new Set(flags)],
    risk: decision === "DENY" ? "high" : decision === "REVIEW" ? "medium" : "low",
    inspectedAt: new Date().toISOString(),
  };
}

function analyzeCandidates(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.candidates) || body.candidates.length === 0)
    throw new Error("analysis_candidates_required");
  if (body.candidates.length > MAX_ANALYSIS_CANDIDATES)
    throw new Error("too_many_analysis_candidates");

  const candidates = body.candidates.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("invalid_analysis_candidate");
    const row = value as Record<string, unknown>;
    const provider = typeof row.provider === "string" ? row.provider.trim() : "";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(provider))
      throw new Error("invalid_analysis_provider");
    return {
      index,
      provider,
      latencyMs: boundedNumber(row.latencyMs, 0, 120_000, "latencyMs"),
      costMicroUsd: boundedNumber(row.costMicroUsd, 0, 1_000_000_000, "costMicroUsd"),
      errorRateBps: boundedNumber(row.errorRateBps, 0, 10_000, "errorRateBps"),
      qualityBps: boundedNumber(row.qualityBps, 0, 10_000, "qualityBps"),
    };
  });

  const maxLatency = Math.max(1, ...candidates.map((candidate) => candidate.latencyMs));
  const maxCost = Math.max(1, ...candidates.map((candidate) => candidate.costMicroUsd));
  const ranked = candidates
    .map((candidate) => {
      const quality = candidate.qualityBps / 10_000;
      const reliability = (10_000 - candidate.errorRateBps) / 10_000;
      const latency = 1 - candidate.latencyMs / maxLatency;
      const cost = 1 - candidate.costMicroUsd / maxCost;
      const scoreBps = Math.round(
        (quality * 0.4 + reliability * 0.3 + latency * 0.15 + cost * 0.15) * 10_000,
      );
      return { ...candidate, scoreBps };
    })
    .sort((a, b) => b.scoreBps - a.scoreBps || a.index - b.index)
    .map(({ index: _index, ...candidate }) => candidate);

  return {
    selected: ranked[0],
    ranked,
    weights: { quality: 0.4, reliability: 0.3, latency: 0.15, cost: 0.15 },
  };
}

function upstreamUrl(baseUrl: string, suffix: string, search: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith("/") ? base.pathname.slice(0, -1) : base.pathname;
  base.pathname = `${basePath}${suffix}`;
  base.search = search;
  return base.toString();
}

function upstreamHeaders(
  source: Headers,
  provider: ProviderDefinition,
  upstreamKey: string,
): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "x-xguard-upstream-key" ||
      lower === "x-xguard-request-id" ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "cookie" ||
      lower === "accept-encoding" ||
      lower.startsWith("cf-") ||
      lower.startsWith("x-forwarded-")
    )
      continue;
    headers.set(name, value);
  }
  if (provider.auth === "bearer") headers.set("Authorization", `Bearer ${upstreamKey}`);
  if (provider.auth === "x-api-key") headers.set("x-api-key", upstreamKey);
  if (provider.auth === "x-goog-api-key") headers.set("x-goog-api-key", upstreamKey);
  if (provider.id === "github" && !headers.has("User-Agent"))
    headers.set("User-Agent", "XGuard-Universal-Gateway/1.0");
  return headers;
}

function proxiedResponse(
  upstream: Response,
  requestId: string,
  feeMicroUsd: number,
  provider: string,
  latencyMs: number,
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.set("X-XGuard-Request-Id", requestId);
  headers.set("X-XGuard-Fee-Micro-Usd", String(feeMicroUsd));
  headers.set("X-XGuard-Provider", provider);
  headers.set("X-XGuard-Upstream-Latency-Ms", String(latencyMs));
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}

function gatewayResponse(
  value: Record<string, unknown>,
  status: number,
  requestId: string,
  feeMicroUsd: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse(value, status, {
    "X-XGuard-Request-Id": requestId,
    "X-XGuard-Fee-Micro-Usd": String(feeMicroUsd),
    ...extraHeaders,
  });
}

function feeForKind(env: UniversalGatewayEnv, kind: GatewayEventKind): number {
  const raw =
    kind === "MODEL"
      ? env.XGUARD_MODEL_FEE_MICRO_USD ?? "10"
      : kind === "TOOL"
        ? env.XGUARD_TOOL_FEE_MICRO_USD ?? "10"
        : kind === "SOURCE"
          ? env.XGUARD_SOURCE_FEE_MICRO_USD ?? "25"
          : kind === "ANALYSIS"
            ? env.XGUARD_ANALYSIS_FEE_MICRO_USD ?? "50"
            : env.XGUARD_SECURITY_FEE_MICRO_USD ?? "5";
  if (!/^[0-9]+$/.test(raw)) throw new Error("invalid_gateway_fee_config");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000)
    throw new Error("invalid_gateway_fee_config");
  return value;
}

function gatewayRequestId(request: Request): string {
  const supplied = request.headers.get("x-xguard-request-id")?.trim();
  if (supplied !== undefined && supplied !== null && supplied !== "") {
    if (!/^[A-Za-z0-9._:-]{8,96}$/.test(supplied))
      throw new Error("invalid_gateway_request_id");
    return supplied;
  }
  return crypto.randomUUID();
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (contentType !== "application/json") throw new Error("application_json_required");
  const declared = contentLength(request.headers);
  if (declared > MAX_JSON_BODY_BYTES) throw new Error("request_body_too_large");
  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) throw new Error("request_body_too_large");
  const value = JSON.parse(text) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("json_object_required");
  return value as Record<string, unknown>;
}

function parseKind(value: unknown): GatewayEventKind {
  if (typeof value !== "string") throw new Error("gateway_kind_required");
  const kind = value.toUpperCase();
  if (!["MODEL", "TOOL", "SOURCE", "ANALYSIS", "SECURITY"].includes(kind))
    throw new Error("invalid_gateway_kind");
  return kind as GatewayEventKind;
}

function safeProxySuffix(value: string): boolean {
  return (
    value.startsWith("/") &&
    value.length <= 1024 &&
    !value.includes("\\") &&
    !/(^|\/)\.\.?($|\/)/.test(value) &&
    !/%2e/i.test(value)
  );
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
    return true;
  if (host === "169.254.169.254" || host === "0.0.0.0" || host === "::1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function contentLength(headers: Headers): number {
  const raw = headers.get("content-length");
  if (raw === null || !/^[0-9]+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function boundedNumber(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`invalid_${field}`);
  return value;
}

function methodNotAllowed(allow: string): Response {
  return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
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
  if (error instanceof Error && /^[A-Za-z0-9_:-]+$/.test(error.message))
    return error.message;
  return "gateway_error";
}
