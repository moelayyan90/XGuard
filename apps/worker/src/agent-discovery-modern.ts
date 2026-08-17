import { XGUARD_MCP_VERSION } from "./mainnet-mcp-modern.js";

export function modernMcpManifest(origin: string) {
  return {
    name: "io.github.moelayyan90/xguard",
    title: "XGuard",
    description:
      "Remote MCP server for discovering x402-paid HTTP APIs and MCP tools cataloged by XGuard.",
    version: XGUARD_MCP_VERSION,
    protocol: "x402-v2",
    network: "eip155:8453",
    mcp: {
      preferredProtocolVersion: "2026-07-28",
      backwardCompatibleThrough: "2025-03-26",
      transport: "streamable-http",
      stateless: true,
    },
    remotes: [{ type: "streamable-http", url: `${origin}/mcp` }],
    discovery: {
      resources: `${origin}/discovery/resources`,
      search: `${origin}/discovery/search`,
      migration: `${origin}/.well-known/xguard/migrate`,
      settlementTruth: `${origin}/v1/settlements/{logicalPaymentKey}/truth`,
      settlementResolve: `${origin}/v1/settlements/{logicalPaymentKey}/resolve`,
    },
  };
}

export async function enhanceAgentDiscoveryResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!response.ok || request.method !== "GET") return response;
  const url = new URL(request.url);

  if (url.pathname === "/.well-known/agent-card.json") {
    return rewriteJson(response, (body) => {
      body.version = XGUARD_MCP_VERSION;
      const skills = Array.isArray(body.skills) ? body.skills : [];
      if (
        !skills.some(
          (skill) => isRecord(skill) && skill.id === "mcp-x402-discovery",
        )
      ) {
        skills.push({
          id: "mcp-x402-discovery",
          name: "Discover x402 resources over MCP",
          description:
            "Use the public Streamable HTTP MCP server to discover paid x402 HTTP APIs and MCP tools cataloged by XGuard.",
          tags: ["mcp", "x402", "bazaar", "discovery", "agents"],
          examples: [
            `POST ${url.origin}/mcp with MCP-Protocol-Version: 2026-07-28`,
            `GET ${url.origin}/discovery/resources`,
            `GET ${url.origin}/discovery/search?query=weather`,
          ],
        });
      }
      if (
        !skills.some(
          (skill) => isRecord(skill) && skill.id === "x402-safe-migration",
        )
      ) {
        skills.push({
          id: "x402-safe-migration",
          name: "Generate a safe XGuard migration kit",
          description:
            "Generate side-effect-free instructions for a merchant-controlled switch from an observed facilitator path to XGuard without creating payments or changing third-party infrastructure.",
          tags: ["x402", "migration", "facilitator", "safety"],
          examples: [
            `GET ${url.origin}/.well-known/xguard/migrate?from=cdp&name=my-service`,
          ],
        });
      }
      if (
        !skills.some(
          (skill) => isRecord(skill) && skill.id === "x402-settlement-truth",
        )
      ) {
        skills.push({
          id: "x402-settlement-truth",
          name: "Resolve independent x402 settlement truth",
          description:
            "Use XGuard's merchant-scoped finality and recovery endpoints to distinguish FINALIZED, PENDING, PROVEN_FAILED, and CONFLICT without blindly resubmitting an ambiguous payment authorization.",
          tags: [
            "x402",
            "settlement",
            "finality",
            "recovery",
            "payments",
            "safety",
          ],
          examples: [
            `GET ${url.origin}/v1/settlements/<logicalPaymentKey>/truth`,
            `POST ${url.origin}/v1/settlements/<logicalPaymentKey>/resolve`,
          ],
        });
      }
      body.skills = skills;
      body.xguardDiscovery = {
        mcp: `${url.origin}/mcp`,
        mcpManifest: `${url.origin}/.well-known/mcp/server.json`,
        resources: `${url.origin}/discovery/resources`,
        search: `${url.origin}/discovery/search`,
        migration: `${url.origin}/.well-known/xguard/migrate`,
        settlementTruth: `${url.origin}/v1/settlements/{logicalPaymentKey}/truth`,
        settlementResolve: `${url.origin}/v1/settlements/{logicalPaymentKey}/resolve`,
        preferredMcpProtocolVersion: "2026-07-28",
      };
      return body;
    });
  }

  if (url.pathname === "/.well-known/agent-market.json") {
    return rewriteJson(response, (body) => {
      body.version = XGUARD_MCP_VERSION;
      const discovery = isRecord(body.discovery) ? body.discovery : {};
      body.discovery = {
        ...discovery,
        mcp: `${url.origin}/mcp`,
        mcpManifest: `${url.origin}/.well-known/mcp/server.json`,
        resources: `${url.origin}/discovery/resources`,
        search: `${url.origin}/discovery/search`,
        migration: `${url.origin}/.well-known/xguard/migrate`,
        settlementTruth: `${url.origin}/v1/settlements/{logicalPaymentKey}/truth`,
        settlementResolve: `${url.origin}/v1/settlements/{logicalPaymentKey}/resolve`,
        preferredMcpProtocolVersion: "2026-07-28",
      };
      return body;
    });
  }

  if (url.pathname === "/openapi.json") {
    return rewriteJson(response, (body) => {
      if (isRecord(body.info)) body.info.version = XGUARD_MCP_VERSION;
      const paths = isRecord(body.paths) ? body.paths : {};
      paths["/discovery/resources"] ??= {
        get: {
          summary: "List x402 Bazaar resources cataloged by XGuard",
          responses: { "200": { description: "Discovery catalog" } },
        },
      };
      paths["/discovery/search"] ??= {
        get: {
          summary: "Search XGuard's x402 Bazaar catalog",
          parameters: [
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Matching resources" } },
        },
      };
      paths["/.well-known/xguard/migrate"] ??= {
        get: {
          summary: "Generate a side-effect-free XGuard facilitator switch kit",
          description:
            "Returns merchant-controlled migration instructions only. It does not register, fund, mutate third-party configuration, create synthetic payments, or execute verify/settle calls.",
          parameters: [
            { name: "from", in: "query", schema: { type: "string" } },
            { name: "name", in: "query", schema: { type: "string" } },
            {
              name: "resource",
              in: "query",
              schema: { type: "string", format: "uri" },
            },
          ],
          responses: { "200": { description: "Safe migration kit" } },
        },
      };
      paths["/v1/settlements/{logicalPaymentKey}/truth"] ??= {
        get: {
          summary: "Read XGuard's independent settlement truth",
          description:
            "Merchant-authenticated lookup of finalized Base settlement and EIP-3009 recovery evidence. FINALIZED is the only release-safe state.",
          security: [{ bearerAuth: [] }],
          parameters: [logicalPaymentKeyParameter()],
          responses: {
            "200": {
              description:
                "Terminal settlement truth or fail-closed conflicting evidence",
            },
            "202": { description: "Independent evidence remains pending" },
            "401": { description: "Merchant authentication required" },
            "404": { description: "Settlement truth record not found" },
          },
        },
      };
      paths["/v1/settlements/{logicalPaymentKey}/resolve"] ??= {
        post: {
          summary: "Resolve an ambiguous x402 settlement now",
          description:
            "Triggers immediate finalized Base and EIP-3009 recovery checks without blindly resubmitting the payment authorization.",
          security: [{ bearerAuth: [] }],
          parameters: [logicalPaymentKeyParameter()],
          responses: {
            "200": { description: "Resolution reached a terminal truth state" },
            "202": {
              description: "Sufficient final evidence is not yet available",
            },
            "401": { description: "Merchant authentication required" },
            "404": { description: "Settlement truth record not found" },
          },
        },
      };
      paths["/mcp"] ??= {
        post: {
          summary: "XGuard Streamable HTTP MCP endpoint",
          description:
            "Supports MCP 2026-07-28 stateless requests and backward-compatible 2025-era requests.",
          responses: { "200": { description: "MCP JSON-RPC response" } },
        },
      };
      body.paths = paths;
      return body;
    });
  }

  if (url.pathname === "/llms.txt" || url.pathname === "/llms-full.txt") {
    const text = await response.text();
    const appendix = [
      "",
      "## Agent discovery",
      `MCP: ${url.origin}/mcp (preferred protocol 2026-07-28; Streamable HTTP; stateless)`,
      `MCP manifest: ${url.origin}/.well-known/mcp/server.json`,
      `Bazaar resources: ${url.origin}/discovery/resources`,
      `Bazaar search: ${url.origin}/discovery/search?query=<terms>`,
      `Safe migration kit: ${url.origin}/.well-known/xguard/migrate?from=<cdp|payai>&name=<merchant>`,
      `Settlement truth: ${url.origin}/v1/settlements/<logicalPaymentKey>/truth (merchant API key required)`,
      `Settlement resolve: ${url.origin}/v1/settlements/<logicalPaymentKey>/resolve (merchant API key required; POST)`,
      "Settlement truth states are FINALIZED, PENDING, PROVEN_FAILED, and CONFLICT; only FINALIZED is release-safe.",
      "The resolver checks independent Base finality and EIP-3009 recovery evidence and never blindly resubmits an ambiguous authorization.",
      "The migration kit is instruction-only and does not move funds, change third-party infrastructure, or synthesize x402 settlements.",
    ].join("\n");
    return textResponse(response, `${text.trimEnd()}${appendix}\n`);
  }

  return response;
}

function logicalPaymentKeyParameter() {
  return {
    name: "logicalPaymentKey",
    in: "path",
    required: true,
    description: "Immutable XGuard logical payment identity",
    schema: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
  };
}

async function rewriteJson(
  response: Response,
  mutate: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<Response> {
  try {
    const body = await response.json();
    if (!isRecord(body)) return response;
    return jsonResponse(response, mutate(body));
  } catch {
    return response;
  }
}

function jsonResponse(response: Response, body: unknown): Response {
  const headers = freshHeaders(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function textResponse(response: Response, body: string): Response {
  const headers = freshHeaders(response.headers);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function freshHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Cache-Control", "public, max-age=300");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
