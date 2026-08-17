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

type WriteEndpointDescriptor = {
  method: "POST";
  auth: "none" | "api-key";
  contentType: "application/json";
  description: string;
  body?: Record<string, string>;
};

const mainnetFetch = mainnetHandler.fetch as unknown as PublicFetch;
const mainnetScheduled = mainnetHandler.scheduled as unknown as PublicScheduled;
const FACILITATOR_DISCOVERY_PATH = "/.well-known/x402/facilitator.json";
const VERIFYMCP_OWNERS_PATH = "/.well-known/owners.json";
const VERIFYMCP_OWNER_EMAIL = "mo.elayyan2023@gmail.com";

const WRITE_ENDPOINTS: Record<string, WriteEndpointDescriptor> = {
  "/v1/register": {
    method: "POST",
    auth: "none",
    contentType: "application/json",
    description: "Create an XGuard merchant and return its one-time API key.",
    body: { name: "string" },
  },
  "/v1/topups/intents": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description: "Create a prepaid USDC top-up intent.",
    body: { amountUsd: "string | number" },
  },
  "/v1/topups/claim": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description: "Claim a finalized prepaid USDC top-up.",
    body: {
      claimToken: "string",
      transactionHash: "0x-prefixed transaction hash",
    },
  },
  "/verify": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description: "Verify an x402 payment request through XGuard.",
  },
  "/settle": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description: "Settle an x402 payment request through XGuard.",
  },
};

function jsonHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function normalizedPathname(request: Request): string {
  const pathname = new URL(request.url).pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function writeEndpointDiscoveryResponse(request: Request): Response | null {
  const pathname = normalizedPathname(request);
  const descriptor = WRITE_ENDPOINTS[pathname];
  if (descriptor === undefined) return null;

  if (request.method === descriptor.method) return null;

  const allow = `GET, HEAD, OPTIONS, ${descriptor.method}`;
  const commonHeaders = {
    Allow: allow,
    "X-XGuard-Discovery": "endpoint-introspection",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...commonHeaders,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const body = JSON.stringify({
      service: "XGuard",
      endpoint: pathname,
      ...descriptor,
    });

    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: jsonHeaders(commonHeaders),
    });
  }

  return new Response(
    JSON.stringify({
      error: "method_not_allowed",
      endpoint: pathname,
      allowed: ["GET", "HEAD", "OPTIONS", descriptor.method],
    }),
    {
      status: 405,
      headers: jsonHeaders(commonHeaders),
    },
  );
}

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
