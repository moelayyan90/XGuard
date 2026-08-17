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

const modernFetch = mainnetModern.fetch as unknown as CoreFetch;
const legacyFetch = legacyMonetized.fetch as unknown as CoreFetch;
const legacyScheduled = legacyMonetized.scheduled as unknown as CoreScheduled;
const ATTEMPT_FEE_MICRO_USD = 40_000;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      (url.pathname === "/verify" || url.pathname === "/settle")
    ) {
      return chargeEconomicAttempt(request, env, ctx, url.pathname);
    }

    const response = await legacyFetch(request, env, ctx);
    return rewritePublicPricing(request, response);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await legacyScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<AttemptPricedMainnetEnv>;

async function chargeEconomicAttempt(
  request: Request,
  env: AttemptPricedMainnetEnv,
  ctx: ExecutionContext,
  operation: "/verify" | "/settle",
): Promise<Response> {
  if (env.XGUARD_FEE_MICRO_USD !== String(ATTEMPT_FEE_MICRO_USD)) {
    return jsonResponse(
      {
        error: "attempt_fee_configuration_invalid",
        expectedMicroUsd: ATTEMPT_FEE_MICRO_USD,
      },
      503,
    );
  }

  // Establish merchant identity before compatibility parsing. Anonymous or
  // invalid credentials are never chargeable because there is no authenticated
  // prepaid account to debit.
  const access = await authorizeMerchantScope(
    request,
    env,
    operation === "/verify" ? "verify" : "settle",
  );
  if (!access.ok) return access.response;

  let compatibility: CompatibilityRequest | null = null;
  let effectiveRequest = request;
  try {
    compatibility = await normalizeX402CompatibilityRequest(request);
    if (compatibility !== null) effectiveRequest = compatibility.request;
  } catch {
    // A malformed/unsupported envelope has not crossed the accepted economic
    // attempt boundary, so it is rejected without a fee.
    return modernFetch(request, env, ctx);
  }

  let logicalPaymentKey: string;
  try {
    const parsed = await parseMainnetFacilitatorRequest(
      effectiveRequest.clone() as unknown as Request,
    );
    logicalPaymentKey = derivePaymentIdentities(
      parsed.paymentPayload,
      parsed.paymentRequirements,
    ).logicalPaymentKey;
  } catch {
    // Syntactically invalid economic traffic is not billable. We only charge
    // after merchant auth and a canonical logical payment identity exist.
    return modernFetch(effectiveRequest, env, ctx);
  }

  try {
    const reservation = await reserveSettlementFee(
      env.DB,
      access.merchant.merchantId,
      logicalPaymentKey,
      ATTEMPT_FEE_MICRO_USD,
    );

    if (reservation.amountMicroUsd !== ATTEMPT_FEE_MICRO_USD) {
      return jsonResponse(
        {
          error: "attempt_fee_terms_conflict",
          logicalPaymentKey,
          expectedMicroUsd: ATTEMPT_FEE_MICRO_USD,
          existingMicroUsd: reservation.amountMicroUsd,
        },
        409,
      );
    }

    if (reservation.state !== "EARNED") {
      await earnSettlementFee(
        env.DB,
        access.merchant.merchantId,
        logicalPaymentKey,
      );
    }
  } catch (error) {
    if (errorCode(error) === "insufficient_service_balance") {
      const balance = await merchantBalance(
        env.DB,
        access.merchant.merchantId,
      ).catch(() => null);
      return jsonResponse(
        {
          error: "xguard_service_balance_required",
          message:
            "A $0.04 prepaid XGuard attempt fee is required before accepted economic execution",
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

  let response = await modernFetch(effectiveRequest, env, ctx);
  response = await adaptCompatibilityResponse(response, compatibility);
  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Attempt-Fee-USD", "0.04");
  headers.set(
    "X-XGuard-Attempt-Fee-Micro-USD",
    String(ATTEMPT_FEE_MICRO_USD),
  );
  headers.set("X-XGuard-Attempt-Fee-State", "earned");
  headers.set("X-XGuard-Attempt-Fee-Refundable", "false");
  headers.set("X-XGuard-Attempt-Key", logicalPaymentKey);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
        amount: "0.04",
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
      .replaceAll("$0.002", "$0.04")
      .replace(
        "Settlement fee</dt><dd>$0.04",
        "Attempt fee</dt><dd>$0.04",
      )
      .replace(
        "Failed / malformed</dt><dd>$0",
        "Downstream failure</dt><dd>$0.04",
      )
      .replace(
        "Charge follows delivered value.",
        "One fixed fee per accepted economic attempt.",
      )
      .replace(
        "No monthly plan is required for the settlement safety path.",
        "The $0.04 attempt fee is earned once an authenticated, parseable economic request is accepted. Downstream failure does not refund it.",
      )
      .replace(
        "SUCCESSFUL BILLABLE SETTLEMENT",
        "ACCEPTED ECONOMIC ATTEMPT",
      )
      .replace(
        "FAILED SETTLEMENT</span><b>$0",
        "DOWNSTREAM FAILURE</span><b>$0.04",
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
        "$0.04 for a successful billable settlement. Failed, malformed and duplicate traffic is not earned settlement revenue.",
        "$0.04 once per authenticated, parseable economic attempt. Downstream failure does not refund the attempt fee. Malformed or unauthenticated requests and idempotent retries do not incur an additional attempt fee.",
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

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
