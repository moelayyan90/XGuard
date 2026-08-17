import {
  buildPaymentManifest,
  XGUARD_ATTEMPT_FEE_USD,
} from "./public-payment-contract.js";

const CARD_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
]);
type Delegate = (request: Request) => Promise<Response>;
type A2AEnv = { XGUARD_TREASURY_USDC_ADDRESS?: string };

export async function a2aGatewayV1Response(
  request: Request,
  env: A2AEnv,
  delegate: Delegate,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    CARD_PATHS.has(url.pathname) &&
    (request.method === "GET" || request.method === "HEAD")
  )
    return publicJson(request, agentCard(url.origin));
  if (url.pathname !== "/a2a") return null;
  if (request.method === "GET" || request.method === "HEAD")
    return publicJson(request, {
      name: "XGuard A2A",
      status: "ok",
      supportedVersions: ["1.0", "0.3"],
      endpoint: `${url.origin}/a2a`,
      agentCard: `${url.origin}/.well-known/agent-card.json`,
    });
  if (request.method !== "POST")
    return rpcError(null, -32600, "POST required", 405);

  let rpc: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!isRecord(value)) throw new Error("invalid_json_rpc");
    rpc = value;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (rpc.jsonrpc !== "2.0")
    return rpcError(readId(rpc), -32600, "Invalid Request", 400);

  const method = typeof rpc.method === "string" ? rpc.method : "";
  if (method !== "SendMessage" && method !== "message/send")
    return rpcError(readId(rpc), -32601, "Method not found", 404);

  const params = isRecord(rpc.params) ? rpc.params : {};
  const message = isRecord(params.message) ? params.message : {};
  const parts = Array.isArray(message.parts) ? message.parts.filter(isRecord) : [];
  const contextId =
    typeof message.contextId === "string"
      ? message.contextId
      : crypto.randomUUID();
  const action = parts
    .map((part) => part.data)
    .find((value) => isRecord(value) && typeof value.action === "string");

  if (isRecord(action)) {
    const result = await executeAction(
      action,
      request,
      env,
      delegate,
      url.origin,
    );
    return rpcResult(readId(rpc), contextId, [
      { data: result, mediaType: "application/json" },
    ]);
  }

  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .toLowerCase();
  return rpcResult(readId(rpc), contextId, [
    { text: answerText(text, url.origin), mediaType: "text/plain" },
  ]);
}

function agentCard(origin: string): Record<string, unknown> {
  return {
    name: "XGuard",
    description:
      "Economic safety, payment discovery, verification, settlement and universal execution gateway for autonomous agents.",
    version: "1.0.0",
    provider: {
      organization: "XGuard",
      url: "https://github.com/moelayyan90/XGuard",
    },
    supportedInterfaces: [
      {
        url: `${origin}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
      {
        url: `${origin}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "payments",
        name: "Discover and fund XGuard",
        description: "Payment manifest, registration, balance and top-up.",
      },
      {
        id: "x402",
        name: "Verify and settle x402",
        description:
          "Authenticated x402 verify and settle through structured A2A actions.",
      },
      {
        id: "operations",
        name: "Inspect XGuard",
        description: "Status, capabilities, quotes and security inspection.",
      },
    ],
  };
}

async function executeAction(
  action: Record<string, unknown>,
  incoming: Request,
  env: A2AEnv,
  delegate: Delegate,
  origin: string,
): Promise<Record<string, unknown>> {
  const name = typeof action.action === "string" ? action.action : "";
  if (name === "payment-manifest")
    return { ok: true, action: name, result: buildPaymentManifest(origin, env) };
  if (name === "status")
    return delegated(delegate, makeRequest(incoming, "/status", "GET"), name);
  if (name === "capabilities")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/gateway/capabilities", "GET"),
      name,
    );
  if (name === "balance")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/balance", "GET"),
      name,
    );
  if (name === "register")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/register", "POST", { name: action.name }),
      name,
    );
  if (name === "topup-intent")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/topups/intents", "POST", {
        amountUsd: action.amountUsd,
      }),
      name,
    );
  if (name === "topup-claim")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/topups/claim", "POST", {
        claimToken: action.claimToken,
        transactionHash: action.transactionHash,
      }),
      name,
    );
  if ((name === "verify" || name === "settle") && isRecord(action.payload))
    return delegated(
      delegate,
      makeRequest(
        incoming,
        name === "verify" ? "/verify" : "/settle",
        "POST",
        action.payload,
      ),
      name,
    );
  if (name === "quote")
    return delegated(
      delegate,
      makeRequest(incoming, "/v1/gateway/quote", "POST", {
        kind: action.kind,
      }),
      name,
    );
  if (name === "security-inspect" && isRecord(action.payload))
    return delegated(
      delegate,
      makeRequest(
        incoming,
        "/v1/gateway/security/inspect",
        "POST",
        action.payload,
      ),
      name,
    );
  return {
    ok: false,
    error: "unsupported_a2a_action",
    supportedActions: [
      "payment-manifest",
      "status",
      "capabilities",
      "register",
      "balance",
      "topup-intent",
      "topup-claim",
      "verify",
      "settle",
      "quote",
      "security-inspect",
    ],
  };
}

function makeRequest(
  incoming: Request,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Request {
  const url = new URL(incoming.url);
  url.pathname = path;
  url.search = "";
  const headers = new Headers({ accept: "application/json" });
  const authorization = incoming.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  if (method === "POST") headers.set("content-type", "application/json");
  return new Request(url.toString(), {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : null,
  });
}

async function delegated(
  delegate: Delegate,
  request: Request,
  action: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await delegate(request);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    const result = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { ok: response.ok, action, httpStatus: response.status, result };
  } catch {
    return { ok: false, action, error: "xguard_action_unavailable" };
  }
}

function answerText(text: string, origin: string): string {
  if (text.includes("price") || text.includes("fee"))
    return `XGuard x402 attempt fee is $${XGUARD_ATTEMPT_FEE_USD}. Machine payment discovery: ${origin}/.well-known/payment-manifest.`;
  if (text.includes("pay") || text.includes("onboard"))
    return `Robot: ${origin}/.well-known/payment-manifest. Human: ${origin}/pay.`;
  return `XGuard A2A is online. Use a structured data part with an action. Start at ${origin}/.well-known/agent-card.json.`;
}

function rpcResult(
  id: string | number | null,
  contextId: string,
  parts: Record<string, unknown>[],
): Response {
  return json({
    jsonrpc: "2.0",
    id,
    result: {
      messageId: crypto.randomUUID(),
      contextId,
      role: "agent",
      parts,
    },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  status: number,
): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicJson(request: Request, value: unknown): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function readId(value: Record<string, unknown>): string | number | null {
  return typeof value.id === "string" || typeof value.id === "number"
    ? value.id
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
