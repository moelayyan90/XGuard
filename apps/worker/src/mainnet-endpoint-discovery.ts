export type WriteEndpointDescriptor = {
  method: "POST";
  auth: "none" | "api-key";
  contentType: "application/json";
  description: string;
  body?: Record<string, string>;
};

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

export function writeEndpointDiscoveryResponse(
  request: Request,
): Response | null {
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
