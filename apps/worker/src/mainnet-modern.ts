import modernCore, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern-core.js";
import {
  autoInvokeResponse,
  rewrapProviderCredentials,
} from "./auto-invoke.js";
import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import { universalGatewayResponse } from "./universal-gateway.js";
import { releaseStaleGatewayHolds } from "./universal-gateway-billing.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface MainnetModernEnv {
  DB: D1Database;
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

    const rotated = await rotateCredentialWithVaultRewrap(
      standardRequest,
      env,
      ctx,
    );
    if (rotated !== null) return secureResponse(rotated);

    const automatic = await autoInvokeResponse(standardRequest, env);
    if (automatic !== null) return secureResponse(automatic);

    const gateway = await universalGatewayResponse(
      standardRequest,
      env,
      async (internalRequest) => delegateFetch(internalRequest, env, ctx),
    );
    if (gateway !== null) return secureResponse(gateway);
    return delegateFetch(standardRequest, env, ctx);
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
