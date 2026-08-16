// Public A2A is intentionally discovery-only; payment execution remains on authenticated x402 endpoints.
export const A2A_PATH = "/a2a";
export const A2A_CURRENT_PROTOCOL = "1.0";
export const A2A_LEGACY_PROTOCOL = "0.3";

const DISCOVERY_MESSAGE =
  "XGuard provides x402 v2 payment verification and settlement safety on Base mainnet. Use /supported, /status, /mcp, /discovery/resources, and /discovery/search for public discovery. Protected /verify and /settle calls require merchant authentication and remain separate from A2A. The A2A endpoint is discovery-only and never verifies, settles, signs, or moves funds.";

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export function a2aOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: a2aHeaders(),
  });
}

export async function a2aRequest(request: Request): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = validId(body.id) ? body.id : null;
  if (
    body.jsonrpc !== "2.0" ||
    !Object.prototype.hasOwnProperty.call(body, "id") ||
    !validId(body.id) ||
    typeof body.method !== "string" ||
    !isRecord(body.params)
  ) {
    return rpcError(id, -32600, "Invalid Request");
  }

  const params = body.params;
  if (body.method === "message/send") {
    const message = isRecord(params.message) ? params.message : null;
    if (message === null) return rpcError(id, -32602, "Invalid params");
    return rpcResult(id, legacyMessage(message));
  }

  if (body.method === "SendMessage") {
    const message = isRecord(params.message)
      ? params.message
      : isRecord(params.msg)
        ? params.msg
        : null;
    if (message === null) return rpcError(id, -32602, "Invalid params");
    return rpcResult(id, { message: currentMessage(message) });
  }

  return rpcError(id, -32601, "Method not found");
}

function legacyMessage(input: Record<string, unknown>) {
  return {
    kind: "message",
    role: "agent",
    messageId: crypto.randomUUID(),
    contextId: contextId(input),
    parts: [{ kind: "text", text: DISCOVERY_MESSAGE }],
    metadata: {
      discoveryOnly: true,
      paymentExecution: false,
    },
  };
}

function currentMessage(input: Record<string, unknown>) {
  return {
    role: "ROLE_AGENT",
    messageId: crypto.randomUUID(),
    contextId: contextId(input),
    parts: [{ text: DISCOVERY_MESSAGE }],
    metadata: {
      discoveryOnly: true,
      paymentExecution: false,
    },
  };
}

function contextId(input: Record<string, unknown>): string {
  return typeof input.contextId === "string" && input.contextId.length > 0
    ? input.contextId
    : crypto.randomUUID();
}

function rpcResult(id: unknown, result: unknown): Response {
  return publicJson({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return publicJson({ jsonrpc: "2.0", id, error: { code, message } });
}

function publicJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: a2aHeaders(),
  });
}

function a2aHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, A2A-Version, A2A-Extensions, Authorization",
    "X-Content-Type-Options": "nosniff",
  };
}

function validId(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
