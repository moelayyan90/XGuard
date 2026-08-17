import mainnetModern, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern.js";
import { merchantBalance } from "./mainnet-billing.js";
import {
  classifyMcpToolCall,
  configuredFee,
  feeForMcpKind,
  type McpBillingDescriptor,
} from "./monetization-policy.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  reserveGatewayFee,
  type GatewayEventKind,
} from "./universal-gateway-billing.js";
import {
  finalizeGatewayExecutionSuccess,
  releaseGatewayExecutionReservation,
} from "./universal-gateway.js";
import {
  adaptCompatibilityResponse,
  normalizeX402CompatibilityRequest,
  type CompatibilityRequest,
} from "./x402-compatibility-bridge.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface MonetizedMainnetEnv {
  DB: D1Database;
  XGUARD_FEE_MICRO_USD: string;
  XGUARD_VERIFY_FEE_MICRO_USD?: string;
  XGUARD_MODEL_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_SOURCE_FEE_MICRO_USD?: string;
  XGUARD_ANALYSIS_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
  [key: string]: unknown;
}

type CoreFetch = (
  request: Request,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
) => Promise<Response>;

type CoreScheduled = (
  controller: ScheduledController,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = mainnetModern.fetch as unknown as CoreFetch;
const delegateScheduled = mainnetModern.scheduled as unknown as CoreScheduled;
const MCP_BODY_LIMIT = 128 * 1024;
const BILLABLE_DISCOVERY_PATHS = new Map<string, string>([
  ["/discovery/search", "discovery.search"],
  ["/discovery/resources", "discovery.resources"],
]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/verify")
      return billVerify(request, env, ctx);

    if (request.method === "GET") {
      const operation = BILLABLE_DISCOVERY_PATHS.get(url.pathname);
      if (operation !== undefined)
        return billDirectDiscovery(request, env, ctx, operation);
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const descriptor = await inspectMcpBillingDescriptor(request);
      if (descriptor !== null)
        return billMcpToolCall(request, env, ctx, descriptor);
    }

    return delegateFetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<MonetizedMainnetEnv>;

async function billVerify(
  request: Request,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  // Authentication is deliberately first. Compatibility parsing can reject
  // malformed or unsupported legacy envelopes, so running it before this
  // boundary leaks protocol behavior to anonymous traffic and lets malformed
  // requests bypass the prepaid merchant access contract.
  const access = await authorizeMerchantScope(request, env, "verify");
  if (!access.ok) {
    logEconomicTraffic({
      request,
      operation: "verify",
      trafficClass: "anonymous_or_unregistered",
      outcome: "blocked_before_execution",
      billable: false,
      feeMicroUsd: 0,
    });
    return access.response;
  }

  let compatibility: CompatibilityRequest | null = null;
  let effectiveRequest = request;

  try {
    compatibility = await normalizeX402CompatibilityRequest(request);
    if (compatibility !== null) effectiveRequest = compatibility.request;
  } catch {
    // The caller is authenticated, so it is now safe to reuse the canonical
    // compatibility rejection boundary. Invalid legacy traffic never reserves
    // or earns a monetization fee.
    logEconomicTraffic({
      request,
      operation: "verify",
      trafficClass: "authenticated_merchant",
      outcome: "compatibility_rejected",
      billable: false,
      feeMicroUsd: 0,
      merchantId: access.merchant.merchantId,
    });
    return delegateFetch(request, env, ctx);
  }

  return billExecution({
    request: effectiveRequest,
    env,
    merchantId: access.merchant.merchantId,
    requestId: requestId(effectiveRequest),
    kind: "TOOL",
    provider: "x402",
    operation: "verify",
    amountMicroUsd: configuredFee(
      env.XGUARD_VERIFY_FEE_MICRO_USD,
      200,
      "XGUARD_VERIFY_FEE_MICRO_USD",
    ),
    execute: async () =>
      adaptCompatibilityResponse(
        await delegateFetch(effectiveRequest, env, ctx),
        compatibility,
      ),
    isEarned: async (response) =>
      response.status >= 200 && response.status < 300,
  });
}

async function billDirectDiscovery(
  request: Request,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
  operation: string,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) {
    logEconomicTraffic({
      request,
      operation,
      trafficClass: "anonymous_or_unregistered",
      outcome: "blocked_before_execution",
      billable: false,
      feeMicroUsd: 0,
    });
    return access.response;
  }

  return billExecution({
    request,
    env,
    merchantId: access.merchant.merchantId,
    requestId: requestId(request),
    kind: "SOURCE",
    provider: "xguard-catalog",
    operation,
    amountMicroUsd: feeForMcpKind(env, "SOURCE"),
    execute: () => delegateFetch(request, env, ctx),
    isEarned: async (response) =>
      response.status >= 200 && response.status < 300,
  });
}

async function billMcpToolCall(
  request: Request,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
  descriptor: McpBillingDescriptor,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) {
    logEconomicTraffic({
      request,
      operation: descriptor.operation,
      trafficClass: "anonymous_or_unregistered",
      outcome: "blocked_before_execution",
      billable: false,
      feeMicroUsd: 0,
    });
    return access.response;
  }

  const amountMicroUsd = feeForMcpKind(env, descriptor.kind);
  return billExecution({
    request,
    env,
    merchantId: access.merchant.merchantId,
    requestId: requestId(request),
    kind: descriptor.kind,
    provider: descriptor.provider,
    operation: descriptor.operation,
    amountMicroUsd,
    execute: () => delegateFetch(request, env, ctx),
    isEarned: successfulMcpToolResponse,
  });
}

async function billExecution(input: {
  request: Request;
  env: MonetizedMainnetEnv;
  merchantId: string;
  requestId: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
  amountMicroUsd: number;
  execute: () => Promise<Response>;
  isEarned: (response: Response) => Promise<boolean>;
}): Promise<Response> {
  let reserved: Awaited<ReturnType<typeof reserveGatewayFee>>;
  try {
    reserved = await reserveGatewayFee(input.env.DB, {
      merchantId: input.merchantId,
      requestId: input.requestId,
      kind: input.kind,
      provider: input.provider,
      operation: input.operation,
      amountMicroUsd: input.amountMicroUsd,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "insufficient_service_balance") {
      const balance = await merchantBalance(
        input.env.DB,
        input.merchantId,
      ).catch(() => null);
      logEconomicTraffic({
        request: input.request,
        operation: input.operation,
        trafficClass: "authenticated_merchant",
        outcome: "insufficient_prepaid_balance",
        billable: false,
        feeMicroUsd: 0,
        merchantId: input.merchantId,
        requestIdValue: input.requestId,
      });
      return jsonResponse(
        {
          error: "xguard_service_balance_required",
          message:
            "Top up the XGuard prepaid service balance before executing billable traffic",
          requiredFeeMicroUsd: input.amountMicroUsd,
          availableMicroUsd: balance?.availableMicroUsd ?? 0,
          topUpEndpoint: "/v1/topups/intents",
        },
        402,
        input.requestId,
        0,
        "not-reserved",
      );
    }
    if (
      code === "gateway_event_already_earned" ||
      code === "gateway_event_in_progress"
    ) {
      logEconomicTraffic({
        request: input.request,
        operation: input.operation,
        trafficClass: "authenticated_merchant",
        outcome: code,
        billable: false,
        feeMicroUsd: 0,
        merchantId: input.merchantId,
        requestIdValue: input.requestId,
      });
      return jsonResponse({ error: code }, 409, input.requestId, 0, "conflict");
    }
    logEconomicTraffic({
      request: input.request,
      operation: input.operation,
      trafficClass: "authenticated_merchant",
      outcome: `reservation_rejected:${code}`,
      billable: false,
      feeMicroUsd: 0,
      merchantId: input.merchantId,
      requestIdValue: input.requestId,
    });
    return jsonResponse({ error: code }, 400, input.requestId, 0, "rejected");
  }

  logEconomicTraffic({
    request: input.request,
    operation: input.operation,
    trafficClass: "authenticated_merchant",
    outcome: "fee_reserved",
    billable: false,
    feeMicroUsd: 0,
    merchantId: input.merchantId,
    requestIdValue: input.requestId,
  });

  const started = Date.now();
  let response: Response;
  try {
    response = await input.execute();
  } catch (error) {
    const accounting = await releaseGatewayExecutionReservation(
      input.env.DB,
      input.merchantId,
      reserved.eventKey,
    );
    logEconomicTraffic({
      request: input.request,
      operation: input.operation,
      trafficClass: "authenticated_merchant",
      outcome: `execution_unavailable:${errorCode(error)}`,
      billable: false,
      feeMicroUsd: 0,
      merchantId: input.merchantId,
      requestIdValue: input.requestId,
    });
    return jsonResponse(
      { error: "execution_unavailable", detail: errorCode(error) },
      503,
      input.requestId,
      0,
      accounting,
    );
  }

  const latencyMs = Math.max(0, Date.now() - started);
  const earned = await input.isEarned(response.clone()).catch(() => false);
  const accounting = earned
    ? await finalizeGatewayExecutionSuccess(input.env.DB, {
        merchantId: input.merchantId,
        eventKey: reserved.eventKey,
        upstreamStatus: response.status,
        latencyMs,
        requestBytes: contentLength(input.request.headers),
        responseBytes: contentLength(response.headers),
      })
    : await releaseGatewayExecutionReservation(
        input.env.DB,
        input.merchantId,
        reserved.eventKey,
      );

  const earnedFeeMicroUsd = accounting === "earned" ? input.amountMicroUsd : 0;
  logEconomicTraffic({
    request: input.request,
    operation: input.operation,
    trafficClass: "authenticated_merchant",
    outcome: accounting,
    billable: accounting === "earned",
    feeMicroUsd: earnedFeeMicroUsd,
    merchantId: input.merchantId,
    requestIdValue: input.requestId,
    upstreamStatus: response.status,
    latencyMs,
  });

  return withBillingHeaders(
    response,
    input.requestId,
    earnedFeeMicroUsd,
    accounting,
  );
}

export async function inspectMcpBillingDescriptor(
  request: Request,
): Promise<McpBillingDescriptor | null> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.toLowerCase();
  if (contentType !== "application/json") return null;

  const rawLength = request.headers.get("content-length");
  if (rawLength !== null && /^[0-9]+$/.test(rawLength)) {
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared > MCP_BODY_LIMIT)
      return null;
  }

  let payload: unknown;
  try {
    const text = await request.clone().text();
    if (new TextEncoder().encode(text).byteLength > MCP_BODY_LIMIT) return null;
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  return classifyMcpToolCall(payload);
}

async function successfulMcpToolResponse(response: Response): Promise<boolean> {
  if (response.status < 200 || response.status >= 300) return false;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return false;
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || payload.error !== undefined) return false;
  if (!isRecord(payload.result)) return false;
  return payload.result.isError !== true;
}

function logEconomicTraffic(input: {
  request: Request;
  operation: string;
  trafficClass: "anonymous_or_unregistered" | "authenticated_merchant";
  outcome: string;
  billable: boolean;
  feeMicroUsd: number;
  merchantId?: string;
  requestIdValue?: string;
  upstreamStatus?: number;
  latencyMs?: number;
}): void {
  const url = new URL(input.request.url);
  console.log(
    JSON.stringify({
      event: "economic_traffic",
      path: url.pathname,
      method: input.request.method,
      operation: input.operation,
      trafficClass: input.trafficClass,
      outcome: input.outcome,
      billable: input.billable,
      feeMicroUsd: input.feeMicroUsd,
      ...(input.merchantId === undefined
        ? {}
        : { merchantId: input.merchantId }),
      ...(input.requestIdValue === undefined
        ? {}
        : { requestId: input.requestIdValue }),
      ...(input.upstreamStatus === undefined
        ? {}
        : { upstreamStatus: input.upstreamStatus }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    }),
  );
}

function requestId(request: Request): string {
  const supplied = request.headers.get("x-xguard-request-id")?.trim();
  if (supplied !== undefined && supplied !== null && supplied !== "") {
    if (/^[A-Za-z0-9._:-]{8,96}$/.test(supplied)) return supplied;
  }
  return crypto.randomUUID();
}

function contentLength(headers: Headers): number {
  const raw = headers.get("content-length");
  if (raw === null || !/^[0-9]+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function withBillingHeaders(
  response: Response,
  requestIdValue: string,
  feeMicroUsd: number,
  accounting: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Request-Id", requestIdValue);
  headers.set("X-XGuard-Fee-Micro-Usd", String(feeMicroUsd));
  headers.set("X-XGuard-Accounting", accounting);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(
  value: Record<string, unknown>,
  status: number,
  requestIdValue: string,
  feeMicroUsd: number,
  accounting: string,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-XGuard-Request-Id": requestIdValue,
      "X-XGuard-Fee-Micro-Usd": String(feeMicroUsd),
      "X-XGuard-Accounting": accounting,
    },
  });
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "")
    return error.message;
  return "unknown_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
