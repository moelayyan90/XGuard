const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ?? "https://xguardgate.com",
);

const BASE_MAINNET = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MONITOR_HEADER = "github-actions-mainnet-smoke";

async function json(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      "X-XGuard-Monitor": MONITOR_HEADER,
      ...(init.headers ?? {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await json("/");
assert(root.response.status === 200, "mainnet root endpoint is unavailable");
assert(root.body.mode === "mainnet", "root is not mainnet");
assert(root.body.network === BASE_MAINNET, "root network is not Base mainnet");
assert(root.body.asset === BASE_USDC, "root asset is not native Base USDC");

const health = await json("/healthz");
assert(health.response.status === 200, "mainnet health check failed");
assert(health.body.status === "ok", "mainnet health status is not ok");
assert(health.body.mode === "mainnet", "mainnet health mode changed");

const readiness = await json("/readyz");
assert(readiness.response.status === 200, "mainnet readiness check failed");
assert(readiness.body.status === "ready", "mainnet is not ready");
assert(readiness.body.mainnet === true, "mainnet readiness flag is false");
assert(
  readiness.body.facilitator === "operational",
  "mainnet facilitator is not operational",
);

const supported = await json("/supported");
assert(supported.response.status === 200, "mainnet supported endpoint failed");
assert(
  Array.isArray(supported.body.kinds) &&
    supported.body.kinds.some(
      (kind) =>
        kind?.x402Version === 2 &&
        kind?.scheme === "exact" &&
        kind?.network === BASE_MAINNET,
    ),
  "mainnet Base x402 v2 exact capability is missing",
);

const capabilities = await json("/v1/gateway/capabilities");
assert(capabilities.response.status === 200, "universal gateway capabilities failed");
assert(
  capabilities.body.billing?.modelMicroUsd === 100,
  "model gateway fee changed unexpectedly",
);
assert(
  capabilities.body.billing?.toolMicroUsd === 200,
  "tool gateway fee changed unexpectedly",
);
assert(
  capabilities.body.billing?.sourceMicroUsd === 1000,
  "source gateway fee changed unexpectedly",
);
assert(
  capabilities.body.billing?.analysisMicroUsd === 2000,
  "analysis gateway fee changed unexpectedly",
);
assert(
  capabilities.body.billing?.securityMicroUsd === 1000,
  "security gateway fee changed unexpectedly",
);
assert(
  capabilities.body.billing?.chargingModel ===
    "prepaid-per-successful-gateway-event",
  "gateway charging model changed unexpectedly",
);

const directResources = await json("/discovery/resources?limit=1");
assert(
  directResources.response.status === 401,
  "direct catalog resources bypassed prepaid authentication",
);

const directSearch = await json("/discovery/search?query=weather");
assert(
  directSearch.response.status === 401,
  "direct catalog search bypassed prepaid authentication",
);

const unauthenticatedVerify = await json("/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
assert(
  unauthenticatedVerify.response.status === 401,
  "verify did not fail closed without merchant authentication",
);

const mcpInitialize = await json("/mcp", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "xguard-smoke", version: "1.0.0" },
    },
  }),
});
assert(mcpInitialize.response.status === 200, "free MCP initialize failed");
assert(
  mcpInitialize.body.result?.serverInfo?.name === "xguard-mainnet",
  "MCP server identity changed",
);

const tools = await json("/mcp", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }),
});
assert(tools.response.status === 200, "free MCP tools/list failed");
assert(
  Array.isArray(tools.body.result?.tools) &&
    tools.body.result.tools.some((tool) => tool?.name === "xguard_discover"),
  "MCP xguard_discover tool is missing",
);

const paidMcp = await json("/mcp", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "xguard_discover",
      arguments: { query: "weather" },
    },
  }),
});
assert(
  paidMcp.response.status === 401,
  "paid MCP discovery executed without merchant authentication",
);

const status = await json("/status");
assert(status.response.status === 200, "mainnet status endpoint failed");
assert(status.body.gateway === "operational", "mainnet gateway is not operational");
assert(status.body.mode === "mainnet", "mainnet status mode changed");
assert(
  status.body.facilitator === "HEALTHY",
  "mainnet facilitator is not healthy",
);
assert(
  status.body.financialMetrics === "private" &&
    status.body.successfulBillableSettlements === undefined &&
    status.body.earnedMicroUsd === undefined,
  "mainnet public status exposed protected financial metrics",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    live: true,
    ready: true,
    mainnet: true,
    universalGateway: true,
    directDiscoveryPaywalled: true,
    verifyPaywalled: true,
    mcpExecutionPaywalled: true,
    network: status.body.network,
    facilitator: status.body.facilitator,
  }),
);
