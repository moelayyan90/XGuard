import universalMainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  WebhookDeliveryQueue,
  XPayGlobalRateGate,
} from "./universal-mainnet.js";
import { commerceSiteResponse } from "./commerce-site.js";
import {
  commerceExecutionResponse,
  commerceExecutionScheduled,
  type CommerceExecutionEnv,
} from "./commerce-execution.js";
import {
  globalCommerceResponse,
  globalCommerceScheduled,
  type GlobalCommerceEnv,
} from "./global-commerce.js";

export {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  WebhookDeliveryQueue,
  XPayGlobalRateGate,
};

type CommerceMainnetEnv = GlobalCommerceEnv & CommerceExecutionEnv;
type MainnetHandler = ExportedHandler<CommerceMainnetEnv>;
const base = universalMainnet as unknown as MainnetHandler;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const site = await commerceSiteResponse(request as Request, env);
    if (site !== null) return site;

    const execution = await commerceExecutionResponse(request as Request, env);
    if (execution !== null) return execution;

    const commerce = await globalCommerceResponse(request as Request, env);
    if (commerce !== null) return commerce;
    if (!base.fetch) {
      return new Response("mainnet_fetch_unavailable", { status: 503 });
    }
    return base.fetch(request, env, ctx);
  },

  async email(message, env, ctx): Promise<void> {
    if (base.email) await base.email(message, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await globalCommerceScheduled(env);
    await commerceExecutionScheduled(env);
    if (base.scheduled) await base.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<CommerceMainnetEnv>;
