const A2A_PATH = "/a2a";
const CACHE_CONTROL = "no-store";

export async function a2aAgentResponse(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== A2A_PATH) return null;

  if (request.method === "GET" || request.method === "HEAD") {
    return a2aProbeResponse(request, url.origin);
  }

  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, HEAD, POST",
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (!isRecord(body) || body.jsonrpc !== "2.0") {
    return jsonRpcError(readId(body), -32600, "Invalid Request");
  }

  const id = readId(body);
  const method = typeof body.method === "string" ? body.method : "";
  if (method !== "message/send") {
    return jsonRpcError(id, -32601, "Method not found");
  }

  const text = extractUserText(body.params);
  const responseText = answer(text, url.origin);
  const contextId = extractContextId(body.params) ?? crypto.randomUUID();

  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      kind: "message",
      messageId: crypto.randomUUID(),
      contextId,
      role: "agent",
      parts: [{ kind: "text", text: responseText }],
    },
  });
}

function a2aProbeResponse(request: Request, origin: string): Response {
  const body = JSON.stringify({
    name: "XGuard A2A",
    status: "ok",
    protocol: "A2A",
    protocolVersion: "0.3.0",
    transport: "JSONRPC",
    endpoint: `${origin}/a2a`,
    agentCard: `${origin}/.well-known/agent-card.json`,
    methods: ["message/send"],
  });

  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function answer(input: string, origin: string): string {
  const normalized = input.toLowerCase();

  if (normalized.includes("supported") || normalized.includes("capabil")) {
    return [
      "XGuard is a prepaid universal execution gateway for AI models, tools, source discovery, security inspection, analysis, and x402 payment flows.",
      `Capabilities: ${origin}/v1/gateway/capabilities`,
      `x402 support: ${origin}/supported`,
      `Provider manifest: ${origin}/.well-known/x402/facilitator.json`,
      `MCP: ${origin}/mcp`,
    ].join("\n");
  }

  if (normalized.includes("price") || normalized.includes("fee")) {
    return "XGuard meters successful execution from a prepaid service balance. Current production fees: model $0.0001, tool or x402 verify $0.0002, source or security $0.001, analysis $0.002, and finalized x402 settlement $0.002. Readiness and protocol metadata remain free.";
  }

  if (normalized.includes("register") || normalized.includes("onboard")) {
    return `Merchant onboarding starts at POST ${origin}/v1/register. Billable execution requires the issued Bearer API key and funded prepaid service balance.`;
  }

  return [
    "XGuard A2A endpoint is online.",
    "I can describe XGuard's universal gateway capabilities, pricing, onboarding, MCP interface, and guarded x402 settlement path.",
    `Documentation: ${origin}/llms-full.txt`,
  ].join("\n");
}

function extractUserText(params: unknown): string {
  if (!isRecord(params) || !isRecord(params.message)) return "";
  const parts = Array.isArray(params.message.parts) ? params.message.parts : [];
  return parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractContextId(params: unknown): string | null {
  if (!isRecord(params) || !isRecord(params.message)) return null;
  return typeof params.message.contextId === "string"
    ? params.message.contextId
    : null;
}

function readId(value: unknown): string | number | null {
  if (!isRecord(value)) return null;
  return typeof value.id === "string" || typeof value.id === "number"
    ? value.id
    : null;
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
