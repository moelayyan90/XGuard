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

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    live: true,
    ready: true,
    mainnet: true,
    network: status.body.network,
    facilitator: status.body.facilitator,
    successfulBillableSettlements: status.body.successfulBillableSettlements,
    earnedMicroUsd: status.body.earnedMicroUsd,
    openReconciliationCases: status.body.openReconciliationCases,
  }),
);
