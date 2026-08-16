import mainnet, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet.js";
import { parseMainnetFacilitatorRequest } from "./mainnet-protocol.js";
import {
  bazaarStats,
  catalogBazaarPayment,
  findBazaarResource,
  listBazaarResources,
  searchBazaarResources,
  type BazaarCatalogOutcome,
} from "./mainnet-bazaar.js";

export { MainnetPaymentCoordinator, MainnetRequestGate };

interface MainnetEdgeEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER: RateLimit;
  [key: string]: unknown;
}

type MainnetFetch = (
  request: Request,
  env: MainnetEdgeEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type MainnetScheduled = (
  controller: ScheduledController,
  env: MainnetEdgeEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const delegateFetch = mainnet.fetch as unknown as MainnetFetch;
const delegateScheduled = mainnet.scheduled as unknown as MainnetScheduled;

const MCP_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const DEFAULT_MCP_PROTOCOL = "2025-11-25";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && isPublicEdgePath(url.pathname)) {
      return corsResponse(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/discovery/resources" && request.method === "GET") {
      const blocked = await publicEdgeGuard(request, env, url.pathname);
      if (blocked !== null) return blocked;
      return discoveryResources(request, env);
    }

    if (url.pathname === "/discovery/search" && request.method === "GET") {
      const blocked = await publicEdgeGuard(request, env, url.pathname);
      if (blocked !== null) return blocked;
      return discoverySearch(request, env);
    }

    if (url.pathname === "/mcp") {
      const blocked = await publicEdgeGuard(request, env, url.pathname);
      if (blocked !== null) return blocked;
      return mcpRequest(request, env);
    }

    if (
      (url.pathname === "/.well-known/mcp/server.json" ||
        url.pathname === "/.well-known/xguard") &&
      request.method === "GET"
    ) {
      return corsJson({
        name: "io.xguard/mainnet",
        title: "XGuard",
        description:
          "x402 facilitator discovery and agent tooling for paid HTTP APIs and MCP tools.",
        version: "0.3.0",
        protocol: "x402-v2",
        network: "eip155:8453",
        remotes: [
          {
            type: "streamable-http",
            url: `${url.origin}/mcp`,
          },
        ],
        discovery: {
          resources: `${url.origin}/discovery/resources`,
          search: `${url.origin}/discovery/search`,
        },
      });
    }

    if (url.pathname === "/supported" && request.method === "GET") {
      const response = await delegateFetch(request, env, ctx);
      return augmentSupported(response);
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const response = await delegateFetch(request, env, ctx);
      return augmentStatus(response, env.DB);
    }

    if (url.pathname === "/" && request.method === "GET") {
      const response = await delegateFetch(request, env, ctx);
      return augmentRoot(response);
    }

    if (
      (url.pathname === "/verify" || url.pathname === "/settle") &&
      request.method === "POST"
    ) {
      return facilitatorWithBazaar(request, env, ctx, url.pathname);
    }

    return delegateFetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await delegateScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<MainnetEdgeEnv>;

async function facilitatorWithBazaar(
  request: Request,
  env: MainnetEdgeEnv,
  ctx: ExecutionContext,
  operation: "/verify" | "/settle",
): Promise<Response> {
  let parsed: Awaited<
    ReturnType<typeof parseMainnetFacilitatorRequest>
  > | null = null;
  try {
    parsed = await parseMainnetFacilitatorRequest(request.clone());
  } catch {
    // The authoritative mainnet handler returns the protocol error. The edge
    // wrapper never weakens or replaces its validation path.
  }

  const response = await delegateFetch(request, env, ctx);
  if (parsed === null || response.status !== 200) return response;

  let body: Record<string, unknown> | null = null;
  try {
    const value = await response.clone().json();
    body = isRecord(value) ? value : null;
  } catch {
    return response;
  }

  const accepted =
    operation === "/verify" ? body?.isValid === true : body?.success === true;
  if (!accepted) return response;

  const replayed = response.headers.get("X-XGuard-Replayed") === "true";
  let outcome: BazaarCatalogOutcome | null = null;
  try {
    outcome = await catalogBazaarPayment(
      env.DB,
      parsed.paymentPayload,
      parsed.paymentRequirements,
      operation === "/settle" && !replayed,
    );
  } catch {
    outcome = bazaarExtensionPresent(parsed.paymentPayload)
      ? { status: "rejected", rejectedReason: "catalog storage unavailable" }
      : null;
  }
  if (outcome === null) return response;

  const headers = new Headers(response.headers);
  headers.set("EXTENSION-RESPONSES", btoa(JSON.stringify({ bazaar: outcome })));
  exposeHeader(headers, "EXTENSION-RESPONSES");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function discoveryResources(request: Request, env: MainnetEdgeEnv) {
  try {
    const url = new URL(request.url);
    const body = await listBazaarResources(env.DB, {
      type: optionalParam(url, "type"),
      payTo: optionalParam(url, "payTo"),
      scheme: optionalParam(url, "scheme"),
      network: optionalParam(url, "network"),
      extensions: optionalParam(url, "extensions"),
      limit: integerParam(url, "limit"),
      offset: integerParam(url, "offset"),
    });
    return corsJson(body);
  } catch (error) {
    return corsJson({ error: errorMessage(error) }, 400);
  }
}

async function discoverySearch(request: Request, env: MainnetEdgeEnv) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() ?? "";
    if (query === "") return corsJson({ error: "query is required" }, 400);
    const body = await searchBazaarResources(env.DB, {
      query,
      type: optionalParam(url, "type"),
      payTo: optionalParam(url, "payTo"),
      scheme: optionalParam(url, "scheme"),
      network: optionalParam(url, "network"),
      extensions: optionalParam(url, "extensions"),
      limit: integerParam(url, "limit"),
      cursor: optionalParam(url, "cursor"),
    });
    return corsJson(body);
  } catch (error) {
    return corsJson({ error: errorMessage(error) }, 400);
  }
}

async function mcpRequest(
  request: Request,
  env: MainnetEdgeEnv,
): Promise<Response> {
  const originError = validateMcpOrigin(request);
  if (originError !== null) return originError;

  if (request.method === "GET") {
    return corsJson(
      {
        error: "sse_not_supported",
        endpoint: new URL(request.url).origin + "/mcp",
      },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }
  if (request.method !== "POST")
    return corsJson({ error: "method_not_allowed" }, 405, {
      Allow: "POST, OPTIONS",
    });

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  )
    return corsJson({ error: "mcp_accept_header_required" }, 406);

  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    return corsJson({ error: "application_json_required" }, 415);

  let rpc: Record<string, unknown>;
  try {
    const text = await readBodyCapped(request, 128 * 1024);
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid_json_rpc");
    rpc = parsed;
  } catch (error) {
    return mcpError(null, -32700, errorMessage(error));
  }

  if (rpc.jsonrpc !== "2.0") return mcpError(null, -32600, "Invalid Request");

  if (typeof rpc.method !== "string")
    return corsResponse(new Response(null, { status: 202 }));

  const id = rpc.id ?? null;
  const method = rpc.method;
  const params = isRecord(rpc.params) ? rpc.params : {};
  const isNotification = rpc.id === undefined;

  if (method === "initialize") {
    if (isNotification)
      return corsResponse(new Response(null, { status: 202 }));
    const requested =
      typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const protocolVersion = MCP_PROTOCOLS.has(requested)
      ? requested
      : DEFAULT_MCP_PROTOCOL;
    return mcpResult(
      id,
      {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "xguard-mainnet",
          version: "0.3.0",
        },
        instructions:
          "Use xguard_discover to find paid x402 HTTP APIs and MCP tools cataloged by XGuard.",
      },
      protocolVersion,
    );
  }

  const protocolVersion =
    request.headers.get("mcp-protocol-version") ?? "2025-03-26";
  if (!MCP_PROTOCOLS.has(protocolVersion))
    return corsJson({ error: "unsupported_mcp_protocol_version" }, 400);

  if (isNotification)
    return corsResponse(new Response(null, { status: 202 }));

  if (method === "ping") return mcpResult(id, {});

  if (method === "tools/list") {
    return mcpResult(id, {
      tools: mcpTools(),
    });
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
      if (name === "xguard_discover") {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const type =
          args.type === "http" || args.type === "mcp" ? args.type : undefined;
        const payTo = typeof args.payTo === "string" ? args.payTo : undefined;
        const limit =
          typeof args.limit === "number" ? Math.trunc(args.limit) : 10;
        const result = query
          ? await searchBazaarResources(env.DB, { query, type, payTo, limit })
          : await listBazaarResources(env.DB, { type, payTo, limit });
        return mcpToolResult(id, result);
      }

      if (name === "xguard_resource_details") {
        const resource =
          typeof args.resource === "string" ? args.resource.trim() : "";
        if (resource === "") return mcpToolError(id, "resource is required");
        return mcpToolResult(id, {
          resource,
          matches: await findBazaarResource(env.DB, resource),
        });
      }

      if (name === "xguard_status") {
        return mcpToolResult(id, {
          status: "operational",
          mode: "mainnet",
          protocol: "x402-v2",
          network: "eip155:8453",
          discovery: await bazaarStats(env.DB),
        });
      }

      return mcpError(id, -32602, "unknown tool");
    } catch (error) {
      return mcpToolError(id, errorMessage(error));
    }
  }

  return mcpError(id, -32601, "Method not found");
}

function mcpTools() {
  return [
    {
      name: "xguard_discover",
      description:
        "Discover paid x402 HTTP APIs and MCP tools cataloged by XGuard. Use a natural-language query or list recent resources.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language search query.",
          },
          type: { type: "string", enum: ["http", "mcp"] },
          payTo: {
            type: "string",
            description: "Optional payment recipient address.",
          },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "xguard_resource_details",
      description:
        "Return XGuard catalog records for one exact resource URL or resource key.",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string" },
        },
        required: ["resource"],
        additionalProperties: false,
      },
    },
    {
      name: "xguard_status",
      description: "Return XGuard mainnet and discovery catalog status.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

async function augmentSupported(response: Response): Promise<Response> {
  if (!response.ok) return response;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const current = Array.isArray(body.extensions)
      ? body.extensions.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    body.extensions = [...new Set([...current, "bazaar"])];
    return jsonFrom(response, body);
  } catch {
    return response;
  }
}

async function augmentStatus(
  response: Response,
  db: D1Database,
): Promise<Response> {
  if (!response.ok) return response;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    body.discovery = await bazaarStats(db);
    body.mcp = { endpoint: "/mcp", transport: "streamable-http" };
    return jsonFrom(response, body);
  } catch {
    return response;
  }
}

async function augmentRoot(response: Response): Promise<Response> {
  if (!response.ok) return response;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const endpoints = isRecord(body.endpoints) ? body.endpoints : {};
    body.endpoints = {
      ...endpoints,
      discovery: "/discovery/resources",
      discoverySearch: "/discovery/search",
      mcp: "/mcp",
      mcpManifest: "/.well-known/mcp/server.json",
    };
    body.discovery = { extension: "bazaar", native: true };
    return jsonFrom(response, body);
  } catch {
    return response;
  }
}

async function publicEdgeGuard(
  request: Request,
  env: MainnetEdgeEnv,
  path: string,
): Promise<Response | null> {
  const client =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  try {
    const perClient = await env.REQUEST_RATE_LIMITER.limit({
      key: `public:${path}:${client}`,
    });
    if (!perClient.success)
      return corsJson({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
    return null;
  } catch {
    return corsJson({ error: "protection_unavailable" }, 503);
  }
}

function validateMcpOrigin(request: Request): Response | null {
  const rawOrigin = request.headers.get("origin");
  if (rawOrigin === null) return null;
  try {
    const origin = new URL(rawOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username !== "" ||
      origin.password !== "" ||
      isLocalOriginHost(origin.hostname)
    )
      throw new Error("invalid_origin");
    return null;
  } catch {
    return corsJson({ error: "invalid_origin" }, 403);
  }
}

function isLocalOriginHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

function isPublicEdgePath(path: string) {
  return (
    path === "/mcp" ||
    path === "/discovery/resources" ||
    path === "/discovery/search" ||
    path === "/.well-known/mcp/server.json" ||
    path === "/.well-known/xguard"
  );
}

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function integerParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function bazaarExtensionPresent(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return isRecord(payload.extensions) && "bazaar" in payload.extensions;
}

function mcpResult(id: unknown, result: unknown, protocolVersion?: string) {
  return corsJson(
    { jsonrpc: "2.0", id, result },
    200,
    protocolVersion === undefined
      ? undefined
      : { "MCP-Protocol-Version": protocolVersion },
  );
}

function mcpError(id: unknown, code: number, message: string) {
  return corsJson({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function mcpToolResult(id: unknown, value: unknown) {
  return mcpResult(id, {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  });
}

function mcpToolError(id: unknown, message: string) {
  return mcpResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function corsJson(
  value: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return corsResponse(
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...(extraHeaders ?? {}),
      },
    }),
  );
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, MCP-Session-Id",
  );
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Expose-Headers",
    mergeHeaderValues(
      headers.get("Access-Control-Expose-Headers"),
      "EXTENSION-RESPONSES, MCP-Protocol-Version",
    ),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonFrom(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function exposeHeader(headers: Headers, value: string) {
  headers.set(
    "Access-Control-Expose-Headers",
    mergeHeaderValues(headers.get("Access-Control-Expose-Headers"), value),
  );
}

function mergeHeaderValues(current: string | null, additional: string): string {
  const values = new Set(
    `${current ?? ""},${additional}`
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return [...values].join(", ");
}

async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("request_body_too_large");
  return text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "request_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
