export type EndpointDescriptor = {
  method: "GET" | "POST";
  auth: "none" | "api-key";
  contentType: "application/json";
  description: string;
  body?: Record<string, string>;
};

const ENDPOINTS: Record<string, EndpointDescriptor> = {
  "/v1/register": {
    method: "POST",
    auth: "none",
    contentType: "application/json",
    description:
      "Legacy optional merchant registration; it is not required for XGuard's zero-friction x402 path.",
    body: { name: "string" },
  },
  "/v1/topups/intents": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description:
      "Legacy prepaid billing endpoint for existing API-key merchants.",
    body: { amountUsd: "string | number" },
  },
  "/v1/topups/claim": {
    method: "POST",
    auth: "api-key",
    contentType: "application/json",
    description:
      "Legacy prepaid billing endpoint for existing API-key merchants.",
    body: {
      claimToken: "string",
      transactionHash: "0x-prefixed transaction hash",
    },
  },
  "/v1/fees": {
    method: "GET",
    auth: "none",
    contentType: "application/json",
    description:
      "Read the postpaid XGuard service-fee balance for a payTo address using ?payTo=0x....",
  },
  "/v1/fees/claim": {
    method: "POST",
    auth: "none",
    contentType: "application/json",
    description:
      "Credit a finalized Base USDC service-fee payment sent from the same payTo address.",
    body: {
      payTo: "0x-prefixed EVM address",
      transactionHash: "0x-prefixed transaction hash",
    },
  },
  "/verify": {
    method: "POST",
    auth: "none",
    contentType: "application/json",
    description:
      "Verify an x402 payment through XGuard. No signup, API key, or prepaid balance is required.",
  },
  "/settle": {
    method: "POST",
    auth: "none",
    contentType: "application/json",
    description:
      "Settle an x402 payment through XGuard. Fees accrue only after independent finality confirms success.",
  },
};

const TRUTH_PATH = /^\/v1\/settlements\/[0-9a-fA-F]{64}\/truth$/;
const RESOLVE_PATH = /^\/v1\/settlements\/[0-9a-fA-F]{64}\/resolve$/;

function jsonHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function normalizedPathname(request: Request): string {
  const pathname = new URL(request.url).pathname;
  if (pathname.length > 1 && pathname.endsWith("/"))
    return pathname.slice(0, -1);
  return pathname;
}

function descriptorFor(pathname: string): EndpointDescriptor | undefined {
  const staticDescriptor = ENDPOINTS[pathname];
  if (staticDescriptor !== undefined) return staticDescriptor;
  if (TRUTH_PATH.test(pathname))
    return {
      method: "GET",
      auth: "none",
      contentType: "application/json",
      description:
        "Read XGuard's independent settlement truth: FINALIZED, PENDING, PROVEN_FAILED, or CONFLICT.",
    };
  if (RESOLVE_PATH.test(pathname))
    return {
      method: "POST",
      auth: "none",
      contentType: "application/json",
      description:
        "Immediately re-check independent Base finality and ambiguous EIP-3009 recovery evidence.",
    };
  return undefined;
}

export function writeEndpointDiscoveryResponse(
  request: Request,
): Response | null {
  const pathname = normalizedPathname(request);
  const descriptor = descriptorFor(pathname);
  if (descriptor === undefined) return null;
  if (request.method === descriptor.method) return null;

  const allowed = [...new Set(["GET", "HEAD", "OPTIONS", descriptor.method])];
  const allow = allowed.join(", ");
  const commonHeaders = {
    Allow: allow,
    "X-XGuard-Discovery": "endpoint-introspection",
  };

  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...commonHeaders,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });

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
      allowed,
    }),
    {
      status: 405,
      headers: jsonHeaders(commonHeaders),
    },
  );
}
