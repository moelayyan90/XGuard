import modernCore, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-modern-core.js";
import { autoInvokeResponse } from "./auto-invoke.js";
import { universalGatewayResponse } from "./universal-gateway.js";

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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

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
  },
} satisfies ExportedHandler<MainnetModernEnv>;

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
