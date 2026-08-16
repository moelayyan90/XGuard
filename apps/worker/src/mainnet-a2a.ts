const MAX_A2A_BODY_BYTES = 64 * 1024;

type ResolveA2AData = (kind: "status" | "supported") => Promise<unknown>;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export function a2aOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: a2aHeaders({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, A2A-Version, A2A-Extensions, Authorization",
      "Access-Control-Max-Age": "86400",
    }),
  });
}

export async function a2aRequest(
  request: Request,
  resolve: ResolveA2AData,
): Promise<Response> {
  if (request.method !== "POST")
    return jsonRpcError(null, -32600, "A2A JSON-RPC endpoint requires POST", 405);

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/a2a+json")
    return jsonRpcError(null, -32600, "Content-Type must be application/json", 415);

  const length = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(length) && length > MAX_A2A_BODY_BYTES)
    return jsonRpcError(null, -32600, "A2A request body is too large", 413);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_A2A_BODY_BYTES)
    return jsonRpcError(null, -32600, "A2A request body is too large", 413);

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }
  if (!isRecord(value) || value.jsonrpc !== "2.0" || !validId(value.id))
    return jsonRpcError(null, -32600, "Invalid JSON-RPC 2.0 request", 400);

  const rpc = value as unknown as JsonRpcRequest;
  if (rpc.method !== "SendMessage" && rpc.method !== "message/send")
    return jsonRpcError(rpc.id, -32601, "Method not found", 200);

  const input = parseInputMessage(rpc.params);
  if (input === null)
    return jsonRpcError(rpc.id, -32602, "Invalid SendMessage params", 200);

  const text = await responseText(input.text, resolve);
  const contextId = input.contextId ?? crypto.randomUUID();
  const messageId = crypto.randomUUID();

  if (rpc.method === "message/send") {
    return a2aJson({
      jsonrpc: "2.0",
      id: rpc.id,
      result: {
        kind: "message",
        messageId,
        contextId,
        role: "agent",
        parts: [{ kind: "text", text }],
      },
    });
  }

  return a2aJson({
    jsonrpc: "2.0",
    id: rpc.id,
    result: {
      message: {
        messageId,
        contextId,
        role: "ROLE_AGENT",
        parts: [{ text, mediaType: "text/plain" }],
      },
    },
  });
}

function parseInputMessage(
  params: unknown,
): { text: string; contextId: string | null } | null {
  if (!isRecord(params) || !isRecord(params.message)) return null;
  const message = params.message;
  if (!Array.isArray(message.parts) || message.parts.length === 0) return null;
  const text = message.parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .slice(0, 16_384);
  if (text.length === 0) return null;
  const contextId =
    typeof message.contextId === "string" && message.contextId.length > 0
      ? message.contextId
      : null;
  return { text, contextId };
}

async function responseText(text: string, resolve: ResolveA2AData): Promise<string> {
  const lower = text.toLowerCase();
  const origin = "https://xguard-mainnet.maqamapp.workers.dev";

  if (/status|health|ready|operational|uptime/.test(lower)) {
    const status = await resolve("status").catch(() => null);
    return status === null
      ? "XGuard status is temporarily unavailable."
      : `XGuard live status: ${JSON.stringify(status)}`;
  }

  if (/capabilit|supported|network|scheme|verify|settle/.test(lower)) {
    const supported = await resolve("supported").catch(() => null);
    return supported === null
      ? "XGuard capability metadata is temporarily unavailable."
      : `XGuard x402 capabilities: ${JSON.stringify(supported)}`;
  }

  if (/discover|bazaar|resource|mcp|tool|agent/.test(lower)) {
    return [
      "XGuard exposes machine-readable x402 discovery for agents.",
      `Bazaar resources: ${origin}/discovery/resources`,
      `Bazaar search: ${origin}/discovery/search?query=<terms>`,
      `MCP endpoint: ${origin}/mcp`,
      `Provider manifest: ${origin}/.well-known/x402/facilitator.json`,
    ].join("\n");
  }

  if (/price|pricing|fee|cost/.test(lower)) {
    return "XGuard charges USD 0.002 per successful billable settlement using a merchant-prepaid service balance. Discovery, health checks, failed operations, and duplicate retries are not billed.";
  }

  return [
    "XGuard is a production x402 v2 facilitator-compatible safety and routing gateway for Base mainnet USDC.",
    "Ask me about supported x402 capabilities, live status, pricing, or discovery endpoints.",
    `Documentation: ${origin}/llms-full.txt`,
  ].join("\n");
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status: number,
): Response {
  return a2aJson(
    { jsonrpc: "2.0", id, error: { code, message } },
    status,
  );
}

function a2aJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: a2aHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function a2aHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}

function validId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
