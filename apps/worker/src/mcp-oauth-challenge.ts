const PROTECTED_MCP_TOOLS = new Set(["xguard_payment_decision"]);
const MAX_INSPECTION_BODY_BYTES = 128 * 1024;

export async function mcpOAuthChallengeResponse(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" || request.method !== "POST") return null;
  if (request.headers.get("authorization") !== null) return null;

  const toolName = await requestedToolName(request);
  if (toolName === null || !PROTECTED_MCP_TOOLS.has(toolName)) return null;

  const resourceMetadata = `${url.origin}/.well-known/oauth-protected-resource/mcp`;
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      message: "This XGuard MCP tool requires authorization",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}", scope="xguard:mcp"`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, MCP-Session-Id",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function requestedToolName(request: Request): Promise<string | null> {
  const headerName = request.headers.get("mcp-name");
  if (headerName !== null && headerName !== "") return decodeHeaderValue(headerName);

  const contentType =
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  if (contentType !== "application/json") return null;

  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_INSPECTION_BODY_BYTES)
    return null;

  try {
    const text = await request.clone().text();
    if (new TextEncoder().encode(text).byteLength > MAX_INSPECTION_BODY_BYTES)
      return null;
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || parsed.method !== "tools/call") return null;
    const params = isRecord(parsed.params) ? parsed.params : null;
    return params !== null && typeof params.name === "string"
      ? params.name
      : null;
  } catch {
    return null;
  }
}

function decodeHeaderValue(value: string): string | null {
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  try {
    const encoded = value.slice("=?base64?".length, -2);
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
