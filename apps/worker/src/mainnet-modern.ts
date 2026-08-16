import mainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-supervisor.js";
import {
  modernMcpOptions,
  modernMcpRequest,
  shouldUseModernMcp,
} from "./mainnet-mcp-modern.js";
import {
  enhanceAgentDiscoveryResponse,
  modernMcpManifest,
} from "./agent-discovery-modern.js";
import { compatibilityDiscoveryResponse } from "./discovery-compat.js";
import { mainnetBrandingResponse } from "./mainnet-branding.js";
import { a2aOptions, a2aRequest } from "./mainnet-a2a.js";

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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;
    const url = new URL(standardRequest.url);

    const branding = mainnetBrandingResponse(standardRequest);
    if (branding !== null) return branding;

    const compatibilityDiscovery =
      await compatibilityDiscoveryResponse(standardRequest);
    if (compatibilityDiscovery !== null) return compatibilityDiscovery;

    if (url.pathname === "/a2a" && standardRequest.method === "OPTIONS")
      return a2aOptions();

    if (url.pathname === "/a2a" && standardRequest.method === "POST") {
      const blocked = await publicAgentGuard(standardRequest, env, "/a2a");
      if (blocked !== null) return blocked;
      return a2aRequest(standardRequest, async (kind) => {
        const response = await delegateFetch(
          new Request(`${url.origin}/${kind}`),
          env,
          ctx,
        );
        if (!response.ok) throw new Error(`${kind}_unavailable`);
        return response.json();
      });
    }

    if (url.pathname === "/mcp" && standardRequest.method === "OPTIONS")
      return modernMcpOptions(standardRequest);

    if (
      url.pathname === "/mcp" &&
      standardRequest.method === "POST" &&
      shouldUseModernMcp(standardRequest)
    ) {
      const blocked = await publicAgentGuard(standardRequest, env, "/mcp");
      if (blocked !== null) return blocked;
      return modernMcpRequest(standardRequest, env, async () => {
        const statusResponse = await delegateFetch(
          new Request(`${url.origin}/status`),
          env,
          ctx,
        );
        if (!statusResponse.ok) throw new Error("status_unavailable");
        return statusResponse.json();
      });
    }

    if (
      standardRequest.method === "GET" &&
      (url.pathname === "/.well-known/mcp/server.json" ||
        url.pathname === "/.well-known/xguard")
    )
      return publicJson(modernMcpManifest(url.origin));

    const response = await delegateFetch(standardRequest, env, ctx);
    if (
      standardRequest.method === "GET" &&
      (url.pathname === "/.well-known/agent-card.json" ||
        url.pathname === "/.well-known/agent.json" ||
        url.pathname === "/.well-known/agent-market.json" ||
        url.pathname === "/openapi.json" ||
        url.pathname === "/llms.txt" ||
        url.pathname === "/llms-full.txt")
    )
      return enhanceAgentDiscoveryResponse(standardRequest, response);
    return response;
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<MainnetModernEnv>;

async function publicAgentGuard(
  request: Request,
  env: MainnetModernEnv,
  path: "/a2a" | "/mcp",
): Promise<Response | null> {
  const client =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `public:${path}:${client}`,
    });
    if (decision.success) return null;
    return publicJson({ error: "rate_limit_exceeded" }, 429, {
      "Retry-After": "60",
    });
  } catch {
    return publicJson({ error: "protection_unavailable" }, 503);
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
