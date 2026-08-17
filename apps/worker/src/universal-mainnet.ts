import monetizedMainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./monetized-mainnet.js";
import { genericHttpConnectorResponse } from "./generic-http-connector.js";
import { universalProtocolResponse } from "./universal-protocol-router.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface UniversalMainnetEnv {
  DB: D1Database;
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
const mainnetScheduled = monetizedMainnet.scheduled as unknown as MainnetScheduled;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;

    const protocolResponse = await universalProtocolResponse(standardRequest, {
      verifyX402: (x402Request) => mainnetFetch(x402Request, env, ctx),
      settleX402: (x402Request) => mainnetFetch(x402Request, env, ctx),
    });
    if (protocolResponse !== null) return protocolResponse;

    const genericHttp = await genericHttpConnectorResponse(standardRequest, env);
    if (genericHttp !== null) return genericHttp;

    return mainnetFetch(standardRequest, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await mainnetScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<UniversalMainnetEnv>;
