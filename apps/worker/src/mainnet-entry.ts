import mainnetHandler, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet.js";
import { discoveryResponse } from "./discovery.js";
import { searchIndexResponse } from "./search-indexing.js";

export { MainnetPaymentCoordinator, MainnetRequestGate };

type PublicMainnetEnv = Record<string, unknown>;
type PublicFetch = (
  request: Request,
  env: PublicMainnetEnv,
  ctx: ExecutionContext,
) => Response | Promise<Response>;
type PublicScheduled = (
  controller: ScheduledController,
  env: PublicMainnetEnv,
  ctx: ExecutionContext,
) => void | Promise<void>;

const mainnetFetch = mainnetHandler.fetch as unknown as PublicFetch;
const mainnetScheduled = mainnetHandler.scheduled as unknown as PublicScheduled;

const handler: ExportedHandler<PublicMainnetEnv> = {
  async fetch(request, env, executionCtx): Promise<Response> {
    const searchIndex = searchIndexResponse(request);
    if (searchIndex !== null) return searchIndex;

    const discovery = discoveryResponse(request);
    if (discovery !== null) return discovery;

    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "POST") {
      const discoveryRequest = new Request(request, {
        method: "GET",
        body: null,
      });
      const response =
        searchIndexResponse(discoveryRequest) ??
        (await mainnetFetch(discoveryRequest, env, executionCtx));
      const headers = new Headers(response.headers);
      headers.set("X-XGuard-Discovery", "root-post");
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return mainnetFetch(request, env, executionCtx);
  },
  async scheduled(controller, env, executionCtx): Promise<void> {
    await mainnetScheduled(controller, env, executionCtx);
  },
};

export default handler;
