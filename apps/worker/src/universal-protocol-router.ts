const DISCOVERY_PATH = "/.well-known/xguard/protocols.json";
const PROTOCOLS_PATH = "/v1/protocols";
const VERIFY_PATHS = new Set(["/v1/verify", "/v1/transactions/verify"]);
const SETTLE_PATHS = new Set(["/v1/settle", "/v1/transactions/settle"]);
const MAX_BODY_BYTES = 128 * 1024;

export type XGuardProtocolId =
  | "x402"
  | "ap2"
  | "acp"
  | "visa-trusted-agent"
  | "mcp"
  | "a2a"
  | "http"
  | "openapi"
  | "graphql"
  | "json-rpc"
  | "webhook";

export interface ProtocolAdapterManifest {
  id: XGuardProtocolId;
  label: string;
  family: "payment" | "commerce" | "trust" | "agent" | "transport";
  role: string;
  verification: "native" | "structural" | "transport";
  settlement: "native" | "bridge" | "not-a-settlement-rail";
  actions: string[];
  requiresExternalTrustMaterial?: boolean;
  specification: string;
}

export interface UniversalProtocolDelegates {
  verifyX402(request: Request): Promise<Response>;
  settleX402(request: Request): Promise<Response>;
}

const ADAPTERS: readonly ProtocolAdapterManifest[] = [
  {
    id: "x402",
    label: "x402",
    family: "payment",
    role: "HTTP-native payment verification and settlement rail",
    verification: "native",
    settlement: "native",
    actions: ["verify", "settle"],
    specification: "https://x402.org",
  },
  {
    id: "ap2",
    label: "Agent Payments Protocol (AP2)",
    family: "payment",
    role: "Agent-payment authorization and mandate envelope",
    verification: "structural",
    settlement: "bridge",
    actions: ["verify-envelope", "bridge-settlement"],
    specification: "https://github.com/google-agentic-commerce/AP2",
  },
  {
    id: "acp",
    label: "Agentic Commerce Protocol (ACP)",
    family: "commerce",
    role: "Agent-to-business checkout, commerce, and payment-token interaction",
    verification: "structural",
    settlement: "bridge",
    actions: ["verify-envelope", "bridge-settlement"],
    specification:
      "https://github.com/agentic-commerce-protocol/agentic-commerce-protocol",
  },
  {
    id: "visa-trusted-agent",
    label: "Visa Trusted Agent Protocol",
    family: "trust",
    role: "Cryptographic AI-agent identity and transaction-intent trust layer",
    verification: "structural",
    settlement: "not-a-settlement-rail",
    actions: ["recognize-signature-metadata", "bridge-settlement"],
    requiresExternalTrustMaterial: true,
    specification: "https://github.com/visa/trusted-agent-protocol",
  },
  {
    id: "mcp",
    label: "Model Context Protocol (MCP)",
    family: "agent",
    role: "Tool and resource transport carrying economic actions",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://modelcontextprotocol.io",
  },
  {
    id: "a2a",
    label: "Agent2Agent (A2A)",
    family: "agent",
    role: "Agent-to-agent task transport carrying economic actions",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://a2a-protocol.org",
  },
  {
    id: "http",
    label: "HTTP",
    family: "transport",
    role: "Generic HTTPS API transport",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://www.rfc-editor.org/rfc/rfc9110",
  },
  {
    id: "openapi",
    label: "OpenAPI",
    family: "transport",
    role: "OpenAPI-described HTTP operation transport",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://spec.openapis.org/oas/latest.html",
  },
  {
    id: "graphql",
    label: "GraphQL",
    family: "transport",
    role: "GraphQL operation transport",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://spec.graphql.org",
  },
  {
    id: "json-rpc",
    label: "JSON-RPC",
    family: "transport",
    role: "JSON-RPC operation transport",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://www.jsonrpc.org/specification",
  },
  {
    id: "webhook",
    label: "Webhook",
    family: "transport",
    role: "Event-driven HTTP callback transport",
    verification: "transport",
    settlement: "bridge",
    actions: ["observe", "route", "bridge-settlement"],
    specification: "https://www.rfc-editor.org/rfc/rfc9110",
  },
] as const;

const ADAPTER_BY_ID = new Map<XGuardProtocolId, ProtocolAdapterManifest>(
  ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export function protocolAdapterManifests(): readonly ProtocolAdapterManifest[] {
  return ADAPTERS;
}

export async function universalProtocolResponse(
  request: Request,
  delegates: UniversalProtocolDelegates,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    (url.pathname === DISCOVERY_PATH || url.pathname === PROTOCOLS_PATH) &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const body = JSON.stringify(discoveryDocument(url.origin));
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: publicJsonHeaders(url.origin),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname.startsWith(`${PROTOCOLS_PATH}/`)
  ) {
    const id = normalizeProtocolId(
      url.pathname.slice(PROTOCOLS_PATH.length + 1),
    );
    if (id === null)
      return jsonResponse({ error: "unsupported_xguard_protocol" }, 404);
    return jsonResponse(ADAPTER_BY_ID.get(id));
  }

  if (
    request.method !== "POST" ||
    (!VERIFY_PATHS.has(url.pathname) && !SETTLE_PATHS.has(url.pathname))
  )
    return null;

  let envelope: ParsedEnvelope;
  try {
    envelope = await parseEnvelope(request);
  } catch (error) {
    return jsonResponse({ error: errorCode(error) }, 400);
  }

  const action = VERIFY_PATHS.has(url.pathname) ? "verify" : "settle";
  const adapter = ADAPTER_BY_ID.get(envelope.protocol);
  if (adapter === undefined)
    return jsonResponse({ error: "unsupported_xguard_protocol" }, 400);

  if (envelope.protocol === "x402") {
    const delegated = requestForX402(request, action, envelope.payload);
    const response =
      action === "verify"
        ? await delegates.verifyX402(delegated)
        : await delegates.settleX402(delegated);
    return annotateProtocolResponse(response, envelope.protocol, "native");
  }

  if (action === "verify") {
    const structural = structuralVerification(
      envelope.protocol,
      envelope.payload,
      request,
    );
    if (!structural.ok)
      return jsonResponse(
        {
          protocol: envelope.protocol,
          accepted: false,
          validation: structural.validation,
          error: structural.error,
        },
        422,
      );

    return jsonResponse({
      protocol: envelope.protocol,
      accepted: true,
      validation: structural.validation,
      cryptographicVerification: structural.cryptographicVerification,
      settlement: adapter.settlement,
      adapter,
      next:
        adapter.settlement === "native"
          ? "/v1/transactions/settle"
          : "Attach an explicit settlement bridge when money movement is required.",
    });
  }

  const settlement = parseSettlementBridge(envelope.wrapper);
  if (settlement === null)
    return jsonResponse(
      {
        error: "settlement_bridge_required",
        protocol: envelope.protocol,
        message:
          `${adapter.label} is not treated as an implicit money-movement rail by XGuard. ` +
          "Provide settlement.protocol and settlement.payload explicitly.",
        supportedSettlementBridges: ["x402"],
      },
      422,
    );

  if (settlement.protocol !== "x402")
    return jsonResponse(
      {
        error: "settlement_bridge_not_active",
        protocol: envelope.protocol,
        requestedSettlementProtocol: settlement.protocol,
        activeSettlementBridges: ["x402"],
      },
      501,
    );

  const structural = structuralVerification(
    envelope.protocol,
    envelope.payload,
    request,
  );
  if (!structural.ok)
    return jsonResponse(
      {
        protocol: envelope.protocol,
        accepted: false,
        validation: structural.validation,
        error: structural.error,
      },
      422,
    );

  const response = await delegates.settleX402(
    requestForX402(request, "settle", settlement.payload),
  );
  return annotateProtocolResponse(response, envelope.protocol, "x402");
}

interface ParsedEnvelope {
  protocol: XGuardProtocolId;
  payload: Record<string, unknown>;
  wrapper: Record<string, unknown>;
}

async function parseEnvelope(request: Request): Promise<ParsedEnvelope> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json"))
    throw new Error("content_type_must_be_application_json");

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
    throw new Error("protocol_envelope_too_large");

  const text = await request.clone().text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error("protocol_envelope_too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
  if (!isRecord(parsed)) throw new Error("protocol_envelope_must_be_object");

  const headerProtocol = request.headers.get("x-xguard-protocol");
  const bodyProtocol =
    typeof parsed.protocol === "string" ? parsed.protocol : undefined;
  const inferred = inferProtocol(parsed);
  const protocol = normalizeProtocolId(
    headerProtocol ?? bodyProtocol ?? inferred,
  );
  if (protocol === null) throw new Error("xguard_protocol_required");

  const payload = isRecord(parsed.payload)
    ? parsed.payload
    : protocol === "x402"
      ? parsed
      : isRecord(parsed.operation)
        ? parsed.operation
        : parsed;

  return { protocol, payload, wrapper: parsed };
}

function inferProtocol(value: Record<string, unknown>): string | null {
  if (
    value.x402Version !== undefined &&
    value.paymentPayload !== undefined &&
    value.paymentRequirements !== undefined
  )
    return "x402";
  return null;
}

function structuralVerification(
  protocol: XGuardProtocolId,
  payload: Record<string, unknown>,
  request: Request,
): {
  ok: boolean;
  validation: "structural" | "transport";
  cryptographicVerification: "not-claimed" | "external-trust-material-required";
  error?: string;
} {
  if (Object.keys(payload).length === 0)
    return {
      ok: false,
      validation: protocolValidationMode(protocol),
      cryptographicVerification: "not-claimed",
      error: "empty_protocol_payload",
    };

  if (protocol === "visa-trusted-agent") {
    const signatureInput = request.headers.get("signature-input");
    const signature = request.headers.get("signature");
    if (signatureInput === null || signature === null)
      return {
        ok: false,
        validation: "structural",
        cryptographicVerification: "external-trust-material-required",
        error: "visa_trusted_agent_signature_headers_required",
      };
    return {
      ok: true,
      validation: "structural",
      cryptographicVerification: "external-trust-material-required",
    };
  }

  if (protocol === "mcp") {
    if (typeof payload.method !== "string")
      return {
        ok: false,
        validation: "transport",
        cryptographicVerification: "not-claimed",
        error: "mcp_method_required",
      };
  }

  if (protocol === "json-rpc") {
    if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string")
      return {
        ok: false,
        validation: "transport",
        cryptographicVerification: "not-claimed",
        error: "invalid_json_rpc_envelope",
      };
  }

  if (protocol === "graphql") {
    if (typeof payload.query !== "string" || payload.query.trim() === "")
      return {
        ok: false,
        validation: "transport",
        cryptographicVerification: "not-claimed",
        error: "graphql_query_required",
      };
  }

  return {
    ok: true,
    validation: protocolValidationMode(protocol),
    cryptographicVerification: "not-claimed",
  };
}

function protocolValidationMode(
  protocol: XGuardProtocolId,
): "structural" | "transport" {
  const adapter = ADAPTER_BY_ID.get(protocol);
  return adapter?.verification === "transport" ? "transport" : "structural";
}

function parseSettlementBridge(
  wrapper: Record<string, unknown>,
): { protocol: XGuardProtocolId; payload: Record<string, unknown> } | null {
  if (!isRecord(wrapper.settlement)) return null;
  const protocol = normalizeProtocolId(wrapper.settlement.protocol);
  if (protocol === null || !isRecord(wrapper.settlement.payload)) return null;
  return { protocol, payload: wrapper.settlement.payload };
}

function requestForX402(
  request: Request,
  action: "verify" | "settle",
  payload: Record<string, unknown>,
): Request {
  const url = new URL(request.url);
  url.pathname = action === "verify" ? "/verify" : "/settle";
  url.search = "";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("x-xguard-protocol");
  return new Request(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function annotateProtocolResponse(
  response: Response,
  sourceProtocol: XGuardProtocolId,
  settlementAdapter: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Source-Protocol", sourceProtocol);
  headers.set("X-XGuard-Settlement-Adapter", settlementAdapter);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function discoveryDocument(origin: string): Record<string, unknown> {
  return {
    name: "XGuard Universal Protocol Router",
    version: 1,
    protocolAgnostic: true,
    principle:
      "XGuard routes economic intent by protocol capability; it does not pretend that trust, commerce, agent transport, and settlement protocols are the same thing.",
    adapters: ADAPTERS,
    discovery: {
      paymentLayer: `${origin}/.well-known/xguard/payment-layer.json`,
      actionRail: `${origin}/.well-known/xguard/actions.json`,
      paymentManifest: `${origin}/.well-known/payment-manifest`,
      openapi: `${origin}/openapi.json`,
      agentCard: `${origin}/.well-known/agent-card.json`,
      mcpServer: `${origin}/.well-known/mcp/server.json`,
      llms: `${origin}/llms.txt`,
      llmsFull: `${origin}/llms-full.txt`,
      sitemap: `${origin}/sitemap.xml`,
    },
    crawlNext: [
      `${origin}/.well-known/xguard/actions.json`,
      `${origin}/openapi.json`,
      `${origin}/.well-known/agent-card.json`,
      `${origin}/.well-known/mcp/server.json`,
      `${origin}/llms.txt`,
    ],
    endpoints: {
      protocols: `${origin}${PROTOCOLS_PATH}`,
      verify: `${origin}/v1/transactions/verify`,
      settle: `${origin}/v1/transactions/settle`,
      legacyUnifiedVerify: `${origin}/v1/verify`,
      legacyUnifiedSettle: `${origin}/v1/settle`,
      nativeX402Verify: `${origin}/verify`,
      nativeX402Settle: `${origin}/settle`,
      universalGateway: `${origin}/v1/gateway/capabilities`,
    },
    selection: {
      header: "X-XGuard-Protocol",
      body: "protocol",
      wrapper: {
        protocol: "ap2",
        payload: { example: "protocol-specific envelope" },
        settlement: {
          protocol: "x402",
          payload: { example: "explicit settlement envelope" },
        },
      },
    },
  };
}

function normalizeProtocolId(value: unknown): XGuardProtocolId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, XGuardProtocolId> = {
    x402: "x402",
    ap2: "ap2",
    "agent-payments-protocol": "ap2",
    acp: "acp",
    "agentic-commerce-protocol": "acp",
    "visa-tap": "visa-trusted-agent",
    tap: "visa-trusted-agent",
    "trusted-agent-protocol": "visa-trusted-agent",
    "visa-trusted-agent": "visa-trusted-agent",
    mcp: "mcp",
    "model-context-protocol": "mcp",
    a2a: "a2a",
    agent2agent: "a2a",
    http: "http",
    https: "http",
    openapi: "openapi",
    "open-api": "openapi",
    graphql: "graphql",
    "json-rpc": "json-rpc",
    jsonrpc: "json-rpc",
    webhook: "webhook",
    webhooks: "webhook",
  };
  return aliases[normalized] ?? null;
}

function publicJsonHeaders(origin: string): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
    Link: [
      `<${origin}/.well-known/xguard/actions.json>; rel="service-desc"; type="application/json"`,
      `<${origin}/openapi.json>; rel="service-desc"; type="application/json"`,
      `<${origin}/.well-known/agent-card.json>; rel="alternate"; type="application/json"`,
      `<${origin}/.well-known/mcp/server.json>; rel="alternate"; type="application/json"`,
    ].join(", "),
    "X-Content-Type-Options": "nosniff",
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "invalid_protocol_request";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
