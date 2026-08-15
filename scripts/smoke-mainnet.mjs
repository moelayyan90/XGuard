const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ?? "https://xguard-mainnet.maqamapp.workers.dev",
);

async function json(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
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
assert(root.body.network?.caip2 === "eip155:8453", "root network is not Base mainnet");
assert(root.body.asset?.symbol === "USDC", "root asset is not USDC");
assert(root.body.price?.amount === "0.002", "mainnet service fee changed unexpectedly");
assert(
  root.body.billing?.model === "merchant_prepaid_service_balance",
  "mainnet billing model changed unexpectedly",
);

const health = await json("/healthz");
assert(health.response.status === 200, "mainnet health check failed");
assert(health.body.status === "ok", "mainnet health status is not ok");
assert(health.body.mode === "mainnet", "mainnet health mode changed");
assert(health.body.network === "eip155:8453", "mainnet health network changed");

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
        kind?.network === "eip155:8453",
    ),
  "mainnet Base x402 v2 exact capability is missing",
);

const status = await json("/status");
assert(status.response.status === 200, "mainnet status endpoint failed");
assert(status.body.gateway === "operational", "mainnet gateway is not operational");
assert(status.body.mode === "mainnet", "mainnet status mode changed");
assert(status.body.network === "eip155:8453", "mainnet status network changed");
assert(status.body.facilitator === "HEALTHY", "mainnet facilitator is not healthy");
assert(
  Number.isInteger(status.body.feeMicroUsd) && status.body.feeMicroUsd === 2_000,
  "mainnet fee configuration changed unexpectedly",
);
assert(
  Number.isInteger(status.body.downstreamCostMicroUsd) &&
    status.body.downstreamCostMicroUsd >= 0 &&
    status.body.downstreamCostMicroUsd < status.body.feeMicroUsd,
  "mainnet downstream route is economically ineligible",
);
assert(
  status.body.contributionMicroUsd ===
    status.body.feeMicroUsd - status.body.downstreamCostMicroUsd,
  "mainnet contribution calculation is inconsistent",
);

const unauthorized = await json("/v1/balance");
assert(
  unauthorized.response.status === 401,
  "mainnet merchant balance did not fail closed without authentication",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    live: true,
    ready: true,
    mainnet: true,
    network: status.body.network,
    facilitator: status.body.facilitator,
    feeMicroUsd: status.body.feeMicroUsd,
    downstreamCostMicroUsd: status.body.downstreamCostMicroUsd,
    contributionMicroUsd: status.body.contributionMicroUsd,
    openReconciliationCases: status.body.openReconciliationCases,
  }),
);
