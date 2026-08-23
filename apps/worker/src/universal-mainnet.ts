import monetizedMainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./monetized-mainnet.js";
import { a2aGatewayV1Response } from "./a2a-gateway-v1.js";
import { buyerPassResponse } from "./buyer-pass.js";
import { buyerPortalResponse } from "./buyer-portal.js";
import { childSafetyComplianceInfrastructureResponse } from "./child-safety-compliance-infrastructure.js";
import { childSafetyContactResponse } from "./child-safety-contact.js";
import { childSafetyControlResponse } from "./child-safety-control.js";
import { childSafetyInstitutionalResponse } from "./child-safety-institutional.js";
import { childSafetyReportingDirectoryResponse } from "./child-safety-reporting-directory.js";
import { publicChildSafetySiteResponse } from "./child-safety-public-site.js";
import { eudrNetworkResponse } from "./eudr-network.js";
import { eudrSmartEmployeeSite } from "./eudr-smart-employee-site.js";
import { genericHttpConnectorResponse } from "./generic-http-connector.js";
import { mcpOAuthChallengeResponse } from "./mcp-oauth-challenge.js";
import { mcpOAuthResponse } from "./mcp-oauth.js";
import {
  operationsEmployeeResponse,
  operationsEmployeeScheduled,
} from "./operations-employee.js";
import { operationsPilotResponse } from "./operations-pilot.js";
import { paymentDecisionResponse } from "./payment-decision.js";
import {
  normalizePublicPaymentContract,
  publicPaymentContractResponse,
} from "./public-payment-contract.js";
import { publicDiscoveryPreflight } from "./public-discovery-preflight.js";
import {
  WebhookDeliveryQueue,
  resilientWebhookIngressResponse,
} from "./resilient-webhook-ingress.js";
import { universalActionRailResponse } from "./universal-action-rail.js";
import { universalProtocolResponse } from "./universal-protocol-router.js";
import { universalSecurityGuardResponse } from "./universal-security-guard.js";
import { universalWebhookResponse } from "./universal-webhook-ingress.js";
import {
  xguardInboundEmail,
  xguardMailHttpResponse,
  type XGuardMailEnv,
} from "./xguard-mail.js";

export {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  WebhookDeliveryQueue,
  XPayGlobalRateGate,
};

interface UniversalMainnetEnv extends XGuardMailEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  BUYER_PASS_CREATE_RATE_LIMITER: RateLimit;
  WEBHOOK_DELIVERY_QUEUE: DurableObjectNamespace<WebhookDeliveryQueue>;
  WEBHOOK_RATE_LIMITER: RateLimit;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
  XGUARD_PAYMENT_DECISION_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
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

async function buyerPassCreationGuard(
  request: Request,
  env: UniversalMainnetEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/buyer-pass" || request.method !== "POST")
    return null;

  const client = (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
    .trim()
    .slice(0, 128);

  try {
    const decision = await env.BUYER_PASS_CREATE_RATE_LIMITER.limit({
      key: `buyer-pass:create:${client}`,
    });
    if (decision.success) return null;
    return new Response(JSON.stringify({ error: "rate_limit_exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "60",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "protection_unavailable" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

    const discoveryPreflight = publicDiscoveryPreflight(standardRequest);
    if (discoveryPreflight !== null) return discoveryPreflight;

    const mcpOAuth = await mcpOAuthResponse(standardRequest, env);
    if (mcpOAuth !== null) return mcpOAuth;

    const mcpOAuthChallenge = await mcpOAuthChallengeResponse(standardRequest);
    if (mcpOAuthChallenge !== null) return mcpOAuthChallenge;

    const paymentContract = publicPaymentContractResponse(standardRequest, env);
    if (paymentContract !== null) return paymentContract;

    const securityBlock = universalSecurityGuardResponse(standardRequest);
    if (securityBlock !== null) return securityBlock;

    const mail = await xguardMailHttpResponse(standardRequest, env);
    if (mail !== null) return mail;

    const pilot = await operationsPilotResponse(standardRequest, env);
    if (pilot !== null) return pilot;

    const smartEmployeeSite = eudrSmartEmployeeSite(standardRequest);
    if (smartEmployeeSite !== null) return smartEmployeeSite;

    const operations = await operationsEmployeeResponse(standardRequest, env);
    if (operations !== null) return operations;

    const eudr = await eudrNetworkResponse(standardRequest, env);
    if (eudr !== null) return eudr;

    const childSafetyContact = await childSafetyContactResponse(
      standardRequest,
      env,
    );
    if (childSafetyContact !== null) return childSafetyContact;

    const childSafetyCompliance =
      await childSafetyComplianceInfrastructureResponse(standardRequest, env);
    if (childSafetyCompliance !== null) return childSafetyCompliance;

    const childSafetyReporting =
      childSafetyReportingDirectoryResponse(standardRequest);
    if (childSafetyReporting !== null) return childSafetyReporting;

    const childSafetyInstitutional =
      childSafetyInstitutionalResponse(standardRequest);
    if (childSafetyInstitutional !== null) return childSafetyInstitutional;

    const childSafetySite = publicChildSafetySiteResponse(standardRequest);
    if (childSafetySite !== null) return childSafetySite;

    const childSafety = await childSafetyControlResponse(standardRequest, env);
    if (childSafety !== null) return childSafety;

    const buyerPassCreateBlock = await buyerPassCreationGuard(
      standardRequest,
      env,
    );
    if (buyerPassCreateBlock !== null) return buyerPassCreateBlock;

    const buyerPass = await buyerPassResponse(standardRequest, env);
    if (buyerPass !== null) return buyerPass;

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

    const actionRail = await universalActionRailResponse(standardRequest, env);
    if (actionRail !== null) return actionRail;

    const genericHttp = await genericHttpConnectorResponse(
      standardRequest,
      env,
    );
    if (genericHttp !== null) return genericHttp;

    const response = await mainnetFetch(standardRequest, env, ctx);
    return normalizePublicPaymentContract(standardRequest, response);
  },

  async email(message, env, ctx): Promise<void> {
    void ctx;
    await xguardInboundEmail(message, env);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await operationsEmployeeScheduled(env);
    await mainnetScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<UniversalMainnetEnv>;
