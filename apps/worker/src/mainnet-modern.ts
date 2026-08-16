import mainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  XPayGlobalRateGate,
} from "./mainnet-supervisor.js";
import { A2A_PATH, a2aOptions, a2aRequest } from "./mainnet-a2a.js";
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
const MCP_TELEMETRY_MAX_BODY_BYTES = 8 * 1024;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const standardRequest = request as unknown as Request;
    const url = new URL(standardRequest.url);

    const httpsRedirect = redirectPlaintextRequest(standardRequest, url);
    if (httpsRedirect !== null) return secureResponse(httpsRedirect);

    if (url.pathname === "/mcp" && standardRequest.method === "POST")
      ctx.waitUntil(observeMcpRpcRequest(standardRequest));

    const branding = mainnetBrandingResponse(standardRequest);
    if (branding !== null) return secureResponse(branding);

    const compatibilityDiscovery =
      await compatibilityDiscoveryResponse(standardRequest);
    if (compatibilityDiscovery !== null)
      return secureResponse(compatibilityDiscovery);

    const mcpubDiscovery = mcpubDiscoveryResponse(standardRequest);
    if (mcpubDiscovery !== null) return secureResponse(mcpubDiscovery);

    if (url.pathname === A2A_PATH && standardRequest.method === "OPTIONS")
      return secureResponse(a2aOptions());

    if (url.pathname === A2A_PATH && standardRequest.method === "POST") {
      const blocked = await publicEndpointGuard(standardRequest, env, "a2a");
      if (blocked !== null) return secureResponse(blocked);
      return secureResponse(await a2aRequest(standardRequest));
    }

    if (url.pathname === "/mcp" && standardRequest.method === "OPTIONS")
      return secureResponse(modernMcpOptions(standardRequest));

    if (
      url.pathname === "/mcp" &&
      standardRequest.method === "POST" &&
      shouldUseModernMcp(standardRequest)
    ) {
      const blocked = await publicEndpointGuard(standardRequest, env, "mcp");
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

async function observeMcpRpcRequest(request: Request): Promise<void> {
  const protocolVersionHeader = request.headers.get("mcp-protocol-version");
  const methodHeader = request.headers.get("mcp-method");
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const declaredLength = request.headers.get("content-length");
  const era = shouldUseModernMcp(request) ? "modern" : "legacy";

  if (declaredLength === null) {
    logMcpTelemetry({
      era,
      rpcMethod: methodHeader ?? "unknown",
      toolName: null,
      protocolVersion: protocolVersionHeader ?? "unspecified",
      protocolVersionSource:
        protocolVersionHeader === null ? "absent" : "header",
      methodHeaderPresent: methodHeader !== null,
      methodHeaderMatches: null,
      userAgent,
      parseState: "length_unknown",
    });
    return;
  }

  const declaredBytes = Number(declaredLength);
  if (
    !Number.isFinite(declaredBytes) ||
    declaredBytes < 0 ||
    declaredBytes > MCP_TELEMETRY_MAX_BODY_BYTES
  ) {
    logMcpTelemetry({
      era,
      rpcMethod: methodHeader ?? "unknown",
      toolName: null,
      protocolVersion: protocolVersionHeader ?? "unspecified",
      protocolVersionSource:
        protocolVersionHeader === null ? "absent" : "header",
      methodHeaderPresent: methodHeader !== null,
      methodHeaderMatches: null,
      userAgent,
      parseState: "body_not_sampled",
    });
    return;
  }

  try {
    const text = await request.clone().text();
    if (
      new TextEncoder().encode(text).byteLength > MCP_TELEMETRY_MAX_BODY_BYTES
    )
      throw new Error("sample_limit_exceeded");

    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid_json_rpc");
    const rpcMethod =
      typeof parsed.method === "string" ? parsed.method : "unknown";
    const params = isRecord(parsed.params) ? parsed.params : {};
    const initializeProtocolVersion =
      rpcMethod === "initialize" && typeof params.protocolVersion === "string"
        ? params.protocolVersion
        : null;
    const toolName =
      rpcMethod === "tools/call" && typeof params.name === "string"
        ? params.name
        : null;

    logMcpTelemetry({
      era,
      rpcMethod,
      toolName,
      protocolVersion:
        protocolVersionHeader ?? initializeProtocolVersion ?? "unspecified",
      protocolVersionSource:
        protocolVersionHeader !== null
          ? "header"
          : initializeProtocolVersion !== null
            ? "initialize_params"
            : "absent",
      methodHeaderPresent: methodHeader !== null,
      methodHeaderMatches:
        methodHeader === null || rpcMethod === "unknown"
          ? null
          : methodHeader === rpcMethod,
      userAgent,
      parseState: "parsed",
    });
  } catch {
    logMcpTelemetry({
      era,
      rpcMethod: methodHeader ?? "unknown",
      toolName: null,
      protocolVersion: protocolVersionHeader ?? "unspecified",
      protocolVersionSource:
        protocolVersionHeader === null ? "absent" : "header",
      methodHeaderPresent: methodHeader !== null,
      methodHeaderMatches: null,
      userAgent,
      parseState: "unparsed",
    });
  }
}

function logMcpTelemetry(value: {
  era: "modern" | "legacy";
  rpcMethod: string;
  toolName: string | null;
  protocolVersion: string;
  protocolVersionSource: "header" | "initialize_params" | "absent";
  methodHeaderPresent: boolean;
  methodHeaderMatches: boolean | null;
  userAgent: string;
  parseState: "parsed" | "unparsed" | "body_not_sampled" | "length_unknown";
}) {
  console.log(
    JSON.stringify({
      event: "mcp_rpc_request",
      ...value,
    }),
  );
}

async function publicEndpointGuard(
  request: Request,
  env: MainnetModernEnv,
  surface: "mcp" | "a2a",
): Promise<Response | null> {
  const client =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `public:/${surface}:${client}`,
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
