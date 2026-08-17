const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ??
    "https://xguardgate.com",
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

const glama = await json("/.well-known/glama.json");
assert(glama.response.status === 200, "Glama discovery endpoint failed");
assert(
  glama.body.$schema === "https://glama.ai/mcp/schemas/connector.json",
  "Glama connector schema changed",
);
assert(
  Array.isArray(glama.body.maintainers) &&
    glama.body.maintainers.some(
      (maintainer) => maintainer?.email === "mo.elayyan2023@gmail.com",
    ),
  "Glama maintainer ownership metadata is missing",
);

const migration = await json(
  "/.well-known/xguard/migrate?from=cdp&name=mainnet-smoke",
);
assert(migration.response.status === 200, "safe migration endpoint failed");
assert(migration.body.schemaVersion === "2", "migration schema changed");
assert(
  migration.body.sideEffects === false,
  "migration endpoint gained side effects",
);
assert(
  migration.body.paymentExecution === false,
  "migration endpoint unexpectedly executes payments",
);
const preCutover = migration.body.steps?.find(
  (step) => step?.id === "safe-precutover-checks",
);
assert(preCutover?.sideEffects === false, "pre-cutover checks are not safe");
assert(
  Array.isArray(preCutover?.requests) &&
    preCutover.requests.every((request) => request.startsWith("GET ")) &&
    !preCutover.requests.some(
      (request) => request.includes("/verify") || request.includes("/settle"),
    ),
  "migration pre-cutover checks include billable/protocol execution",
);
assert(
  migration.body.automationBoundary?.createsSyntheticPayments === false &&
    migration.body.automationBoundary
      ?.callsVerifyOrSettleWithoutRealProtocolTraffic === false,
  "migration automation safety boundary changed",
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
  status.body.financialMetrics === "private" &&
    status.body.successfulBillableSettlements === undefined &&
    status.body.earnedMicroUsd === undefined,
  "mainnet public status exposed protected financial metrics",
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
    glamaDiscovery: true,
    migrationKit: true,
    bazaar: true,
    mcp: true,
    financialMetrics: status.body.financialMetrics,
    discoveryResources: status.body.discovery.resources,
    openReconciliationCases: status.body.openReconciliationCases,
  }),
);
