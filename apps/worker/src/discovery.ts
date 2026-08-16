const XGUARD_VERSION = "0.2.0-mainnet-rc";
const AGENT_CARD_ETAG = '"xguard-agent-card-0.2.0-mainnet-rc"';
const DISCOVERY_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

export function discoveryResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const origin = url.origin;

  switch (url.pathname) {
    case "/.well-known/agent-card.json":
    case "/.well-known/agent.json":
      return jsonResponse(request, buildAgentCard(origin), {
        "Content-Type": "application/json; charset=utf-8",
        ETag: AGENT_CARD_ETAG,
      });
    case "/.well-known/agent-market.json":
      return jsonResponse(request, buildAgentMarket(origin));
    case "/openapi.json":
      return jsonResponse(request, buildOpenApi(origin));
    case "/llms.txt":
      return textResponse(request, buildLlms(origin));
    case "/llms-full.txt":
      return textResponse(request, buildLlmsFull(origin));
    case "/robots.txt":
      return textResponse(request, buildRobots(origin));
    default:
      return null;
  }
}

function buildAgentCard(origin: string): Record<string, unknown> {
  return {
    name: "XGuard",
    description:
      "A safety, verification, idempotency, finality, and settlement gateway for x402 v2 payments on Base mainnet. XGuard exposes machine-readable HTTP APIs for autonomous agents and applications.",
    supportedInterfaces: [
      {
        url: origin,
        protocolBinding:
          "https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md",
        protocolVersion: "2",
      },
    ],
    version: XGUARD_VERSION,
    documentationUrl: `${origin}/llms-full.txt`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "x402-capability-discovery",
        name: "Discover x402 payment capabilities",
        description:
          "Returns the x402 v2 payment kinds, networks, schemes, extensions, and signer capabilities currently exposed by XGuard.",
        tags: ["x402", "payments", "discovery", "base", "usdc"],
        examples: [`GET ${origin}/supported`],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "x402-payment-verification",
        name: "Verify x402 payment authorization",
        description:
          "Validates an x402 v2 payment authorization through XGuard's guarded facilitator route. Requires a merchant Bearer API key.",
        tags: ["x402", "verify", "payments", "security"],
        examples: [`POST ${origin}/verify`],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "x402-payment-settlement",
        name: "Settle x402 payment",
        description:
          "Submits an x402 v2 settlement through XGuard with duplicate protection, durable coordination, finality tracking, and fee accounting. Requires a merchant Bearer API key and service balance.",
        tags: [
          "x402",
          "settlement",
          "payments",
          "idempotency",
          "finality",
        ],
        examples: [`POST ${origin}/settle`],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

function buildAgentMarket(origin: string): Record<string, unknown> {
  return {
    name: "XGuard",
    version: XGUARD_VERSION,
    description:
      "Machine-discoverable x402 v2 verification and settlement gateway for autonomous agents and applications.",
    protocol: "x402-v2",
    network: "eip155:8453",
    asset: "USDC",
    discovery: {
      agentCard: `${origin}/.well-known/agent-card.json`,
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
      llmsFull: `${origin}/llms-full.txt`,
      supported: `${origin}/supported`,
      status: `${origin}/status`,
      health: `${origin}/healthz`,
      readiness: `${origin}/readyz`,
    },
    commercialModel: {
      event: "successful_billable_settlement",
      feeUsd: "0.002",
      billing: "merchant_prepaid_service_balance",
    },
    authentication: {
      type: "http-bearer",
      registrationEndpoint: `${origin}/v1/register`,
      protectedEndpoints: [
        "/v1/balance",
        "/v1/topups/intents",
        "/v1/topups/claim",
        "/verify",
        "/settle",
      ],
    },
  };
}

function buildOpenApi(origin: string): Record<string, unknown> {
  const paymentBody = {
    type: "object",
    description:
      "x402 v2 facilitator request containing paymentPayload and paymentRequirements as defined by the x402 specification.",
    additionalProperties: true,
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "XGuard Mainnet API",
      version: XGUARD_VERSION,
      description:
        "Guarded x402 v2 verification and settlement API for Base mainnet USDC.",
    },
    servers: [{ url: origin }],
    tags: [
      { name: "Discovery" },
      { name: "Merchant" },
      { name: "Payments" },
    ],
    paths: {
      "/": {
        get: {
          tags: ["Discovery"],
          summary: "Describe XGuard",
          responses: { "200": { description: "XGuard service metadata" } },
        },
      },
      "/healthz": {
        get: {
          tags: ["Discovery"],
          summary: "Liveness check",
          responses: { "200": { description: "Worker is alive" } },
        },
      },
      "/readyz": {
        get: {
          tags: ["Discovery"],
          summary: "Readiness check",
          responses: {
            "200": { description: "Mainnet route is ready" },
            "503": { description: "Mainnet route is degraded or unavailable" },
          },
        },
      },
      "/supported": {
        get: {
          tags: ["Discovery"],
          summary: "List supported x402 kinds",
          responses: {
            "200": { description: "Supported x402 capabilities" },
          },
        },
      },
      "/status": {
        get: {
          tags: ["Discovery"],
          summary: "Read operational status",
          responses: {
            "200": { description: "Operational status and settlement counters" },
          },
        },
      },
      "/v1/register": {
        post: {
          tags: ["Merchant"],
          summary: "Register a merchant",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": { description: "Merchant registered and API key issued" },
          },
        },
      },
      "/v1/balance": {
        get: {
          tags: ["Merchant"],
          summary: "Read merchant service balance",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Merchant balance" },
            "401": { description: "Missing or invalid merchant API key" },
          },
        },
      },
      "/v1/topups/intents": {
        post: {
          tags: ["Merchant"],
          summary: "Create a service-balance top-up intent",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["amountUsd"],
                  properties: {
                    amountUsd: {
                      oneOf: [{ type: "string" }, { type: "number" }],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Top-up intent created" },
            "401": { description: "Missing or invalid merchant API key" },
          },
        },
      },
      "/v1/topups/claim": {
        post: {
          tags: ["Merchant"],
          summary: "Claim a finalized Base USDC top-up",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["claimToken", "transactionHash"],
                  properties: {
                    claimToken: { type: "string" },
                    transactionHash: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Top-up credited" },
            "401": { description: "Missing or invalid merchant API key" },
          },
        },
      },
      "/verify": {
        post: {
          tags: ["Payments"],
          summary: "Verify an x402 v2 payment authorization",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: paymentBody } },
          },
          responses: {
            "200": { description: "x402 verification result" },
            "400": { description: "Malformed or unsupported payment request" },
            "401": { description: "Missing or invalid merchant API key" },
            "503": { description: "No healthy facilitator route is available" },
          },
        },
      },
      "/settle": {
        post: {
          tags: ["Payments"],
          summary: "Settle an x402 v2 payment",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: paymentBody } },
          },
          responses: {
            "200": { description: "x402 settlement result" },
            "400": { description: "Malformed or unsupported payment request" },
            "401": { description: "Missing or invalid merchant API key" },
            "402": { description: "Merchant service balance is insufficient" },
            "409": {
              description: "Duplicate, conflicting, or in-progress settlement",
            },
            "503": {
              description: "Settlement outcome is ambiguous or route unavailable",
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Merchant API key returned once by POST /v1/register.",
        },
      },
    },
  };
}

function buildLlms(origin: string): string {
  return `# XGuard

> XGuard is a guarded x402 v2 verification and settlement gateway for autonomous agents and applications on Base mainnet USDC.

XGuard charges $0.002 only for a successful billable settlement. Verification, malformed requests, failed settlements, duplicates, replays, and discovery requests are not billable.

## Discovery
- [Agent Card](${origin}/.well-known/agent-card.json): machine-readable agent/service capability metadata
- [OpenAPI](${origin}/openapi.json): complete HTTP API description
- [Supported x402 kinds](${origin}/supported): live x402 capabilities
- [Status](${origin}/status): operational status
- [Readiness](${origin}/readyz): live mainnet route readiness

## Core API
- POST ${origin}/v1/register — create a merchant identity and receive a Bearer API key
- POST ${origin}/verify — verify an x402 v2 payment authorization
- POST ${origin}/settle — settle an x402 v2 payment with duplicate protection and finality tracking

## Authentication
Protected merchant and payment endpoints use Authorization: Bearer <merchant-api-key>.

## Protocol
x402 version 2; Base mainnet (eip155:8453); exact scheme; native USDC.
`;
}

function buildLlmsFull(origin: string): string {
  return `${buildLlms(origin)}
## Merchant balance
- GET ${origin}/v1/balance — current prepaid XGuard service balance
- POST ${origin}/v1/topups/intents — create an exact Base USDC top-up intent
- POST ${origin}/v1/topups/claim — claim a finalized top-up transaction

## Settlement safety semantics
XGuard derives stable payment identities, rejects conflicting active authorizations, coordinates settlement durably, prevents automatic retries when downstream outcome is ambiguous, tracks Base USDC finality, and earns its service fee only after successful finality confirmation.

## HTTP behavior
- 200: successful discovery/verification/settlement response
- 400: malformed or unsupported request
- 401: merchant API key missing or invalid
- 402: merchant service balance cannot cover the XGuard fee
- 409: duplicate/conflicting/in-progress settlement state
- 429: request or concurrency limit exceeded
- 503: protected dependency unavailable or settlement result is ambiguous

## Machine-readable contract
Use ${origin}/openapi.json as the authoritative HTTP interface description and ${origin}/supported for live x402 network/scheme support.
`;
}

function buildRobots(origin: string): string {
  return `User-agent: *
Allow: /

# Machine-readable AI/service discovery
# ${origin}/llms.txt
# ${origin}/.well-known/agent-card.json
# ${origin}/openapi.json
`;
}

function jsonResponse(
  request: Request,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const etag = extraHeaders.ETag;
  if (etag !== undefined && request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: publicHeaders(extraHeaders),
    });
  }

  const body = request.method === "HEAD" ? null : JSON.stringify(value, null, 2);
  return new Response(body, {
    status: 200,
    headers: publicHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function textResponse(request: Request, value: string): Response {
  return new Response(request.method === "HEAD" ? null : value, {
    status: 200,
    headers: publicHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

function publicHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": DISCOVERY_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}
