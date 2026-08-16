import { derivePaymentIdentities } from "@xguard/core/edge";
import mainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet-edge.js";
import { authenticateMerchant } from "./mainnet-billing.js";
import { parseMainnetFacilitatorRequest } from "./mainnet-protocol.js";
import {
  recordAmbiguousRecovery,
  recoverAmbiguousSettlements,
  recoveredSettlement,
  recoveryStats,
  type AmbiguousRecoveryInput,
  type MainnetRecoveryEnv,
} from "./mainnet-recovery.js";
import {
  XPayGlobalRateGate,
  type XPayRateDecision,
} from "./xpay-rate-gate.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

const XPAY_VERIFY_LIMIT_PER_MINUTE = 90;
const XPAY_SETTLE_LIMIT_PER_MINUTE = 45;
const RATE_WINDOW_MS = 60_000;

type MainnetSupervisorEnv = MainnetRecoveryEnv & {
  XPAY_RATE_GATE: DurableObjectNamespace<XPayGlobalRateGate>;
  [key: string]: unknown;
};

type MainnetFetch = (
  request: Request,
  env: MainnetSupervisorEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type MainnetScheduled = (
  controller: ScheduledController,
  env: MainnetSupervisorEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = mainnet.fetch as unknown as MainnetFetch;
const delegateScheduled = mainnet.scheduled as unknown as MainnetScheduled;

interface InspectedRequest {
  recovery: AmbiguousRecoveryInput;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      (url.pathname === "/verify" || url.pathname === "/settle")
    ) {
      return supervisedFacilitatorRequest(request, env, ctx, url.pathname);
    }

    const mcpStatusProbe =
      request.method === "POST" && url.pathname === "/mcp"
        ? request.clone()
        : null;
    const response = await delegateFetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/status")
      return truthfulStatus(response, env.DB);
    if (
      mcpStatusProbe !== null &&
      (await isMcpStatusCall(mcpStatusProbe).catch(() => false))
    )
      return truthfulMcpStatus(response, env, ctx, url.origin);
    return response;
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
    ctx.waitUntil(
      recoverAmbiguousSettlements(env).catch((error) =>
        console.error(
          JSON.stringify({
            event: "ambiguous_recovery_failed",
            code: errorCode(error),
          }),
        ),
      ),
    );
  },
} satisfies ExportedHandler<MainnetSupervisorEnv>;

async function supervisedFacilitatorRequest(
  request: Request,
  env: MainnetSupervisorEnv,
  ctx: ExecutionContext,
  operation: "/verify" | "/settle",
): Promise<Response> {
  const inspected = await inspectProtectedRequest(request.clone(), env).catch(
    () => null,
  );

  if (operation === "/settle" && inspected !== null) {
    const recovered = await recoveredSettlement(
      env.DB,
      inspected.recovery.logicalPaymentKey,
    );
    if (recovered !== null) {
      if (recovered.state === "PENDING")
        return settlementFailure(
          503,
          "xguard_ambiguous",
          "XGuard is checking Base finality for a previous uncertain submission; automatic retry remains disabled",
          {
            "X-XGuard-Replayed": "true",
            "X-XGuard-Recovery": "PENDING",
          },
        );
      if (recovered.result !== null)
        return jsonResponse(recovered.result, 200, {
          "X-XGuard-Replayed": "true",
          "X-XGuard-Recovery": recovered.state,
        });
    }
  }

  let quota:
    | {
        stub: DurableObjectStub<XPayGlobalRateGate>;
        takenAtMs: number;
        decision: XPayRateDecision;
      }
    | null = null;

  if (inspected !== null) {
    const takenAtMs = Date.now();
    const limit =
      operation === "/verify"
        ? XPAY_VERIFY_LIMIT_PER_MINUTE
        : XPAY_SETTLE_LIMIT_PER_MINUTE;
    const stub = env.XPAY_RATE_GATE.getByName(`xpay-global:${operation}`);
    let decision: XPayRateDecision;
    try {
      decision = await stub.take(takenAtMs, limit, RATE_WINDOW_MS);
    } catch {
      return jsonResponse(
        { error: "upstream_quota_protection_unavailable" },
        503,
        { "Retry-After": "1" },
      );
    }
    if (!decision.allowed)
      return jsonResponse(
        {
          error: "upstream_rate_limit_guard",
          provider: "xpay",
          limit: decision.limit,
        },
        429,
        { "Retry-After": String(decision.retryAfterSeconds) },
      );
    quota = { stub, takenAtMs, decision };
  }

  const response = await delegateFetch(request, env, ctx);

  if (quota !== null && (await shouldRefundQuota(response)))
    ctx.waitUntil(quota.stub.refund(quota.takenAtMs, RATE_WINDOW_MS));

  if (
    operation === "/settle" &&
    inspected !== null &&
    response.status === 503 &&
    (await isAmbiguousSettlement(response))
  ) {
    try {
      await recordAmbiguousRecovery(env.DB, inspected.recovery);
      ctx.waitUntil(
        recoverAmbiguousSettlements(env).catch((error) =>
          console.error(
            JSON.stringify({
              event: "ambiguous_recovery_attempt_failed",
              code: errorCode(error),
            }),
          ),
        ),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ambiguous_recovery_persist_failed",
          code: errorCode(error),
        }),
      );
    }
  }

  return response;
}

async function inspectProtectedRequest(
  request: Request,
  env: MainnetSupervisorEnv,
): Promise<InspectedRequest> {
  const authorizationHeader = request.headers.get("authorization");
  if (
    authorizationHeader === null ||
    !authorizationHeader.startsWith("Bearer ")
  )
    throw new Error("merchant_auth_missing");
  const merchant = await authenticateMerchant(
    env.DB,
    authorizationHeader.slice("Bearer ".length),
  );
  if (merchant === null) throw new Error("merchant_auth_invalid");

  const parsed = await parseMainnetFacilitatorRequest(request);
  const identities = derivePaymentIdentities(
    parsed.paymentPayload,
    parsed.paymentRequirements,
  );
  const payload = asRecord(parsed.paymentPayload.payload);
  const authorization = asRecord(payload.authorization);
  const nonce = authorization.nonce;
  const validBefore = authorization.validBefore;
  if (typeof nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nonce))
    throw new Error("invalid_authorization_nonce");
  if (typeof validBefore !== "string" || !/^[0-9]+$/.test(validBefore))
    throw new Error("invalid_authorization_expiry");
  const validBeforeBigInt = BigInt(validBefore);
  if (
    validBeforeBigInt <= 0n ||
    validBeforeBigInt > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("invalid_authorization_expiry");

  return {
    recovery: {
      logicalPaymentKey: identities.logicalPaymentKey,
      merchantId: merchant.merchantId,
      expectedPayer: parsed.payer,
      expectedPayTo: parsed.payTo,
      expectedAmountMicroUsd: parsed.amountMicroUsd,
      authorizationNonce: nonce,
      validBeforeEpoch: Number(validBeforeBigInt),
    },
  };
}

async function truthfulStatus(
  response: Response,
  db: D1Database,
): Promise<Response> {
  if (!response.ok) return response;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const recoveries = await recoveryStats(db);
    const facilitatorHealthy = body.facilitator === "HEALTHY";
    body.gateway =
      facilitatorHealthy && recoveries.failed === 0 ? "operational" : "degraded";
    body.facilitatorProvider = "xpay";
    body.ambiguousRecovery = recoveries;
    return jsonFrom(response, body);
  } catch {
    return response;
  }
}

async function truthfulMcpStatus(
  response: Response,
  env: MainnetSupervisorEnv,
  ctx: ExecutionContext,
  origin: string,
): Promise<Response> {
  if (!response.ok) return response;
  try {
    const statusResponse = await delegateFetch(
      new Request(`${origin}/status`),
      env,
      ctx,
    );
    const truthful = await truthfulStatus(statusResponse, env.DB);
    if (!truthful.ok) return response;
    const status = (await truthful.json()) as Record<string, unknown>;
    const body = (await response.clone().json()) as Record<string, unknown>;
    const result = asRecord(body.result);
    const current = asRecord(result.structuredContent);
    const structured = {
      ...current,
      status: status.gateway,
      facilitator: status.facilitator,
      facilitatorProvider: status.facilitatorProvider,
      ambiguousRecovery: status.ambiguousRecovery,
    };
    result.structuredContent = structured;
    if (Array.isArray(result.content) && result.content.length > 0) {
      const first = result.content[0];
      if (typeof first === "object" && first !== null && !Array.isArray(first))
        (first as Record<string, unknown>).text = JSON.stringify(structured);
    }
    return jsonFrom(response, body);
  } catch {
    return response;
  }
}

async function isMcpStatusCall(request: Request): Promise<boolean> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    return false;
  const body = (await request.json()) as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return false;
  const record = body as Record<string, unknown>;
  if (record.method !== "tools/call") return false;
  const params = record.params;
  return (
    typeof params === "object" &&
    params !== null &&
    !Array.isArray(params) &&
    (params as Record<string, unknown>).name === "xguard_status"
  );
}

async function shouldRefundQuota(response: Response): Promise<boolean> {
  if (response.headers.get("X-XGuard-Replayed") === "true") return true;
  if ([400, 401, 402, 409, 429].includes(response.status)) return true;
  if (response.status !== 503) return false;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const reason = body.errorReason ?? body.error;
    return (
      reason === "xguard_facilitator_unavailable" ||
      reason === "facilitator_unavailable" ||
      reason === "upstream_quota_protection_unavailable"
    );
  } catch {
    return false;
  }
}

async function isAmbiguousSettlement(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    return body.errorReason === "xguard_ambiguous";
  } catch {
    return false;
  }
}

function settlementFailure(
  status: number,
  reason: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  return jsonResponse(
    {
      success: false,
      transaction: "",
      network: "eip155:8453",
      errorReason: reason,
      errorMessage: message,
    },
    status,
    headers,
  );
}

function jsonResponse(
  value: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function jsonFrom(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expected_object");
  return value as Record<string, unknown>;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.name === "AbortError"
    ? "AbortError"
    : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
