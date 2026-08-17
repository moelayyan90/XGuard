import mainnetModern, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern.js";
import { merchantBalance } from "./mainnet-billing.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  reserveGatewayFee,
  type GatewayEventKind,
} from "./universal-gateway-billing.js";
import {
  finalizeGatewayExecutionSuccess,
  releaseGatewayExecutionReservation,
} from "./universal-gateway.js";

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
const FREE_MCP_TOOLS = new Set(["xguard_status"]);

export interface McpBillingDescriptor {
  name: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/verify")
      return billVerify(request, env, ctx);

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
  const access = await authorizeMerchantScope(request, env, "verify");
  if (!access.ok) return access.response;

  return billExecution({
    request,
    env,
    merchantId: access.merchant.merchantId,
    requestId: requestId(request),
    kind: "TOOL",
    provider: "x402",
    operation: "verify",
    amountMicroUsd: configuredFee(
      env.XGUARD_VERIFY_FEE_MICRO_USD,
      200,
      "XGUARD_VERIFY_FEE_MICRO_USD",
    ),
    execute: () => delegateFetch(request, env, ctx),
    isEarned: async (response) => response.status >= 200 && response.status < 300,
  });
}

async function billMcpToolCall(
  request: Request,
  env: MonetizedMainnetEnv,
  ctx: ExecutionContext,
  descriptor: McpBillingDescriptor,
): Promise<Response> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;

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
    )
      return jsonResponse(
        { error: code },
        409,
        input.requestId,
        0,
        "conflict",
      );
    return jsonResponse(
      { error: code },
      400,
      input.requestId,
      0,
      "rejected",
    );
  }

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

  return withBillingHeaders(
    response,
    input.requestId,
    accounting === "earned" ? input.amountMicroUsd : 0,
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
    if (!Number.isSafeInteger(declared) || declared > MCP_BODY_LIMIT) return null;
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

export function classifyMcpToolCall(
  payload: unknown,
): McpBillingDescriptor | null {
  if (!isRecord(payload) || payload.method !== "tools/call") return null;
  const params = isRecord(payload.params) ? payload.params : null;
  const name = params !== null && typeof params.name === "string" ? params.name : "";
  if (name === "" || FREE_MCP_TOOLS.has(name)) return null;

  if (name === "xguard_discover" || name === "xguard_resource_details")
    return {
      name,
      kind: "SOURCE",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  if (name.includes("security"))
    return {
      name,
      kind: "SECURITY",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  if (name.includes("analy"))
    return {
      name,
      kind: "ANALYSIS",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  return {
    name,
    kind: "TOOL",
    provider: "xguard-mcp",
    operation: `mcp.${name}`,
  };
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

function feeForMcpKind(
  env: MonetizedMainnetEnv,
  kind: GatewayEventKind,
): number {
  if (kind === "MODEL")
    return configuredFee(env.XGUARD_MODEL_FEE_MICRO_USD, 100, "XGUARD_MODEL_FEE_MICRO_USD");
  if (kind === "TOOL")
    return configuredFee(env.XGUARD_TOOL_FEE_MICRO_USD, 200, "XGUARD_TOOL_FEE_MICRO_USD");
  if (kind === "SOURCE")
    return configuredFee(env.XGUARD_SOURCE_FEE_MICRO_USD, 1_000, "XGUARD_SOURCE_FEE_MICRO_USD");
  if (kind === "ANALYSIS")
    return configuredFee(env.XGUARD_ANALYSIS_FEE_MICRO_USD, 2_000, "XGUARD_ANALYSIS_FEE_MICRO_USD");
  return configuredFee(
    env.XGUARD_SECURITY_FEE_MICRO_USD,
    1_000,
    "XGUARD_SECURITY_FEE_MICRO_USD",
  );
}

function configuredFee(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = raw ?? String(fallback);
  if (!/^[0-9]+$/.test(value)) throw new Error(`invalid_${name.toLowerCase()}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 1_000_000)
    throw new Error(`invalid_${name.toLowerCase()}`);
  return parsed;
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
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "unknown_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
