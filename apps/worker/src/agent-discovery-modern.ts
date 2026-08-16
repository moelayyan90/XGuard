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
    },
  };
}

export async function enhanceAgentDiscoveryResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!response.ok || request.method !== "GET") return response;
  const url = new URL(request.url);

  if (
    url.pathname === "/.well-known/agent-card.json" ||
    url.pathname === "/.well-known/agent.json"
  ) {
    return rewriteJson(response, (body) => {
      body.version = XGUARD_MCP_VERSION;
      body.supportedInterfaces = [
        {
          url: `${url.origin}/a2a`,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
        {
          url: `${url.origin}/a2a`,
          protocolBinding: "JSONRPC",
          protocolVersion: "0.3",
        },
      ];
      body.provider = {
        organization: "XGuard",
        url: "https://github.com/moelayyan90/XGuard",
      };
      body.defaultInputModes = ["text/plain", "application/json"];
      body.defaultOutputModes = ["text/plain", "application/json"];
      body.iconUrl = `${url.origin}/logo.svg`;

      // Legacy A2A 0.3 discovery fields. Current A2A 1.0 clients use
      // supportedInterfaces above; old clients can still negotiate JSONRPC.
      body.url = `${url.origin}/a2a`;
      body.protocolVersion = "0.3";
      body.preferredTransport = "JSONRPC";
      body.additionalInterfaces = [
        { url: `${url.origin}/a2a`, transport: "JSONRPC" },
      ];

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
          (skill) => isRecord(skill) && skill.id === "a2a-x402-gateway",
        )
      ) {
        skills.push({
          id: "a2a-x402-gateway",
          name: "Query XGuard over A2A",
          description:
            "Ask XGuard for live x402 capabilities, status, pricing, or agent-discovery endpoints through the A2A JSON-RPC protocol.",
          tags: ["a2a", "jsonrpc", "x402", "payments", "agents"],
          examples: [
            "What x402 capabilities do you support?",
            "What is XGuard's live status?",
            "Show the XGuard discovery endpoints.",
            "What does XGuard charge?",
          ],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"],
        });
      }
      body.skills = skills;
      body.xguardDiscovery = {
        a2a: `${url.origin}/a2a`,
        mcp: `${url.origin}/mcp`,
        mcpManifest: `${url.origin}/.well-known/mcp/server.json`,
        resources: `${url.origin}/discovery/resources`,
        search: `${url.origin}/discovery/search`,
        preferredA2AProtocolVersion: "1.0",
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
        a2a: `${url.origin}/a2a`,
        mcp: `${url.origin}/mcp`,
        mcpManifest: `${url.origin}/.well-known/mcp/server.json`,
        resources: `${url.origin}/discovery/resources`,
        search: `${url.origin}/discovery/search`,
        preferredA2AProtocolVersion: "1.0",
        preferredMcpProtocolVersion: "2026-07-28",
      };
      return body;
    });
  }

  if (url.pathname === "/openapi.json") {
    return rewriteJson(response, (body) => {
      if (isRecord(body.info)) body.info.version = XGUARD_MCP_VERSION;
      const paths = isRecord(body.paths) ? body.paths : {};
      paths["/a2a"] ??= {
        post: {
          summary: "XGuard A2A JSON-RPC endpoint",
          description:
            "Supports A2A 1.0 SendMessage and A2A 0.3 message/send over JSON-RPC 2.0.",
          responses: { "200": { description: "A2A JSON-RPC response" } },
        },
      };
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
      `A2A: ${url.origin}/a2a (JSON-RPC; preferred protocol 1.0; compatible with 0.3 message/send)`,
      `MCP: ${url.origin}/mcp (preferred protocol 2026-07-28; Streamable HTTP; stateless)`,
      `MCP manifest: ${url.origin}/.well-known/mcp/server.json`,
      `Bazaar resources: ${url.origin}/discovery/resources`,
      `Bazaar search: ${url.origin}/discovery/search?query=<terms>`,
    ].join("\n");
    return textResponse(response, `${text.trimEnd()}${appendix}\n`);
  }

  return response;
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
