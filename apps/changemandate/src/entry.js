import worker, { ReplayGuard } from "./index.js";

export { ReplayGuard };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response(JSON.stringify({
        error: {
          code: "MCP_GET_NOT_SUPPORTED",
          message: "This MCP server uses request/response Streamable HTTP over POST. No resumable SSE session is available for GET."
        }
      }), {
        status: 405,
        headers: {
          "allow": "POST, OPTIONS",
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*"
        }
      });
    }
    return worker.fetch(request, env, ctx);
  }
};
