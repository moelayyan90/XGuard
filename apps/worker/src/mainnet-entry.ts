import mainnetHandler, {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
} from "./mainnet.js";

export { MainnetPaymentCoordinator, MainnetRequestGate };

type MainnetFetchArgs = Parameters<typeof mainnetHandler.fetch>;

export default {
  ...mainnetHandler,
  async fetch(...args: MainnetFetchArgs): Promise<Response> {
    const [request, env, executionCtx] = args;
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "POST") {
      const discoveryRequest = new Request(request, {
        method: "GET",
        body: null,
      });
      const response = await mainnetHandler.fetch(
        discoveryRequest,
        env,
        executionCtx,
      );
      const headers = new Headers(response.headers);
      headers.set("X-XGuard-Discovery", "root-post");
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return mainnetHandler.fetch(request, env, executionCtx);
  },
};
