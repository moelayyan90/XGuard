import monetizedMainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./monetized-mainnet.js";
import { buyerPassResponse } from "./buyer-pass.js";
import { buyerPortalResponse } from "./buyer-portal.js";
import { genericHttpConnectorResponse } from "./generic-http-connector.js";
import { paymentDecisionResponse } from "./payment-decision.js";
import { universalProtocolResponse } from "./universal-protocol-router.js";
import { universalWebhookResponse } from "./universal-webhook-ingress.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface UniversalMainnetEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
  XGUARD_PAYMENT_DECISION_FEE_MICRO_USD?: string;
  [key: string]: unknown;
}

type MainnetFetch = (
  request: Request,
  env: UniversalMainnetEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type MainnetScheduled = (
  controller: ScheduledController,
  env: UniversalMainnetEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const mainnetFetch = monetizedMainnet.fetch as unknown as MainnetFetch;
const mainnetScheduled =
  monetizedMainnet.scheduled as unknown as MainnetScheduled;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

    // Buyer Pass is the low-friction identity/balance surface used by browser
    // buyers and autonomous agents. It is intentionally routed before legacy
    // merchant endpoints so a new buyer never needs a merchant API key merely
    // to ask XGuard for a payment decision.
    const buyerPass = await buyerPassResponse(standardRequest, env);
    if (buyerPass !== null) return buyerPass;

    // Buyer/agent-side XGuard owns the pre-payment decision boundary. It runs
    // before any settlement-protocol adapter so x402 is one rail, not the
    // product definition. A normal non-XGuard payment is never intercepted.
    const portal = buyerPortalResponse(standardRequest);
    if (portal !== null) return portal;

    const paymentDecision = await paymentDecisionResponse(standardRequest, env);
    if (paymentDecision !== null) return paymentDecision;

    const protocolResponse = await universalProtocolResponse(standardRequest, {
      verifyX402: (x402Request) => mainnetFetch(x402Request, env, ctx),
      settleX402: (x402Request) => mainnetFetch(x402Request, env, ctx),
    });
    if (protocolResponse !== null) return protocolResponse;

    const webhookResponse = await universalWebhookResponse(
      standardRequest,
      env,
    );
    if (webhookResponse !== null) return webhookResponse;

    const genericHttp = await genericHttpConnectorResponse(
      standardRequest,
      env,
    );
    if (genericHttp !== null) return genericHttp;

    return mainnetFetch(standardRequest, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await mainnetScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<UniversalMainnetEnv>;
