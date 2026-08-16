const AGENT_CARD_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
]);

export async function enhanceA2AAgentCard(
  request: Request,
  response: Response,
): Promise<Response> {
  const url = new URL(request.url);
  if (!response.ok || !AGENT_CARD_PATHS.has(url.pathname)) return response;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (!isRecord(body)) return response;

  const a2aUrl = `${url.origin}/a2a`;
  const capabilities = isRecord(body.capabilities) ? body.capabilities : {};

  const card = {
    ...body,
    protocolVersion: "0.3.0",
    url: a2aUrl,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: a2aUrl, transport: "JSONRPC" }],
    supportedInterfaces: [
      {
        url: a2aUrl,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3",
      },
    ],
    provider: {
      organization: "XGuard",
      url: "https://github.com/moelayyan90/XGuard",
    },
    capabilities: {
      ...capabilities,
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
  };

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(request.method === "HEAD" ? null : JSON.stringify(card), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
