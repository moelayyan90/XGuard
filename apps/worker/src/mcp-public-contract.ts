import { mcpProtectedResourceChallenge } from "./mcp-oauth.js";

const MAX_RPC_BODY_BYTES = 128 * 1024;

type JsonRecord = Record<string, unknown>;

export async function normalizeMcpPublicResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" || request.method !== "POST") return response;

  const rpc = await parseRpc(request).catch(() => null);
  if (rpc === null) return response;

  let normalized = response;
  if (rpc.method === "tools/list") normalized = await compactToolList(response);

  if (
    rpc.method === "tools/call" &&
    rpc.toolName === "xguard_payment_decision" &&
    !hasBearer(request)
  ) {
    const headers = new Headers(normalized.headers);
    headers.set("WWW-Authenticate", mcpProtectedResourceChallenge(url.origin));
    exposeHeader(headers, "WWW-Authenticate");
    normalized = new Response(normalized.body, {
      status: normalized.status,
      statusText: normalized.statusText,
      headers,
    });
  }

  return normalized;
}

async function compactToolList(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return response;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (
    !isRecord(body) ||
    !isRecord(body.result) ||
    !Array.isArray(body.result.tools)
  )
    return response;

  body.result.tools = body.result.tools.map((value) => {
    if (!isRecord(value) || typeof value.name !== "string") return value;
    const replacement = toolContract(value.name);
    return replacement === null ? value : { ...value, ...replacement };
  });

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toolContract(name: string): JsonRecord | null {
  if (name === "xguard_payment_offer") {
    return {
      description:
        "Show XGuard's free pre-payment verification offer. Returns fee terms and user choices; it never pays or charges by itself. Example: call before checkout.",
      inputSchema: emptyInput(),
    };
  }

  if (name === "xguard_payment_decision") {
    return {
      description:
        "Evaluate a declared payment and return ALLOW, REVIEW, or BLOCK with evidence. Requires XGuard bearer access. Example: amount='49.99', currency='USD', payee='acme'.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            minLength: 8,
            maxLength: 96,
            description: "Unique idempotency key for this decision.",
          },
          rail: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Payment rail, e.g. card, paypal, or x402.",
          },
          provider: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Payment provider or generic_http.",
          },
          amount: {
            type: "string",
            description: "Positive decimal amount as a string.",
          },
          currency: {
            type: "string",
            minLength: 2,
            maxLength: 12,
            description: "Currency or asset code, e.g. USD.",
          },
          payee: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description: "Observed payment recipient.",
          },
          merchantOrigin: {
            type: "string",
            maxLength: 512,
            description: "HTTPS origin initiating the payment.",
          },
          network: {
            type: "string",
            maxLength: 96,
            description: "Target network for crypto rails.",
          },
          expectedAmount: {
            type: "string",
            maxLength: 64,
            description: "Expected amount for integrity checking.",
          },
          expectedPayee: {
            type: "string",
            maxLength: 256,
            description: "Expected recipient for integrity checking.",
          },
          paymentReference: {
            type: "string",
            maxLength: 160,
            description: "Provider reference used for duplicate checks.",
          },
        },
        required: [
          "requestId",
          "rail",
          "provider",
          "amount",
          "currency",
          "payee",
        ],
        additionalProperties: false,
      },
    };
  }

  if (name === "xguard_discover") {
    return {
      description:
        "Search XGuard's x402 catalog or list recent resources. Example: query='weather API', type='http'.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search phrase; omit to list recent resources.",
          },
          type: {
            type: "string",
            enum: ["http", "mcp"],
            description: "Optional resource kind.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
            description: "Maximum results to return.",
          },
        },
        additionalProperties: false,
      },
    };
  }

  if (name === "xguard_resource_details") {
    return {
      description:
        "Return catalog records for one exact resource URL or key. Example: resource='https://api.example.com/pay'.",
      inputSchema: {
        type: "object",
        properties: {
          resource: {
            type: "string",
            description: "Exact resource URL or XGuard resource key.",
          },
        },
        required: ["resource"],
        additionalProperties: false,
      },
    };
  }

  if (name === "xguard_status") {
    return {
      description:
        "Return XGuard mainnet health and discovery statistics. Example: call with no arguments before routing a paid request.",
      inputSchema: emptyInput(),
    };
  }

  return null;
}

async function parseRpc(
  request: Request,
): Promise<{ method: string; toolName: string | null }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RPC_BODY_BYTES)
    throw new Error("rpc_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RPC_BODY_BYTES)
    throw new Error("rpc_too_large");
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || typeof parsed.method !== "string")
    throw new Error("invalid_rpc");
  const params = isRecord(parsed.params) ? parsed.params : {};
  return {
    method: parsed.method,
    toolName:
      parsed.method === "tools/call" && typeof params.name === "string"
        ? params.name
        : null,
  };
}

function hasBearer(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  return authorization !== null && /^Bearer\s+\S+$/i.test(authorization);
}

function emptyInput(): JsonRecord {
  return { type: "object", properties: {}, additionalProperties: false };
}

function exposeHeader(headers: Headers, name: string): void {
  const existing = headers.get("Access-Control-Expose-Headers") ?? "";
  const values = existing
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === name.toLowerCase()))
    values.push(name);
  headers.set("Access-Control-Expose-Headers", values.join(", "));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
