import mainnetHandler, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet.js";
import { discoveryResponse } from "./discovery.js";
import { writeEndpointDiscoveryResponse } from "./mainnet-endpoint-discovery.js";
import { paymentLayerIndexResponse } from "./payment-layer-indexing.js";
import { paymentLayerPublicResponse } from "./payment-layer-public.js";
import { portalDesignResponse } from "./portal-design.js";
import { searchIndexResponse } from "./search-indexing.js";
import { valueHarvesterResponse } from "./value-harvester.js";
import { runValueScanner } from "./value-scanner.js";

export { MainnetPaymentCoordinator, MainnetRequestGate };

interface PublicMainnetEnv extends Record<string, unknown> {
  DB: D1Database;
  XGUARD_VALUE_API_KEY?: string;
  XGUARD_VALUE_FEEDS?: string;
  XGUARD_VALUE_FEED_HOSTS?: string;
}

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
const VERIFYMCP_OWNERS_PATH = "/.well-known/owners.json";
const VERIFYMCP_OWNER_EMAIL = "mo.elayyan2023@gmail.com";

function verifyMcpOwnersResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== VERIFYMCP_OWNERS_PATH) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    });
  }

  const body = JSON.stringify({
    $schema: "https://verifymcp.io/schemas/owners.json",
    owners: [VERIFYMCP_OWNER_EMAIL],
  });

  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

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
    const ownership = verifyMcpOwnersResponse(request);
    if (ownership !== null) return ownership;

    const writeEndpointDiscovery = writeEndpointDiscoveryResponse(request);
    if (writeEndpointDiscovery !== null) return writeEndpointDiscovery;

    const valueHarvester = await valueHarvesterResponse(request, env);
    if (valueHarvester !== null) return valueHarvester;

    const paymentLayer = paymentLayerPublicResponse(request);
    if (paymentLayer !== null) return paymentLayer;

    const paymentLayerIndex = paymentLayerIndexResponse(request);
    if (paymentLayerIndex !== null) return paymentLayerIndex;

    const portal = portalDesignResponse(request);
    if (portal !== null) return portal;

    const searchIndex = searchIndexResponse(request);
    if (searchIndex !== null) return searchIndex;

    const discovery = discoveryResponse(normalizeDiscoveryRequest(request));
    if (discovery !== null) return discovery;

    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "POST") {
      const discoveryRequest = new Request(request, {
        method: "GET",
        body: null,
      });
      const response =
        paymentLayerPublicResponse(discoveryRequest) ??
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
    await runValueScanner(env);
  },
};

export default handler;
