import mainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-supervisor.js";
import {
  modernMcpOptions,
  modernMcpRequest,
  shouldUseModernMcp,
  xguardMcpTools,
} from "./mainnet-mcp-modern.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "./agent-discovery-modern.js";
import { compatibilityDiscoveryResponse } from "./discovery-compat.js";
import { mainnetBrandingResponse } from "./mainnet-branding.js";
import { mcpubDiscoveryResponse } from "./mcpub-discovery.js";

export { MainnetPaymentCoordinator, MainnetRequestGate, XPayGlobalRateGate };

interface MainnetModernEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER: RateLimit;
  [key: string]: unknown;
}

type MainnetFetch = (
  request: Request,
  env: MainnetModernEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type MainnetScheduled = (
  controller: ScheduledController,
  env: MainnetModernEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = mainnet.fetch as unknown as MainnetFetch;
const delegateScheduled = mainnet.scheduled as unknown as MainnetScheduled;
const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;
    const url = new URL(standardRequest.url);

    const httpsRedirect = redirectPlaintextRequest(standardRequest, url);
    if (httpsRedirect !== null) return secureResponse(httpsRedirect);

    const branding = mainnetBrandingResponse(standardRequest);
    if (branding !== null) return secureResponse(branding);

    const compatibilityDiscovery =
      await compatibilityDiscoveryResponse(standardRequest);
    if (compatibilityDiscovery !== null)
      return secureResponse(compatibilityDiscovery);

    const mcpubDiscovery = mcpubDiscoveryResponse(standardRequest);
    if (mcpubDiscovery !== null) return secureResponse(mcpubDiscovery);

    if (
      standardRequest.method === "GET" &&
      url.pathname === "/.well-known/xguard/migrate"
    )
      return secureResponse(publicJson(migrationKit(url)));

    if (url.pathname === "/mcp" && standardRequest.method === "OPTIONS")
      return secureResponse(modernMcpOptions(standardRequest));

    if (
      url.pathname === "/mcp" &&
      standardRequest.method === "POST" &&
      shouldUseModernMcp(standardRequest)
    ) {
      const blocked = await publicMcpGuard(standardRequest, env);
      if (blocked !== null) return secureResponse(blocked);
      return secureResponse(
        await modernMcpRequest(standardRequest, env, async () => {
          const statusResponse = await delegateFetch(
            new Request(`${url.origin}/status`),
            env,
            ctx,
          );
          if (!statusResponse.ok) throw new Error("status_unavailable");
          return statusResponse.json();
        }),
      );
    }

    if (
      standardRequest.method === "GET" &&
      (url.pathname === "/.well-known/mcp/server.json" ||
        url.pathname === "/.well-known/xguard")
    )
      return secureResponse(publicJson(modernMcpManifest(url.origin)));

    let response = await delegateFetch(standardRequest, env, ctx);

    if (url.pathname === "/mcp" && standardRequest.method === "POST")
      response = await normalizeLegacyMcpToolList(response);

    if (
      standardRequest.method === "GET" &&
      (url.pathname === "/.well-known/agent-card.json" ||
        url.pathname === "/.well-known/agent.json" ||
        url.pathname === "/.well-known/agent-market.json" ||
        url.pathname === "/openapi.json" ||
        url.pathname === "/llms.txt" ||
        url.pathname === "/llms-full.txt")
    )
      response = await enhanceAgentDiscoveryResponse(standardRequest, response);

    return secureResponse(response);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<MainnetModernEnv>;

function migrationKit(url: URL) {
  const sources = [
    ...new Set(
      (url.searchParams.get("from") ?? "unknown")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value === "cdp" || value === "payai"),
    ),
  ];
  const resource = migrationResource(url.searchParams.get("resource"));
  const requestedName = (url.searchParams.get("name") ?? "")
    .trim()
    .slice(0, 160);
  const merchantName =
    requestedName ||
    (resource === null ? "merchant" : new URL(resource).hostname);

  return {
    schemaVersion: "1",
    title: "XGuard x402 facilitator switch kit",
    protocol: "x402-v2",
    network: "eip155:8453",
    target: {
      merchant: merchantName,
      resource,
      sourceFacilitators: sources.length > 0 ? sources : ["unknown"],
    },
    xguard: {
      origin: url.origin,
      register: `${url.origin}/v1/register`,
      balance: `${url.origin}/v1/balance`,
      topUpIntent: `${url.origin}/v1/topups/intents`,
      supported: `${url.origin}/supported`,
      verify: `${url.origin}/verify`,
      settle: `${url.origin}/settle`,
      discovery: `${url.origin}/discovery/resources`,
    },
    steps: [
      {
        id: "register",
        request: {
          method: "POST",
          url: `${url.origin}/v1/register`,
          headers: { "Content-Type": "application/json" },
          body: { name: merchantName },
        },
        output: "Store the returned apiKey; XGuard stores only its hash.",
      },
      {
        id: "fund-service-balance",
        request: {
          method: "POST",
          url: `${url.origin}/v1/topups/intents`,
          authorization: "Bearer <apiKey>",
        },
        note: "Create a Base USDC prepaid service-balance intent before billable settlements.",
      },
      {
        id: "switch-facilitator",
        facilitatorBaseUrl: url.origin,
        authorization: "Bearer <apiKey>",
        preserve: [
          "existing x402 middleware",
          "payment requirements",
          "payTo recipient",
          "resource pricing",
        ],
      },
      {
        id: "verify-cutover",
        checks: [
          `GET ${url.origin}/supported`,
          `POST ${url.origin}/verify`,
          `POST ${url.origin}/settle`,
          `GET ${url.origin}/discovery/resources?network=eip155%3A8453`,
        ],
      },
    ],
    sideEffects: false,
    note: "This endpoint generates instructions only. It does not register, fund, modify, or contact any third-party service.",
  };
}

function migrationResource(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > 2_048) return null;
  try {
    const resource = new URL(value);
    if (resource.protocol !== "https:" && resource.protocol !== "http:")
      return null;
    resource.hash = "";
    return resource.toString();
  } catch {
    return null;
  }
}

async function publicMcpGuard(
  request: Request,
  env: MainnetModernEnv,
): Promise<Response | null> {
  const client =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `public:/mcp:${client}`,
    });
    if (decision.success) return null;
    return publicJson({ error: "rate_limit_exceeded" }, 429, {
      "Retry-After": "60",
    });
  } catch {
    return publicJson({ error: "protection_unavailable" }, 503);
  }
}

function redirectPlaintextRequest(request: Request, url: URL): Response | null {
  if (!isPlaintextRequest(request, url)) return null;
  const location = new URL(url.toString());
  location.protocol = "https:";
  return new Response(null, {
    status: 308,
    headers: {
      Location: location.toString(),
      "Cache-Control": "no-store",
    },
  });
}

function isPlaintextRequest(request: Request, url: URL): boolean {
  if (url.protocol === "http:") return true;

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "http") return true;

  const visitor = request.headers.get("cf-visitor");
  if (visitor !== null) {
    try {
      const parsed = JSON.parse(visitor) as unknown;
      if (isRecord(parsed) && parsed.scheme === "http") return true;
    } catch {
      // Ignore malformed proxy metadata and fall back to the request URL.
    }
  }

  return false;
}

async function normalizeLegacyMcpToolList(
  response: Response,
): Promise<Response> {
  if (!response.ok) return response;
  if (
    !(response.headers.get("content-type") ?? "").includes("application/json")
  )
    return response;

  try {
    const body = (await response.clone().json()) as unknown;
    if (!isRecord(body) || !isRecord(body.result)) return response;
    const result = body.result;
    if (!Array.isArray(result.tools)) return response;

    const advertisedNames = new Set(
      result.tools
        .filter(isRecord)
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === "string"),
    );
    result.tools = xguardMcpTools().filter((tool) =>
      advertisedNames.has(tool.name),
    );
    return jsonFromResponse(response, body);
  } catch {
    return response;
  }
}

function publicJson(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function jsonFromResponse(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
