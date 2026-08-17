import {
  bazaarStats,
  findBazaarResource,
  listBazaarResources,
  searchBazaarResources,
} from "./mainnet-bazaar.js";

export const MODERN_MCP_PROTOCOL = "2026-07-28";
export const XGUARD_MCP_VERSION = "0.5.1";

const LEGACY_MCP_PROTOCOLS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
]);
const SUPPORTED_PROTOCOLS = [MODERN_MCP_PROTOCOL, ...LEGACY_MCP_PROTOCOLS];
const CACHE_TTL_MS = 300_000;
const MAX_MCP_BODY_BYTES = 128 * 1024;
const HSTS_VALUE = "max-age=31536000; includeSubDomains";
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
      tools: xguardMcpTools(),
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
        return mcpResult(id, {
          resultType: "complete",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await discoverTool(env, args),
                null,
                2,
              ),
            },
          ],
          isError: false,
          _meta: serverMeta(),
        });
      }
      if (name === "xguard_resource_details") {
        return mcpResult(id, {
          resultType: "complete",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await resourceDetailsTool(env, args),
                null,
                2,
              ),
            },
          ],
          isError: false,
          _meta: serverMeta(),
        });
      }
      if (name === "xguard_status") {
        const status = statusProvider ? await statusProvider() : { ok: true };
        return mcpResult(id, {
          resultType: "complete",
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          isError: false,
          _meta: serverMeta(),
        });
      }
    } catch (error) {
      return mcpResult(id, {
        resultType: "complete",
        content: [{ type: "text", text: errorMessage(error) }],
        isError: true,
        _meta: serverMeta(),
      });
    }
    return mcpHttpError(id, -32601, `Unknown tool: ${name}`, 404);
  }

  if (method === "resources/list") {
    return mcpResult(id, {
      resultType: "complete",
      resources: [],
      _meta: serverMeta(),
    });
  }

  if (method === "prompts/list") {
    return mcpResult(id, {
      resultType: "complete",
      prompts: [],
      _meta: serverMeta(),
    });
  }

  return mcpHttpError(id, -32601, "Method not found", 404);
}

export function modernMcpOptionsResponse(): Response {
  return corsResponse(new Response(null, { status: 204 }));
}

export function modernMcpManifestResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/.well-known/mcp/server.json") return null;
  const body = modernMcpManifest(url.origin);
  return corsResponse(
    new Response(request.method === "HEAD" ? null : JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
}

export function modernMcpManifest(origin: string) {
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "io.github.moelayyan90/xguard",
    title: "XGuard",
    description:
      "Remote MCP server for discovering x402-paid HTTP APIs and MCP tools cataloged by XGuard.",
    repository: {
      url: "https://github.com/moelayyan90/XGuard",
      source: "github",
    },
    version: XGUARD_MCP_VERSION,
    remotes: [{ type: "streamable-http", url: `${origin}/mcp` }],
  };
}

function xguardMcpTools() {
  return [
    {
      name: "xguard_discover",
      title: "Discover x402 resources",
      description:
        "Search XGuard's public x402 Bazaar catalog for paid HTTP APIs and MCP tools. Example: query='weather' finds resources related to weather data.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description:
              "Optional free-text search matched against resource URI, type, protocol, network, and metadata.",
          },
          resourceType: {
            type: "string",
            enum: ["http", "mcp"],
            description: "Optional resource-type filter: paid HTTP API or MCP tool.",
          },
          network: {
            type: "string",
            description:
              "Optional exact CAIP-2 network filter such as eip155:8453.",
          },
          provider: {
            type: "string",
            description:
              "Optional facilitator/provider filter such as cdp or payai.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum number of catalog entries to return, from 1 to 100.",
          },
        },
      },
      annotations: readOnlyAnnotations(),
    },
    {
      name: "xguard_resource_details",
      title: "Read x402 resource details",
      description:
        "Return one exact XGuard Bazaar resource, including payment requirements and metadata when known. Example: resource='https://api.example.com/weather' returns that catalog entry.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["resource"],
        properties: {
          resource: {
            type: "string",
            description: "Exact resource URI to look up in the XGuard catalog.",
          },
        },
      },
      annotations: readOnlyAnnotations(),
    },
    {
      name: "xguard_status",
      title: "Read XGuard gateway status",
      description:
        "Return the live XGuard gateway status without creating or settling a payment. Example: call before relying on XGuard discovery or settlement routes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      annotations: readOnlyAnnotations(),
    },
  ];
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

async function discoverTool(env: ModernMcpEnv, args: Record<string, unknown>) {
  const query = readOptionalString(args.query);
  const resourceType = readResourceType(args.resourceType);
  const network = readOptionalString(args.network);
  const provider = readOptionalString(args.provider);
  const limit = readLimit(args.limit);

  const result = query
    ? await searchBazaarResources(env.DB, {
        query,
        resourceType,
        network,
        provider,
        limit,
      })
    : await listBazaarResources(env.DB, {
        resourceType,
        network,
        provider,
        limit,
      });

  return {
    ...result,
    stats: await bazaarStats(env.DB),
  };
}

async function resourceDetailsTool(env: ModernMcpEnv, args: Record<string, unknown>) {
  const resource = readRequiredString(args.resource, "resource");
  const item = await findBazaarResource(env.DB, resource);
  if (!item) throw new Error("resource_not_found");
  return item;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 300) : undefined;
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value);
  if (!parsed) throw new Error(`${field}_required`);
  return parsed;
}

function readResourceType(value: unknown): "http" | "mcp" | undefined {
  if (value === "http" || value === "mcp") return value;
  return undefined;
}

function readLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function serverMeta() {
  return {
    serverInfo: SERVER_INFO,
    protocolVersion: MODERN_MCP_PROTOCOL,
    supportedVersions: SUPPORTED_PROTOCOLS,
  };
}

function validateModernEnvelope(
  request: Request,
  method: string,
  params: Record<string, unknown>,
): string | null {
  const methodHeader = request.headers.get("mcp-method");
  if (methodHeader !== method)
    return "MCP-Method header must exactly match the JSON-RPC method";

  const paramsHeader = request.headers.get("mcp-params");
  if (!paramsHeader) return "MCP-Params header is required";
  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(paramsHeader);
  } catch {
    return "MCP-Params header must be valid JSON";
  }
  if (!deepEqual(parsedHeader, params))
    return "MCP-Params header must exactly match JSON-RPC params";
  return null;
}

function mcpUnsupportedProtocol(id: unknown, requested: string | null): Response {
  return mcpHttpError(
    id,
    -32001,
    `Unsupported MCP-Protocol-Version: ${requested ?? "missing"}`,
    400,
    { "MCP-Protocol-Version": MODERN_MCP_PROTOCOL },
  );
}

function mcpHeaderMismatch(id: unknown, message: string): Response {
  return mcpHttpError(id, -32600, message, 400);
}

function mcpResult(id: unknown, result: Record<string, unknown>): Response {
  return mcpJson({ jsonrpc: "2.0", id, result }, 200);
}

function mcpHttpError(
  id: unknown,
  code: number,
  message: string,
  status: number,
  headers: HeadersInit = {},
): Response {
  return mcpJson(
    {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    },
    status,
    headers,
  );
}

function mcpJson(body: unknown, status: number, headers: HeadersInit = {}): Response {
  const out = new Headers(headers);
  out.set("Cache-Control", "no-store");
  out.set("Content-Type", "application/json; charset=utf-8");
  out.set("MCP-Protocol-Version", MODERN_MCP_PROTOCOL);
  out.set("Strict-Transport-Security", HSTS_VALUE);
  out.set("X-Content-Type-Options", "nosniff");
  return corsResponse(new Response(JSON.stringify(body), { status, headers: out }));
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, MCP-Method, MCP-Params, MCP-Protocol-Version, Origin, X-Requested-With",
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Expose-Headers",
    "MCP-Protocol-Version, Strict-Transport-Security",
  );
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  headers.set("Vary", "Origin, Accept, MCP-Protocol-Version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validateOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "https:" || parsed.hostname === "localhost") return null;
  } catch {
    // Rejected below.
  }
  return mcpHttpError(null, -32600, "Untrusted Origin", 403);
}

async function readBodyCapped(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("request_too_large");
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (isRecord(a)) {
    if (!isRecord(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, index) => key === bKeys[index] && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
