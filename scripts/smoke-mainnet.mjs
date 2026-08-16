const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ??
    "https://xguard-mainnet.maqamapp.workers.dev",
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
assert(
  root.body.price?.amount === "0.002",
  "mainnet service fee changed unexpectedly",
);
assert(
  root.body.price?.model === "merchant_prepaid_service_balance",
  "mainnet billing model changed unexpectedly",
);
assert(
  root.body.endpoints?.discovery === "/discovery/resources",
  "discovery endpoint missing",
);
assert(root.body.endpoints?.mcp === "/mcp", "MCP endpoint missing");

const health = await json("/healthz");
assert(health.response.status === 200, "mainnet health check failed");
assert(health.body.status === "ok", "mainnet health status is not ok");
assert(health.body.mode === "mainnet", "mainnet health mode changed");
assert(health.body.network === BASE_MAINNET, "mainnet health network changed");

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
assert(
  Array.isArray(supported.body.extensions) &&
    supported.body.extensions.includes("bazaar"),
  "native Bazaar capability is missing",
);

const provider = await json("/.well-known/x402/facilitator.json");
assert(provider.response.status === 200, "provider manifest endpoint failed");
assert(provider.body.kind === "x402-facilitator", "provider kind changed");
assert(provider.body.status === "production", "provider status changed");
assert(
  provider.body.facilitator?.baseUrl === baseUrl.origin,
  "provider base URL changed",
);
assert(
  provider.body.facilitator?.supported === `${baseUrl.origin}/supported` &&
    provider.body.facilitator?.verify === `${baseUrl.origin}/verify` &&
    provider.body.facilitator?.settle === `${baseUrl.origin}/settle`,
  "provider facilitator endpoints are invalid",
);
assert(
  provider.body.facilitator?.network === BASE_MAINNET &&
    provider.body.facilitator?.scheme === "exact",
  "provider x402 network or scheme changed",
);
assert(
  provider.body.facilitator?.asset?.address?.toLowerCase() ===
    BASE_USDC.toLowerCase(),
  "provider asset changed",
);
assert(
  provider.body.pricing?.feeUsd === "0.002" &&
    provider.body.pricing?.subscription === "none",
  "provider pricing metadata changed",
);
assert(
  provider.body.onboarding?.packageInstallationRequired === false,
  "provider unexpectedly requires package installation",
);
assert(
  provider.body.settlementExecution?.mode === "routed" &&
    provider.body.settlementExecution?.currentDownstream === "xpay",
  "provider settlement attribution changed",
);

const agentCard = await json(
  `/.well-known/agent-card.json?smoke=${Date.now()}`,
  { headers: { "Cache-Control": "no-cache" } },
);
assert(agentCard.response.status === 200, "A2A Agent Card endpoint failed");
assert(agentCard.body.name === "XGuard", "A2A agent identity changed");
assert(
  Array.isArray(agentCard.body.supportedInterfaces) &&
    agentCard.body.supportedInterfaces.some(
      (item) =>
        item?.url === `${baseUrl.origin}/a2a` &&
        item?.protocolBinding === "JSONRPC" &&
        item?.protocolVersion === "1.0",
    ),
  "A2A JSONRPC 1.0 interface is missing",
);
assert(
  Array.isArray(agentCard.body.skills) &&
    agentCard.body.skills.some((skill) => skill?.id === "a2a-x402-gateway"),
  "A2A x402 gateway skill is missing",
);

const a2a = await json("/a2a", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "A2A-Version": "1.0",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "xguard-mainnet-smoke-a2a-v1",
    method: "SendMessage",
    params: {
      message: {
        messageId: "xguard-mainnet-smoke-message",
        role: "ROLE_USER",
        parts: [{ text: "What x402 capabilities do you support?" }],
      },
    },
  }),
});
assert(a2a.response.status === 200, "A2A JSON-RPC endpoint failed");
assert(a2a.body.jsonrpc === "2.0", "A2A response is not JSON-RPC 2.0");
assert(
  a2a.body.result?.message?.role === "ROLE_AGENT",
  "A2A v1 response is not an agent Message",
);
assert(
  typeof a2a.body.result?.message?.parts?.[0]?.text === "string" &&
    a2a.body.result.message.parts[0].text.includes("capabilities"),
  "A2A v1 response does not expose XGuard capabilities",
);

const a2aLegacy = await json("/a2a", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "A2A-Version": "0.3",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "xguard-mainnet-smoke-a2a-03",
    method: "message/send",
    params: {
      message: {
        messageId: "xguard-mainnet-smoke-legacy-message",
        role: "user",
        parts: [{ kind: "text", text: "Show discovery endpoints" }],
      },
    },
  }),
});
assert(a2aLegacy.response.status === 200, "A2A 0.3 compatibility failed");
assert(
  a2aLegacy.body.result?.kind === "message" &&
    a2aLegacy.body.result?.role === "agent",
  "A2A 0.3 response shape changed",
);

const discovery = await json("/discovery/resources?limit=1");
assert(discovery.response.status === 200, "Bazaar discovery endpoint failed");
assert(
  discovery.body.x402Version === 2,
  "Bazaar discovery protocol version changed",
);
assert(
  Array.isArray(discovery.body.items),
  "Bazaar discovery items are missing",
);
assert(
  Number.isInteger(discovery.body.pagination?.total) &&
    discovery.body.pagination.total >= 0,
  "Bazaar discovery pagination is invalid",
);

const mcp = await json("/mcp", {
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
assert(mcp.response.status === 200, "remote MCP endpoint failed");
assert(mcp.body.jsonrpc === "2.0", "MCP response is not JSON-RPC 2.0");
assert(
  mcp.body.result?.serverInfo?.name === "xguard-mainnet",
  "MCP server identity changed",
);
assert(
  mcp.body.result?.capabilities?.tools !== undefined,
  "MCP tools capability is missing",
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
assert(tools.response.status === 200, "MCP tools/list failed");
assert(
  Array.isArray(tools.body.result?.tools) &&
    tools.body.result.tools.some((tool) => tool?.name === "xguard_discover"),
  "MCP xguard_discover tool is missing",
);

const status = await json("/status");
assert(status.response.status === 200, "mainnet status endpoint failed");
assert(
  status.body.gateway === "operational",
  "mainnet gateway is not operational",
);
assert(status.body.mode === "mainnet", "mainnet status mode changed");
assert(status.body.network === BASE_MAINNET, "mainnet status network changed");
assert(
  status.body.facilitator === "HEALTHY",
  "mainnet facilitator is not healthy",
);
assert(
  Number.isInteger(status.body.openReconciliationCases) &&
    status.body.openReconciliationCases >= 0,
  "mainnet reconciliation count is invalid",
);
assert(
  Number.isInteger(status.body.successfulBillableSettlements) &&
    status.body.successfulBillableSettlements >= 0,
  "mainnet earned settlement count is invalid",
);
assert(
  Number.isInteger(status.body.earnedMicroUsd) &&
    status.body.earnedMicroUsd >= 0,
  "mainnet earned revenue total is invalid",
);
assert(
  Number.isInteger(status.body.discovery?.resources) &&
    status.body.discovery.resources >= 0,
  "mainnet discovery resource count is invalid",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    live: true,
    ready: true,
    mainnet: true,
    network: status.body.network,
    facilitator: status.body.facilitator,
    providerManifest: true,
    a2a: true,
    bazaar: true,
    mcp: true,
    discoveryResources: status.body.discovery.resources,
    successfulBillableSettlements: status.body.successfulBillableSettlements,
    earnedMicroUsd: status.body.earnedMicroUsd,
    openReconciliationCases: status.body.openReconciliationCases,
  }),
);
