import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  earnGatewayFee,
  releaseGatewayFee,
  reserveGatewayFee,
} from "./universal-gateway-billing.js";

const CONNECTOR_PATH = "/v1/gateway/http";
const DEFAULT_TOOL_FEE_MICRO_USD = 200;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FORWARD_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-encoding",
  "if-match",
  "if-none-match",
  "idempotency-key",
  "prefer",
  "range",
]);
const ALWAYS_BLOCKED_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "referer",
  "set-cookie",
  "proxy-authorization",
  "proxy-authenticate",
  "connection",
  "upgrade",
  "transfer-encoding",
]);
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "host.docker.internal",
]);
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".onion",
];

interface GenericHttpConnectorEnv {
  DB: D1Database;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
}

export async function genericHttpConnectorResponse(
  request: Request,
  env: GenericHttpConnectorEnv,
): Promise<Response | null> {
  const route = new URL(request.url);
  if (route.pathname !== CONNECTOR_PATH) return null;

  if (!ALLOWED_METHODS.has(request.method))
    return jsonResponse({ error: "generic_connector_method_not_supported" }, 405, {
      Allow: [...ALLOWED_METHODS].join(", "),
    });

  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

  const targetHeader = request.headers.get("x-xguard-upstream-url")?.trim() ?? "";
  const target = safeGenericHttpsTarget(targetHeader);
  if (target === null)
    return jsonResponse(
      {
        error: "unsafe_or_invalid_upstream_url",
        rule:
          "Use a public HTTPS hostname on port 443. IP literals, localhost/private naming, URL credentials, and non-HTTPS targets are rejected.",
      },
      400,
    );

  const bodyLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(bodyLength) && bodyLength > MAX_BODY_BYTES)
    return jsonResponse({ error: "generic_connector_body_too_large" }, 413);

  const requestId = connectorRequestId(request);
  const feeMicroUsd = toolFee(env);
  const operation = `${request.method}:${target.pathname}`.slice(0, 160);
  let reservation;
  try {
    reservation = await reserveGatewayFee(env.DB, {
      merchantId: access.merchant.merchantId,
      requestId,
      kind: "TOOL",
      provider: `https:${target.hostname}`.slice(0, 120),
      operation,
      amountMicroUsd: feeMicroUsd,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "insufficient_service_balance")
      return jsonResponse(
        {
          error: code,
          requiredFeeMicroUsd: feeMicroUsd,
          topUpEndpoint: "/v1/topups/intents",
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

  const upstreamHeaders = buildUpstreamHeaders(request.headers);
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(
      new Request(target.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? null
            : request.body,
        redirect: "manual",
      }),
    );
  } catch {
    await releaseGatewayFee(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    ).catch(() => undefined);
    return connectorResponse(
      { error: "generic_upstream_unavailable", hostname: target.hostname },
      502,
      requestId,
      0,
      target.hostname,
      0,
      "released",
    );
  }

  const latencyMs = Math.max(0, Date.now() - started);
  if (upstream.status >= 300 && upstream.status < 400) {
    await releaseGatewayFee(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    ).catch(() => undefined);
    return connectorResponse(
      {
        error: "generic_upstream_redirect_rejected",
        hostname: target.hostname,
        upstreamStatus: upstream.status,
      },
      502,
      requestId,
      0,
      target.hostname,
      latencyMs,
      "released",
    );
  }

  if (upstream.status < 200 || upstream.status >= 300) {
    await releaseGatewayFee(
      env.DB,
      access.merchant.merchantId,
      reservation.eventKey,
    ).catch(() => undefined);
    return proxiedResponse(
      upstream,
      requestId,
      0,
      target.hostname,
      latencyMs,
      "released",
    );
  }

  let accounting = "earned";
  try {
    await earnGatewayFee(env.DB, {
      merchantId: access.merchant.merchantId,
      eventKey: reservation.eventKey,
      upstreamStatus: upstream.status,
      latencyMs,
      requestBytes: contentLength(request.headers),
      responseBytes: contentLength(upstream.headers),
    });
  } catch {
    accounting = "accounting_pending";
  }

  return proxiedResponse(
    upstream,
    requestId,
    accounting === "earned" ? feeMicroUsd : 0,
    target.hostname,
    latencyMs,
    accounting,
  );
}

export function safeGenericHttpsTarget(raw: string): URL | null {
  if (raw.length < 12 || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.port !== "" && url.port !== "443") return null;
  if (url.hash !== "") return null;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "" || hostname.length > 253) return null;
  if (BLOCKED_HOSTS.has(hostname)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return null;
  if (isIpLiteral(hostname)) return null;
  if (!hostname.includes(".")) return null;

  return url;
}

function buildUpstreamHeaders(incoming: Headers): Headers {
  const outgoing = new Headers();
  for (const header of SAFE_FORWARD_HEADERS) {
    const value = incoming.get(header);
    if (value !== null) outgoing.set(header, value);
  }

  const requested = incoming
    .get("x-xguard-forward-headers")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24) ?? [];
  for (const header of requested) {
    if (!safeCustomHeaderName(header)) continue;
    const value = incoming.get(header);
    if (value !== null && value.length <= 8192) outgoing.set(header, value);
  }

  const credential = incoming.get("x-xguard-upstream-key")?.trim() ?? "";
  if (credential !== "") {
    if (credential.length > 4096) throw new Error("upstream_credential_too_large");
    const authHeader = (
      incoming.get("x-xguard-upstream-auth-header")?.trim() || "authorization"
    ).toLowerCase();
    if (!safeAuthHeaderName(authHeader))
      throw new Error("invalid_upstream_auth_header");
    const scheme = (
      incoming.get("x-xguard-upstream-auth-scheme")?.trim().toLowerCase() ||
      "bearer"
    );
    if (scheme !== "bearer" && scheme !== "raw")
      throw new Error("invalid_upstream_auth_scheme");
    outgoing.set(authHeader, scheme === "bearer" ? `Bearer ${credential}` : credential);
  }

  outgoing.set("user-agent", "XGuard-Universal-Connector/1.0");
  return outgoing;
}

function safeCustomHeaderName(name: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return false;
  if (name.startsWith("x-xguard-")) return false;
  if (name.startsWith("cf-")) return false;
  return !ALWAYS_BLOCKED_FORWARD_HEADERS.has(name);
}

function safeAuthHeaderName(name: string): boolean {
  if (name === "authorization") return true;
  return safeCustomHeaderName(name);
}

function isIpLiteral(hostname: string): boolean {
  const raw = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (raw.includes(":")) return true;
  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function connectorRequestId(request: Request): string {
  for (const name of ["x-request-id", "idempotency-key", "x-idempotency-key"]) {
    const value = request.headers.get(name)?.trim();
    if (value !== undefined && /^[A-Za-z0-9._:-]{8,96}$/.test(value)) return value;
  }
  return crypto.randomUUID();
}

function toolFee(env: GenericHttpConnectorEnv): number {
  const raw = env.XGUARD_TOOL_FEE_MICRO_USD?.trim();
  if (raw === undefined || raw === "") return DEFAULT_TOOL_FEE_MICRO_USD;
  if (!/^\d+$/.test(raw)) throw new Error("invalid_xguard_tool_fee");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000)
    throw new Error("invalid_xguard_tool_fee");
  return value;
}

function proxiedResponse(
  upstream: Response,
  requestId: string,
  feeMicroUsd: number,
  hostname: string,
  latencyMs: number,
  accounting: string,
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.delete("location");
  headers.delete("www-authenticate");
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("X-XGuard-Request-ID", requestId);
  headers.set("X-XGuard-Connector", "generic-https");
  headers.set("X-XGuard-Upstream-Host", hostname);
  headers.set("X-XGuard-Latency-MS", String(latencyMs));
  headers.set("X-XGuard-Fee-Micro-USD", String(feeMicroUsd));
  headers.set("X-XGuard-Accounting", accounting);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function connectorResponse(
  value: unknown,
  status: number,
  requestId: string,
  feeMicroUsd: number,
  hostname: string,
  latencyMs: number,
  accounting: string,
): Response {
  const response = jsonResponse(value, status);
  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Request-ID", requestId);
  headers.set("X-XGuard-Connector", "generic-https");
  headers.set("X-XGuard-Upstream-Host", hostname);
  headers.set("X-XGuard-Latency-MS", String(latencyMs));
  headers.set("X-XGuard-Fee-Micro-USD", String(feeMicroUsd));
  headers.set("X-XGuard-Accounting", accounting);
  return new Response(response.body, { status, headers });
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

function contentLength(headers: Headers): number {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "generic_connector_error";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
