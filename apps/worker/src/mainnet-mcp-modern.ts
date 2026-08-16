import {
  bazaarStats,
  findBazaarResource,
  listBazaarResources,
  searchBazaarResources,
} from "./mainnet-bazaar.js";

export const MODERN_MCP_PROTOCOL = "2026-07-28";
export const XGUARD_MCP_VERSION = "0.4.0";

const LEGACY_MCP_PROTOCOLS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
]);
const SUPPORTED_PROTOCOLS = [
  MODERN_MCP_PROTOCOL,
  ...LEGACY_MCP_PROTOCOLS,
];
const CACHE_TTL_MS = 300_000;
const MAX_MCP_BODY_BYTES = 128 * 1024;
const SERVER_INFO = { name: "xguard-mainnet", version: XGUARD_MCP_VERSION };

type ModernMcpEnv = { DB: D1Database };
type StatusProvider = () => Promise<unknown>;

export async function modernMcpRequest(
  request: Request,
  env: ModernMcpEnv,
  statusProvider?: StatusProvider,
): Promise<Response> {
  const originError = validateOrigin(request);
  if (originError !== null) return originError;

  if (request.method !== "POST")
    return mcpHttpError(null, -32600, "POST required", 405, {
      Allow: "POST, OPTIONS",
    });

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  )
    return mcpHttpError(
      null,
      -32600,
      "Accept must include application/json and text/event-stream",
      406,
    );

  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    return mcpHttpError(
      null,
      -32600,
      "Content-Type must be application/json",
      415,
    );

  let rpc: Record<string, unknown>;
  try {
    const text = await readBodyCapped(request, MAX_MCP_BODY_BYTES);
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid_json_rpc");
    rpc = parsed;
  } catch (error) {
    return mcpHttpError(null, -32700, errorMessage(error), 400);
  }

  if (rpc.jsonrpc !== "2.0")
    return mcpHttpError(rpc.id ?? null, -32600, "Invalid Request", 400);
  if (typeof rpc.method !== "string")
    return mcpHttpError(rpc.id ?? null, -32600, "method is required", 400);

  const id = rpc.id ?? null;
  const method = rpc.method;
  const params = isRecord(rpc.params) ? rpc.params : {};
  const isNotification = rpc.id === undefined;
  const requestedVersion = request.headers.get("mcp-protocol-version");

  if (requestedVersion !== MODERN_MCP_PROTOCOL)
    return mcpUnsupportedProtocol(id, requestedVersion);

  const validation = validateModernEnvelope(request, method, params);
  if (validation !== null) return mcpHeaderMismatch(id, validation);

  if (isNotification) return corsResponse(new Response(null, { status: 202 }));

  if (method === "server/discover") {
    return mcpResult(id, {
      resultType: "complete",
      supportedVersions: SUPPORTED_PROTOCOLS,
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Use xguard_discover to find x402-paid HTTP APIs and MCP tools cataloged by XGuard; use xguard_resource_details for an exact resource and xguard_status for live gateway state.",
      ttlMs: CACHE_TTL_MS,
      cacheScope: "public",
      _meta: serverMeta(),
    });
  }

  if (method === "ping")
    return mcpResult(id, { resultType: "complete", _meta: serverMeta() });

  if (method === "tools/list") {
    return mcpResult(id, {
      resultType: "complete",
      tools: mcpTools(),
      ttlMs: CACHE_TTL_MS,
      cacheScope: "public",
      _meta: serverMeta(),
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
        const status =
          statusProvider === undefined
            ? {
                status: "operational",
                mode: "mainnet",
                protocol: "x402-v2",
                network: "eip155:8453",
                discovery: await bazaarStats(env.DB),
              }
            : await statusProvider();
        return mcpToolResult(id, status);
      }

      return mcpHttpError(id, -32602, "unknown tool", 400);
    } catch (error) {
      return mcpToolError(id, errorMessage(error));
    }
  }

  return mcpHttpError(id, -32601, "Method not found", 404);
}

export function modernMcpOptions(request: Request): Response {
  const originError = validateOrigin(request);
  if (originError !== null) return originError;
  return corsResponse(new Response(null, { status: 204 }));
}

export function shouldUseModernMcp(request: Request): boolean {
  const version = request.headers.get("mcp-protocol-version");
  return version !== null && !LEGACY_MCP_PROTOCOLS.has(version);
}

function validateModernEnvelope(
  request: Request,
  method: string,
  params: Record<string, unknown>,
): string | null {
  const headerVersion = request.headers.get("mcp-protocol-version");
  if (headerVersion === null) return "MCP-Protocol-Version header is required";

  const meta = isRecord(params._meta) ? params._meta : null;
  if (meta === null) return "params._meta is required";
  if (meta["io.modelcontextprotocol/protocolVersion"] !== headerVersion)
    return "MCP-Protocol-Version header does not match params._meta protocolVersion";
  if (!isRecord(meta["io.modelcontextprotocol/clientCapabilities"]))
    return "params._meta clientCapabilities is required";
  const clientInfo = meta["io.modelcontextprotocol/clientInfo"];
  if (
    clientInfo !== undefined &&
    (!isRecord(clientInfo) ||
      typeof clientInfo.name !== "string" ||
      typeof clientInfo.version !== "string")
  )
    return "params._meta clientInfo is malformed";

  const methodHeader = request.headers.get("mcp-method");
  if (methodHeader === null) return "Mcp-Method header is required";
  if (methodHeader !== method) return "Mcp-Method header does not match method";

  if (method === "tools/call") {
    if (typeof params.name !== "string" || params.name === "")
      return "tools/call params.name is required";
    const rawName = request.headers.get("mcp-name");
    if (rawName === null) return "Mcp-Name header is required for tools/call";
    const decoded = decodeHeaderValue(rawName);
    if (decoded === null || decoded !== params.name)
      return "Mcp-Name header does not match params.name";
  }

  return null;
}

function mcpTools() {
  return [
    {
      name: "xguard_discover",
      title: "Discover x402 resources",
      description:
        "Discover x402-paid HTTP APIs and MCP tools cataloged by XGuard. Use a natural-language query or list recent resources.",
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
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "xguard_resource_details",
      title: "Inspect x402 resource",
      description:
        "Return XGuard catalog records for one exact resource URL or resource key.",
      inputSchema: {
        type: "object",
        properties: { resource: { type: "string" } },
        required: ["resource"],
        additionalProperties: false,
      },
    },
    {
      name: "xguard_status",
      title: "XGuard status",
      description: "Return XGuard mainnet and discovery catalog status.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

function serverMeta(): Record<string, unknown> {
  return { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
}

function mcpResult(id: unknown, result: unknown): Response {
  return corsJson(
    { jsonrpc: "2.0", id, result },
    200,
    { "MCP-Protocol-Version": MODERN_MCP_PROTOCOL },
  );
}

function mcpToolResult(id: unknown, value: unknown): Response {
  return mcpResult(id, {
    resultType: "complete",
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
    _meta: serverMeta(),
  });
}

function mcpToolError(id: unknown, message: string): Response {
  return mcpResult(id, {
    resultType: "complete",
    content: [{ type: "text", text: message }],
    isError: true,
    _meta: serverMeta(),
  });
}

function mcpHeaderMismatch(id: unknown, message: string): Response {
  return mcpHttpError(id, -32020, `Header mismatch: ${message}`, 400);
}

function mcpUnsupportedProtocol(
  id: unknown,
  requestedVersion: string | null,
): Response {
  return corsJson(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32022,
        message: `Unsupported MCP protocol version: ${requestedVersion ?? "missing"}`,
        data: { supportedVersions: SUPPORTED_PROTOCOLS },
      },
    },
    400,
    { "MCP-Protocol-Version": MODERN_MCP_PROTOCOL },
  );
}

function mcpHttpError(
  id: unknown,
  code: number,
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return corsJson(
    { jsonrpc: "2.0", id, error: { code, message } },
    status,
    {
      "MCP-Protocol-Version": MODERN_MCP_PROTOCOL,
      ...(headers ?? {}),
    },
  );
}

function decodeHeaderValue(value: string): string | null {
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  try {
    const encoded = value.slice("=?base64?".length, -2);
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function validateOrigin(request: Request): Response | null {
  const rawOrigin = request.headers.get("origin");
  if (rawOrigin === null) return null;
  try {
    const origin = new URL(rawOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username !== "" ||
      origin.password !== "" ||
      isLocalHost(origin.hostname)
    )
      throw new Error("invalid_origin");
    return null;
  } catch {
    return corsJson({ error: "invalid_origin" }, 403);
  }
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
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
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, MCP-Session-Id",
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Expose-Headers", "MCP-Protocol-Version");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes)
    throw new Error("request_body_too_large");
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
