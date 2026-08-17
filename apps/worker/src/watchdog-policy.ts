const WINDOW_MS = 60_000;

export type WatchdogSeverity = "medium" | "high" | "critical";

export interface WatchdogSignal {
  fingerprint: string;
  category: string;
  severity: WatchdogSeverity;
  scriptName: string;
  routeKey: string | null;
  method: string | null;
  path: string | null;
  outcome: string | null;
  httpStatus: number | null;
  errorCode: string;
  observedAtMs: number;
  protectedRoute: boolean;
  threshold: number;
  windowMs: number;
}

export interface TailEventLike {
  scriptName?: string;
  eventTimestamp?: number;
  outcome?: string;
  event?: unknown;
  logs?: unknown[];
  exceptions?: unknown[];
}

const CRITICAL_OUTCOMES = new Set([
  "exception",
  "exceededCpu",
  "exceededMemory",
  "scriptNotFound",
  "canceled",
  "cancelled",
]);

const SENSITIVE_EXACT_PATHS = new Set([
  "/v1/register",
  "/v1/topups/intents",
  "/v1/topups/claim",
  "/v1/api-key/rotate",
  "/verify",
  "/settle",
  "/v1/messages",
  "/v1/chat/completions",
  "/v1/responses",
]);

export function canonicalRouteKey(
  method: string | null,
  path: string | null,
): string | null {
  if (method === null || path === null) return null;
  let canonicalPath = path;
  canonicalPath = canonicalPath.replace(
    /^\/v1\/settlements\/[0-9a-fA-F]{64}\/(truth|resolve)$/,
    "/v1/settlements/:logicalPaymentKey/$1",
  );
  if (canonicalPath.startsWith("/v1/gateway/proxy/"))
    canonicalPath = "/v1/gateway/proxy/:provider/*";
  if (canonicalPath.startsWith("/v1beta/openai/"))
    canonicalPath = "/v1beta/openai/*";
  return `${method.toUpperCase()}:${canonicalPath}`;
}

export function isProtectedWriteRoute(
  method: string | null,
  path: string | null,
): boolean {
  if (method === null || path === null) return false;
  const upper = method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(upper)) return false;
  if (SENSITIVE_EXACT_PATHS.has(path)) return true;
  if (path.startsWith("/v1/gateway/")) return true;
  if (path.startsWith("/v1beta/openai/")) return true;
  if (/^\/v1\/settlements\/[0-9a-fA-F]{64}\/resolve$/.test(path)) return true;
  return false;
}

export async function classifyTailEvent(
  item: TailEventLike,
  producerScript: string,
): Promise<WatchdogSignal | null> {
  const scriptName = item.scriptName ?? "unknown";
  if (scriptName !== producerScript) return null;

  const fetch = extractFetch(item.event);
  const method = fetch.method;
  const path = fetch.path;
  const status = fetch.status;
  const outcome = typeof item.outcome === "string" ? item.outcome : null;
  if (status === 503 && outcome === "ok" && hasWatchdogCircuitMarker(item.logs))
    return null;

  const exceptionCode = firstExceptionCode(item.exceptions);
  const logError = firstErrorLogCode(item.logs);
  const clientErrorStatus = status !== null && status >= 400 && status < 500;

  let category: string | null = null;
  let severity: WatchdogSeverity = "medium";
  let errorCode = "unknown_runtime_error";
  let threshold = 5;

  if (outcome !== null && CRITICAL_OUTCOMES.has(outcome)) {
    category = "worker_runtime_failure";
    severity = "critical";
    errorCode = exceptionCode ?? outcome;
    threshold = 2;
  } else if (exceptionCode !== null) {
    category = "worker_exception";
    severity = "critical";
    errorCode = exceptionCode;
    threshold = 2;
  } else if (status !== null && status >= 500) {
    category = "http_5xx";
    severity = "high";
    errorCode = logError ?? `http_${status}`;
    threshold = 5;
  } else if (status === 404 && path !== null && advertisedPath(path)) {
    category = "advertised_endpoint_404";
    severity = "medium";
    errorCode = "advertised_endpoint_404";
    threshold = 8;
  } else if (logError !== null && !clientErrorStatus) {
    category = "application_error_log";
    severity = "high";
    errorCode = logError;
    threshold = 4;
  }

  if (category === null) return null;

  const routeKey = canonicalRouteKey(method, path);
  const observedAtMs =
    typeof item.eventTimestamp === "number" &&
    Number.isFinite(item.eventTimestamp)
      ? item.eventTimestamp
      : Date.now();
  const protectedRoute = isProtectedWriteRoute(method, path);
  const fingerprint = await sha256Hex(
    [category, routeKey ?? "unknown-route", errorCode].join("|"),
  );

  return {
    fingerprint,
    category,
    severity,
    scriptName,
    routeKey,
    method,
    path,
    outcome,
    httpStatus: status,
    errorCode,
    observedAtMs,
    protectedRoute,
    threshold,
    windowMs: WINDOW_MS,
  };
}

function extractFetch(value: unknown): {
  method: string | null;
  path: string | null;
  status: number | null;
} {
  const event = record(value);
  const request = record(event?.request);
  const response = record(event?.response);
  const method = stringValue(request?.method);
  const url = stringValue(request?.url);
  const status = numberValue(response?.status);
  let path: string | null = null;
  if (url !== null) {
    try {
      path = new URL(url).pathname;
    } catch {
      path = null;
    }
  }
  return { method, path, status };
}

function hasWatchdogCircuitMarker(values: unknown[] | undefined): boolean {
  if (!Array.isArray(values)) return false;
  for (const value of values) {
    const item = record(value);
    const messageValue = item?.message;
    const parts = Array.isArray(messageValue) ? messageValue : [messageValue];
    for (const part of parts) {
      if (
        typeof part === "string" &&
        part.includes('"event":"watchdog_circuit_open"')
      )
        return true;
    }
  }
  return false;
}

function firstExceptionCode(values: unknown[] | undefined): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const item = record(value);
    const name = stringValue(item?.name);
    const message = stringValue(item?.message);
    if (name !== null || message !== null)
      return sanitizeCode(name ?? message ?? "worker_exception");
  }
  return null;
}

function firstErrorLogCode(values: unknown[] | undefined): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const item = record(value);
    const level = stringValue(item?.level)?.toLowerCase();
    if (level !== "error") continue;
    const messageValue = item?.message;
    if (Array.isArray(messageValue)) {
      const text = messageValue
        .filter((part): part is string => typeof part === "string")
        .join(" ");
      if (text.length > 0) return sanitizeCode(text);
    }
    const message = stringValue(messageValue);
    if (message !== null) return sanitizeCode(message);
  }
  return null;
}

function advertisedPath(path: string): boolean {
  return (
    path.startsWith("/.well-known/") ||
    path === "/openapi.json" ||
    path === "/mcp" ||
    path === "/v1/register" ||
    path === "/supported"
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeCode(value: string): string {
  return value.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
