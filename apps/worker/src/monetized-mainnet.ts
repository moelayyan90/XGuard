import { derivePaymentIdentities } from "@xguard/core/edge";
import mainnetModern, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern.js";
import legacyMonetized from "./monetized-mainnet-legacy.js";
import {
  earnSettlementFee,
  merchantBalance,
  reserveSettlementFee,
} from "./mainnet-billing.js";
import {
  XGUARD_ATTEMPT_FEE_MICRO_USD,
  XGUARD_ATTEMPT_FEE_USD,
} from "./public-payment-contract.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import { parseMainnetFacilitatorRequest } from "./mainnet-protocol.js";
import {
  adaptCompatibilityResponse,
  normalizeX402CompatibilityRequest,
  type CompatibilityRequest,
} from "./x402-compatibility-bridge.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface AttemptPricedMainnetEnv {
  DB: D1Database;
  XGUARD_FEE_MICRO_USD: string;
  [key: string]: unknown;
}

type CoreFetch = (
  request: Request,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type CoreScheduled = (
  controller: ScheduledController,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = mainnetModern.fetch as unknown as CoreFetch;
const legacyFetch = legacyMonetized.fetch as unknown as CoreFetch;
const legacyScheduled = legacyMonetized.scheduled as unknown as CoreScheduled;
const ATTEMPT_FEE_MICRO_USD = XGUARD_ATTEMPT_FEE_MICRO_USD;
const ATTEMPT_FEE_USD = XGUARD_ATTEMPT_FEE_USD;
const BILLABLE_DISCOVERY_PATHS = new Map<string, string>([
  ["/discovery/search", "discovery.search"],
  ["/discovery/resources", "discovery.resources"],
]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/verify")
      return billVerify(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/settle")
      return billSettle(request, env, ctx);

    if (request.method === "GET") {
      const discoveryOperation = BILLABLE_DISCOVERY_PATHS.get(url.pathname);
      if (discoveryOperation !== undefined)
        return billDirectDiscovery(request, env, ctx, discoveryOperation);
    }

    const response = await legacyFetch(request, env, ctx);
    return rewritePublicPricing(request, response);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await legacyScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<AttemptPricedMainnetEnv>;

async function billVerify(
  request: Request,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const configError = attemptFeeConfigError(env);
  if (configError !== null) return configError;

  // Authentication deliberately remains before compatibility parsing. This is
  // the production security boundary established by the prior hardening fix.
  const access = await authorizeMerchantScope(request, env, "verify");
  if (!access.ok) return access.response;

  let compatibility: CompatibilityRequest | null = null;
  let effectiveRequest = request;
  try {
    compatibility = await normalizeX402CompatibilityRequest(request);
    if (compatibility !== null) effectiveRequest = compatibility.request;
  } catch {
    // Invalid authenticated legacy traffic is rejected by the canonical
    // handler before XGuard accepts a chargeable economic attempt.
    return delegateFetch(request, env, ctx);
  }

  const logicalPaymentKey = await paymentKeyFor(effectiveRequest);
  if (logicalPaymentKey === null)
    return delegateFetch(effectiveRequest, env, ctx);

  return billExecution({
    request: effectiveRequest,
    env,
    merchantId: access.merchant.merchantId,
    logicalPaymentKey,
    execute: async () =>
      adaptCompatibilityResponse(
        await delegateFetch(effectiveRequest, env, ctx),
        compatibility,
      ),
  });
}

async function billDirectDiscovery(
  request: Request,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
  _operation: string,
): Promise<Response> {
  // Preserve the existing authenticated monetized discovery contract. The
  // legacy monetized layer still owns its SOURCE accounting and fee schedule.
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) return access.response;
  return legacyFetch(request, env, ctx);
}

async function billSettle(
  request: Request,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const configError = attemptFeeConfigError(env);
  if (configError !== null) return configError;

  const access = await authorizeMerchantScope(request, env, "settle");
  if (!access.ok) return access.response;

  let compatibility: CompatibilityRequest | null = null;
  let effectiveRequest = request;
  try {
    compatibility = await normalizeX402CompatibilityRequest(request);
    if (compatibility !== null) effectiveRequest = compatibility.request;
  } catch {
    return delegateFetch(request, env, ctx);
  }

  const logicalPaymentKey = await paymentKeyFor(effectiveRequest);
  if (logicalPaymentKey === null)
    return delegateFetch(effectiveRequest, env, ctx);

  return billExecution({
    request: effectiveRequest,
    env,
    merchantId: access.merchant.merchantId,
    logicalPaymentKey,
    execute: async () =>
      adaptCompatibilityResponse(
        await delegateFetch(effectiveRequest, env, ctx),
        compatibility,
      ),
  });
}

async function billExecution(input: {
  request: Request;
  env: AttemptPricedMainnetEnv;
  merchantId: string;
  logicalPaymentKey: string;
  execute: () => Promise<Response>;
}): Promise<Response> {
  try {
    const reservation = await reserveSettlementFee(
      input.env.DB,
      input.merchantId,
      input.logicalPaymentKey,
      ATTEMPT_FEE_MICRO_USD,
    );

    if (reservation.amountMicroUsd !== ATTEMPT_FEE_MICRO_USD) {
      return jsonResponse(
        {
          error: "attempt_fee_terms_conflict",
          logicalPaymentKey: input.logicalPaymentKey,
          expectedMicroUsd: ATTEMPT_FEE_MICRO_USD,
          existingMicroUsd: reservation.amountMicroUsd,
        },
        409,
      );
    }

    // Earning occurs before downstream execution by design. The same logical
    // payment key is idempotent, so verify -> settle and retries never earn the
    // fixed fee twice.
    if (reservation.state !== "EARNED") {
      await earnSettlementFee(
        input.env.DB,
        input.merchantId,
        input.logicalPaymentKey,
      );
    }
  } catch (error) {
    if (errorCode(error) === "insufficient_service_balance") {
      const balance = await merchantBalance(input.env.DB, input.merchantId).catch(
        () => null,
      );
      return jsonResponse(
        {
          error: "xguard_service_balance_required",
          message: `A $${ATTEMPT_FEE_USD} prepaid XGuard attempt fee is required before accepted economic execution`,
          requiredFeeMicroUsd: ATTEMPT_FEE_MICRO_USD,
          availableMicroUsd: balance?.availableMicroUsd ?? 0,
          topUpEndpoint: "/v1/topups/intents",
        },
        402,
      );
    }
    return jsonResponse(
      { error: "attempt_fee_unavailable", detail: errorCode(error) },
      503,
    );
  }

  const response = await input.execute();
  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Attempt-Fee-USD", ATTEMPT_FEE_USD);
  headers.set(
    "X-XGuard-Attempt-Fee-Micro-USD",
    String(ATTEMPT_FEE_MICRO_USD),
  );
  headers.set("X-XGuard-Attempt-Fee-State", "earned");
  headers.set("X-XGuard-Attempt-Fee-Refundable", "false");
  headers.set("X-XGuard-Attempt-Key", input.logicalPaymentKey);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function paymentKeyFor(request: Request): Promise<string | null> {
  try {
    const parsed = await parseMainnetFacilitatorRequest(
      request.clone() as unknown as Request,
    );
    return derivePaymentIdentities(
      parsed.paymentPayload,
      parsed.paymentRequirements,
    ).logicalPaymentKey;
  } catch {
    return null;
  }
}

function attemptFeeConfigError(env: AttemptPricedMainnetEnv): Response | null {
  if (env.XGUARD_FEE_MICRO_USD === String(ATTEMPT_FEE_MICRO_USD)) return null;
  return jsonResponse(
    {
      error: "attempt_fee_configuration_invalid",
      expectedMicroUsd: ATTEMPT_FEE_MICRO_USD,
    },
    503,
  );
}

async function rewritePublicPricing(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!response.ok || request.method !== "GET") return response;
  const url = new URL(request.url);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json") && url.pathname === "/") {
    try {
      const body = (await response.clone().json()) as Record<string, unknown>;
      body.price = {
        amount: ATTEMPT_FEE_USD,
        currency: "USD",
        event: "accepted_authenticated_economic_attempt",
        model: "merchant_prepaid_nonrefundable_attempt_fee",
        dedupe: "one fee per logicalPaymentKey",
      };
      return jsonFromResponse(response, body);
    } catch {
      return response;
    }
  }

  if (
    contentType.includes("text/html") &&
    (url.pathname === "/" ||
      url.pathname === "/docs" ||
      url.pathname === "/quickstart")
  ) {
    let html = await response.text();
    html = html
      .replaceAll("$0.002", `$${ATTEMPT_FEE_USD}`)
      .replaceAll("$0.04", `$${ATTEMPT_FEE_USD}`)
      .replace(
        `Settlement fee</dt><dd>$${ATTEMPT_FEE_USD}`,
        `Attempt fee</dt><dd>$${ATTEMPT_FEE_USD}`,
      )
      .replace(
        "Failed / malformed</dt><dd>$0",
        `Downstream failure</dt><dd>$${ATTEMPT_FEE_USD}`,
      )
      .replace(
        "Charge follows delivered value.",
        "One fixed fee per accepted economic attempt.",
      )
      .replace(
        "No monthly plan is required for the settlement safety path.",
        `The $${ATTEMPT_FEE_USD} attempt fee is earned once an authenticated, parseable economic request is accepted. Downstream failure does not refund it.`,
      )
      .replace(
        "SUCCESSFUL BILLABLE SETTLEMENT",
        "ACCEPTED ECONOMIC ATTEMPT",
      )
      .replace(
        "FAILED SETTLEMENT</span><b>$0",
        `DOWNSTREAM FAILURE</span><b>$${ATTEMPT_FEE_USD}`,
      )
      .replace(
        "MALFORMED REQUEST</span><b>$0",
        "MALFORMED / UNAUTHENTICATED</span><b>$0",
      )
      .replace(
        "DUPLICATE / REPLAY</span><b>$0",
        "IDEMPOTENT RETRY</span><b>$0 ADDITIONAL",
      )
      .replace(
        `$${ATTEMPT_FEE_USD} for a successful billable settlement. Failed, malformed and duplicate traffic is not earned settlement revenue.`,
        `$${ATTEMPT_FEE_USD} once per authenticated, parseable economic attempt. Downstream failure does not refund the attempt fee. Malformed or unauthenticated requests and idempotent retries do not incur an additional attempt fee.`,
      );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
}

function jsonFromResponse(
  response: Response,
  value: Record<string, unknown>,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(
  value: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown_error";
}
