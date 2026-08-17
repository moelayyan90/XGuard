import monetizedMainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./monetized-mainnet.js";
import { a2aGatewayV1Response } from "./a2a-gateway-v1.js";
import { buyerPortalResponse } from "./buyer-portal.js";
import { genericHttpConnectorResponse } from "./generic-http-connector.js";
import { paymentDecisionResponse } from "./payment-decision.js";
import {
  normalizePublicPaymentContract,
  publicPaymentContractResponse,
} from "./public-payment-contract.js";
import {
  WebhookDeliveryQueue,
  resilientWebhookIngressResponse,
} from "./resilient-webhook-ingress.js";
import { universalProtocolResponse } from "./universal-protocol-router.js";
import { universalSecurityGuardResponse } from "./universal-security-guard.js";
import { universalWebhookResponse } from "./universal-webhook-ingress.js";

export {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  WebhookDeliveryQueue,
  XPayGlobalRateGate,
};

interface UniversalMainnetEnv {
  DB: D1Database;
  WEBHOOK_DELIVERY_QUEUE: DurableObjectNamespace<WebhookDeliveryQueue>;
  WEBHOOK_RATE_LIMITER: RateLimit;
  XGUARD_PAYMENT_DECISION_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_TREASURY_USDC_ADDRESS?: string;
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

const PUBLIC_DISCOVERY_PREFLIGHT_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-market.json",
  "/.well-known/x402/facilitator.json",
  "/.well-known/x402.json",
  "/provider.json",
  "/openapi.json",
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
]);

export function publicDiscoveryPreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  const url = new URL(request.url);
  if (!PUBLIC_DISCOVERY_PREFLIGHT_PATHS.has(url.pathname)) return null;

  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

    const discoveryPreflight = publicDiscoveryPreflight(standardRequest);
    if (discoveryPreflight !== null) return discoveryPreflight;

    const paymentContract = publicPaymentContractResponse(standardRequest, env);
    if (paymentContract !== null) return paymentContract;

    const securityBlock = universalSecurityGuardResponse(standardRequest);
    if (securityBlock !== null) return securityBlock;

    const a2a = await a2aGatewayV1Response(
      standardRequest,
      env,
      (internalRequest) => mainnetFetch(internalRequest, env, ctx),
    );
    if (a2a !== null) return a2a;

    const portal = buyerPortalResponse(standardRequest);
    if (portal !== null) return portal;

    const paymentDecision = await paymentDecisionResponse(standardRequest, env);
    if (paymentDecision !== null) return paymentDecision;

    const resilientWebhook = await resilientWebhookIngressResponse(
      standardRequest,
      env,
    );
    if (resilientWebhook !== null) return resilientWebhook;

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

    const response = await mainnetFetch(standardRequest, env, ctx);
    return normalizePublicPaymentContract(standardRequest, response);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await mainnetScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<UniversalMainnetEnv>;
