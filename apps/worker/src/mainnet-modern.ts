import modernCore, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern-core.js";
import {
  autoInvokeResponse,
  rewrapProviderCredentials,
} from "./auto-invoke.js";
import { writeEndpointDiscoveryResponse } from "./mainnet-endpoint-discovery.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  settlementTruthResponse,
  settlementTruthStateForPayment,
  type SettlementTruthEnv,
} from "./mainnet-settlement-truth.js";
import { universalGatewayResponse } from "./universal-gateway.js";
import { releaseStaleGatewayHolds } from "./universal-gateway-billing.js";
import { watchdogGuardResponse } from "./watchdog-store.js";
import {
  adaptCompatibilityResponse,
  augmentSupportedCompatibility,
  normalizeX402CompatibilityRequest,
  type CompatibilityRequest,
} from "./x402-compatibility-bridge.js";
import { augmentCompatibilityDiscovery } from "./x402-compatibility-discovery.js";
import { x402HttpCompatibilityResponse } from "./x402-http-compatibility-bridge.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface MainnetModernEnv extends SettlementTruthEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER: RateLimit;
  BASE_RPC_URL: string;
  XGUARD_FEE_MICRO_USD: string;
  XPAY_DOWNSTREAM_COST_MICRO_USD?: string;
  PAYAI_DOWNSTREAM_COST_MICRO_USD?: string;
  XGUARD_MODEL_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_SOURCE_FEE_MICRO_USD?: string;
  XGUARD_ANALYSIS_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
  [key: string]: unknown;
}

type CoreFetch = (
  request: Request,
  env: MainnetModernEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type CoreScheduled = (
  controller: ScheduledController,
  env: MainnetModernEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = modernCore.fetch as unknown as CoreFetch;
const delegateScheduled = modernCore.scheduled as unknown as CoreScheduled;
const HSTS_VALUE = "max-age=31536000; includeSubDomains";
const GATEWAY_STALE_HOLD_MS = 60 * 60 * 1000;
const GATEWAY_STALE_HOLD_LIMIT = 50;
const SETTLEMENT_TRUTH_PATH =
  /^\/v1\/settlements\/[0-9a-fA-F]{64}\/(truth|resolve)$/;
const BLOCKED_METADATA_SEGMENTS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  ".aws",
  ".ssh",
]);
const BLOCKED_SECRET_FILES = new Set([".ds_store", "id_rsa", "id_ed25519"]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;
    const standardUrl = new URL(standardRequest.url);

    const sensitiveProbe = sensitivePathProbeResponse(
      standardRequest,
      standardUrl,
    );
    if (sensitiveProbe !== null) return secureResponse(sensitiveProbe);

    const endpointDiscovery = writeEndpointDiscoveryResponse(standardRequest);
    if (endpointDiscovery !== null) return secureResponse(endpointDiscovery);

    const watchdog = await watchdogGuardResponse(standardRequest, env.DB);
    if (watchdog !== null) {
      console.warn(
        JSON.stringify({
          event: "watchdog_circuit_open",
          route: watchdog.headers.get("X-XGuard-Watchdog-Route"),
        }),
      );
      return secureResponse(watchdog);
    }

    const truthResponse = await routeSettlementTruth(standardRequest, env);
    if (truthResponse !== null) return secureResponse(truthResponse);

    const httpCompatibility = await x402HttpCompatibilityResponse(
      standardRequest,
      env,
    );
    if (httpCompatibility !== null) return secureResponse(httpCompatibility);

    if (standardUrl.pathname === "/" && standardRequest.method === "POST") {
      const discoveryRequest = new Request(standardRequest.url, {
        method: "GET",
        headers: standardRequest.headers,
      });
      const discoveryResponse = await delegateFetch(discoveryRequest, env, ctx);
      const headers = new Headers(discoveryResponse.headers);
      headers.set("X-XGuard-Discovery", "root-post");
      headers.set("Cache-Control", "no-store");
      return secureResponse(
        new Response(discoveryResponse.body, {
          status: discoveryResponse.status,
          statusText: discoveryResponse.statusText,
          headers,
        }),
      );
    }

    let compatibility: CompatibilityRequest | null = null;
    let effectiveRequest = standardRequest;

    try {
      compatibility = await normalizeX402CompatibilityRequest(standardRequest);
      if (compatibility !== null) effectiveRequest = compatibility.request;
    } catch (error) {
      return secureResponse(
        compatibilityErrorResponse(
          error instanceof Error
            ? error.message
            : "compatibility_bridge_failed",
        ),
      );
    }

    const rotated = await rotateCredentialWithVaultRewrap(
      effectiveRequest,
      env,
      ctx,
    );
    if (rotated !== null) return secureResponse(rotated);

    const automatic = await autoInvokeResponse(effectiveRequest, env);
    if (automatic !== null) return secureResponse(automatic);

    const gateway = await universalGatewayResponse(
      effectiveRequest,
      env,
      async (internalRequest) => delegateFetch(internalRequest, env, ctx),
    );
    if (gateway !== null) return secureResponse(gateway);

    let response = await delegateFetch(effectiveRequest, env, ctx);
    const url = new URL(effectiveRequest.url);
    if (effectiveRequest.method === "GET" && url.pathname === "/supported")
      response = await augmentSupportedCompatibility(response);
    if (effectiveRequest.method === "GET")
      response = await augmentCompatibilityDiscovery(response, url.pathname);
    response = await adaptCompatibilityResponse(response, compatibility);
    if (effectiveRequest.method === "POST" && url.pathname === "/settle")
      response = await attachSettlementTruthHeaders(response, env.DB);
    return secureResponse(response);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
    const recovery = await releaseStaleGatewayHolds(env.DB, {
      nowMs:
        typeof controller.scheduledTime === "number"
          ? controller.scheduledTime
          : Date.now(),
      staleAfterMs: GATEWAY_STALE_HOLD_MS,
      limit: GATEWAY_STALE_HOLD_LIMIT,
    });
    if (recovery.scanned > 0)
      console.log(
        JSON.stringify({
          event: "gateway_stale_hold_recovery",
          ...recovery,
        }),
      );
  },
} satisfies ExportedHandler<MainnetModernEnv>;

function sensitivePathProbeResponse(
  request: Request,
  url: URL,
): Response | null {
  const normalizedPath = normalizeSecurityPath(url.pathname);
  const segments = normalizedPath.split("/").filter(Boolean);
  const blocked = segments.some(
    (segment) =>
      BLOCKED_METADATA_SEGMENTS.has(segment) ||
      BLOCKED_SECRET_FILES.has(segment) ||
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment.startsWith(".env-") ||
      segment.startsWith(".env_"),
  );
  if (!blocked) return null;

  console.warn(
    JSON.stringify({
      event: "sensitive_path_probe_blocked",
      method: request.method,
      pathClass: "repository_or_secret_metadata",
    }),
  );

  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizeSecurityPath(pathname: string): string {
  let decoded = pathname;
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  const stack: string[] = [];
  for (const rawSegment of decoded.replace(/\\/g, "/").split("/")) {
    const segment = rawSegment.trim().toLowerCase();
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join("/")}`;
}

async function routeSettlementTruth(
  request: Request,
  env: MainnetModernEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!SETTLEMENT_TRUTH_PATH.test(url.pathname)) return null;
  const access = await authorizeMerchantScope(request, env, "settle");
  if (!access.ok) return access.response;
  try {
    return await settlementTruthResponse(
      request,
      env,
      access.merchant.merchantId,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "settlement_truth_request_failed",
        code: errorCode(error),
      }),
    );
    return jsonResponse({ error: "settlement_truth_unavailable" }, 503);
  }
}

async function attachSettlementTruthHeaders(
  response: Response,
  db: D1Database,
): Promise<Response> {
  const logicalPaymentKey = response.headers
    .get("X-XGuard-Payment-Key")
    ?.toLowerCase();
  if (
    logicalPaymentKey === undefined ||
    !/^[0-9a-f]{64}$/.test(logicalPaymentKey)
  )
    return response;

  const state = await settlementTruthStateForPayment(
    db,
    logicalPaymentKey,
  ).catch(() => null);
  if (state === null) return response;

  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Truth-State", state);
  headers.set(
    "X-XGuard-Truth-Endpoint",
    `/v1/settlements/${logicalPaymentKey}/truth`,
  );
  headers.set(
    "X-XGuard-Resolve-Endpoint",
    `/v1/settlements/${logicalPaymentKey}/resolve`,
  );
  headers.set(
    "X-XGuard-Release-Safe",
    state === "FINALIZED" ? "true" : "false",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rotateCredentialWithVaultRewrap(
  request: Request,
  env: MainnetModernEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/api-key/rotate")
    return null;
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return delegateFetch(request, env, ctx);
  const oldToken = authorization.slice("Bearer ".length).trim();
  if (!/^xg_live_[A-Za-z0-9_-]{40,}$/.test(oldToken))
    return delegateFetch(request, env, ctx);
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;
  const response = await delegateFetch(request, env, ctx);
  if (response.status !== 201) return response;
  let payload: Record<string, unknown>;
  try {
    const parsed = (await response.clone().json()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return response;
    payload = parsed as Record<string, unknown>;
  } catch {
    return response;
  }
  const newToken = typeof payload.apiKey === "string" ? payload.apiKey : "";
  if (!/^xg_live_[A-Za-z0-9_-]{40,}$/.test(newToken)) return response;
  try {
    const count = await rewrapProviderCredentials(
      env.DB,
      access.merchant.merchantId,
      oldToken,
      newToken,
    );
    const headers = new Headers(response.headers);
    headers.set("X-XGuard-Vault-Rewrapped", String(count));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    payload.providerVaultRewrap = "failed";
    payload.warning =
      "The XGuard key rotated, but linked provider credentials could not be rewrapped. Keep the new key and relink providers before model traffic.";
    return new Response(JSON.stringify(payload, null, 2), {
      status: 201,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-XGuard-Vault-Rewrap": "failed",
      },
    });
  }
}

function compatibilityErrorResponse(code: string): Response {
  return new Response(
    JSON.stringify({
      error: "x402_compatibility_rejected",
      reason: code,
      supportedLegacy: {
        x402Version: 1,
        scheme: "exact",
        network: "base",
        asset: "native Base USDC",
      },
      canonical: {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
      },
    }),
    {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-XGuard-Compatibility": "rejected",
      },
    },
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.name === "AbortError"
    ? "AbortError"
    : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
