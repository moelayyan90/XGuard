// Store UPSTREAM_KEY with `wrangler secret put UPSTREAM_KEY`.
// Register this HTTPS URL in XGuard with upstream_auth:
// { header: "x-api-key", prefix: "", secret: "<same UPSTREAM_KEY>" }.
export default {
  async fetch(request, env) {
    if (!env.UPSTREAM_KEY || request.headers.get('x-api-key') !== env.UPSTREAM_KEY) return new Response('Unauthorized', { status: 401 });
    // Replace with your existing API handler. Never echo authentication headers.
    return Response.json({ result: 'Your useful API result' });
  },
};
