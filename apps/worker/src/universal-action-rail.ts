import { genericHttpConnectorResponse } from "./generic-http-connector.js";

const ACTION_EXECUTION_PATH = "/v1/actions/execute";
const ACTION_DISCOVERY_PATHS = new Set([
  "/v1/actions",
  "/v1/actions/capabilities",
  "/.well-known/xguard/actions.json",
]);
const ALLOWED_EXECUTION_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

interface UniversalActionRailEnv {
  DB: D1Database;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
}

export async function universalActionRailResponse(
  request: Request,
  env: UniversalActionRailEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    ACTION_DISCOVERY_PATHS.has(url.pathname) &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return actionDiscoveryResponse(request, url.origin);
  }

  if (url.pathname !== ACTION_EXECUTION_PATH) return null;

  if (!ALLOWED_EXECUTION_METHODS.has(request.method)) {
    return jsonResponse(
      {
        error: "action_method_not_supported",
        allowed: [...ALLOWED_EXECUTION_METHODS],
      },
      405,
      { Allow: [...ALLOWED_EXECUTION_METHODS].join(", ") },
    );
  }

  const connectorUrl = new URL(request.url);
  connectorUrl.pathname = "/v1/gateway/http";
  connectorUrl.search = "";

  const connectorRequest = new Request(connectorUrl.toString(), {
    method: request.method,
    headers: new Headers(request.headers),
    body:
      request.method === "GET" || request.method === "HEAD"
        ? null
        : request.body,
    redirect: "manual",
  });

  const response = await genericHttpConnectorResponse(connectorRequest, env);
  if (response === null) {
    return jsonResponse({ error: "action_connector_unavailable" }, 503);
  }

  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Action-Rail", "true");
  headers.set(
    "Link",
    `<${url.origin}/.well-known/xguard/actions.json>; rel="service-desc"`,
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function actionDiscoveryResponse(request: Request, origin: string): Response {
  const body = {
    name: "XGuard Universal Action Rail",
    version: 1,
    category: "universal-action-gateway",
    description:
      "Hosted execution rail for public HTTPS API actions, agent tools, webhooks, workflows and application transactions. XGuard meters the guarded execution path rather than limiting itself to payment settlement.",
    execute: `${origin}${ACTION_EXECUTION_PATH}`,
    discovery: {
      machineReadable: true,
      localInstallRequired: false,
      serviceDescription: `${origin}/.well-known/xguard/actions.json`,
      a2aAgentCard: `${origin}/.well-known/agent-card.json`,
      mcpEndpoint: `${origin}/mcp`,
    },
    methods: [...ALLOWED_EXECUTION_METHODS],
    target: {
      header: "X-XGuard-Upstream-Url",
      rule: "Public HTTPS hostname on port 443; private, local, IP-literal and credential-bearing URLs are rejected.",
    },
    authentication: {
      xguard: "Bearer <XGuard merchant API key>",
      upstreamCredential: "X-XGuard-Upstream-Key",
      separation:
        "XGuard credentials are never forwarded to the arbitrary upstream service.",
    },
    billing: {
      model: "prepaid-per-successful-upstream-action",
      kind: "TOOL",
      quote: `${origin}/v1/gateway/quote`,
      failedUpstreamExecution: "not earned",
    },
    capabilities: [
      "execute public HTTPS API calls",
      "preserve idempotency-key forwarding",
      "meter successful execution",
      "release the reserved fee when upstream execution fails",
      "reject redirects and unsafe upstream targets",
      "return XGuard request, latency and accounting metadata",
    ],
    discoveryTags: [
      "api",
      "automation",
      "agent-tool",
      "webhook",
      "workflow",
      "transaction",
      "integration",
      "booking",
      "order",
      "commerce",
      "crm",
      "messaging",
      "fulfillment",
      "security",
      "x402",
    ],
    automaticInvocation: {
      supported:
        "A compatible agent, gateway or application can select this hosted rail from machine-readable discovery metadata and then invoke it without an XGuard-specific SDK.",
      boundary:
        "XGuard does not intercept unrelated websites or devices without authorization. A caller or infrastructure layer must route the action through the hosted endpoint.",
      localInstallRequired: false,
    },
    related: {
      universalGateway: `${origin}/v1/gateway/capabilities`,
      protocols: `${origin}/.well-known/xguard/protocols.json`,
      mcp: `${origin}/mcp`,
      a2a: `${origin}/.well-known/agent-card.json`,
      x402: `${origin}/.well-known/x402/facilitator.json`,
    },
  };

  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(body, null, 2),
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
