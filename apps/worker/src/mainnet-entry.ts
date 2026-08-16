import mainnetHandler, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet.js";
import { discoveryResponse } from "./discovery.js";

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
const FACILITATOR_DISCOVERY_PATH = "/.well-known/x402/facilitator.json";

function normalizeDiscoveryRequest(request: Request): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request;

  const url = new URL(request.url);
  const malformedLiteral = `${FACILITATOR_DISCOVERY_PATH}'`;
  const malformedEncoded = `${FACILITATOR_DISCOVERY_PATH}%27`;

  if (
    url.pathname !== malformedLiteral &&
    url.pathname.toLowerCase() !== malformedEncoded.toLowerCase()
  ) {
    return request;
  }

  url.pathname = FACILITATOR_DISCOVERY_PATH;
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
  });
}

const handler: ExportedHandler<PublicMainnetEnv> = {
  async fetch(request, env, executionCtx): Promise<Response> {
    const normalizedDiscoveryRequest = normalizeDiscoveryRequest(request);
    const discovery = discoveryResponse(normalizedDiscoveryRequest);
    if (discovery !== null) {
      if (normalizedDiscoveryRequest === request) return discovery;

      const headers = new Headers(discovery.headers);
      headers.set("Content-Location", FACILITATOR_DISCOVERY_PATH);
      headers.set("X-XGuard-Discovery-Normalized", "trailing-quote");
      return new Response(discovery.body, {
        status: discovery.status,
        statusText: discovery.statusText,
        headers,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "POST") {
      const discoveryRequest = new Request(request, {
        method: "GET",
        body: null,
      });
      const response = await mainnetFetch(discoveryRequest, env, executionCtx);
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
