const baseUrl = new URL(
  process.env.XGUARD_LIVE_URL ?? "https://xguard-testnet.maqamapp.workers.dev",
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
assert(root.response.status === 200, "root endpoint is unavailable");
assert(root.body.mode === "testnet-only", "root is not testnet-only");
assert(
  root.body.price?.testnetCharged === false,
  "testnet charging is enabled",
);

const health = await json("/healthz");
assert(health.response.status === 200, "health check failed");
assert(health.body.mode === "testnet-only", "health mode is not testnet-only");

const readiness = await json("/readyz");
assert(readiness.response.status === 200, "readiness check failed");
assert(readiness.body.mainnet === false, "mainnet is unexpectedly enabled");
assert(
  readiness.body.measuredRoutes > 0,
  "no measured facilitator route exists",
);

const supported = await json("/supported");
assert(supported.response.status === 200, "supported endpoint failed");
assert(
  Array.isArray(supported.body.kinds) && supported.body.kinds.length > 0,
  "no measured x402 capability is advertised",
);
assert(
  supported.body.kinds.every(
    (kind) =>
      kind.x402Version === 2 &&
      kind.scheme === "exact" &&
      kind.network === "eip155:84532",
  ),
  "supported endpoint advertises a capability outside the release matrix",
);

const status = await json("/status");
assert(status.response.status === 200, "status endpoint failed");
assert(status.body.mode === "testnet-only", "status mode is not testnet-only");
assert(
  status.body.openReconciliationCases === 0,
  "live reconciliation cases remain open",
);

const malformed = await json("/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
assert(
  malformed.response.status === 400,
  "malformed verify did not fail closed",
);

const requirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x3333333333333333333333333333333333333333",
  amount: "1000",
  payTo: "0x2222222222222222222222222222222222222222",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: "eip3009", paymentFlow: "authorization" },
};
const mainnet = await json("/settle", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: {
        url: "https://merchant.example/resource",
        description: "XGuard mainnet rejection probe",
        mimeType: "application/json",
      },
      accepted: requirements,
      payload: {
        signature: `0x${"ab".repeat(65)}`,
        authorization: {
          from: "0x1111111111111111111111111111111111111111",
          to: requirements.payTo,
          value: requirements.amount,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1_000) + 3_600),
          nonce: `0x${"12".repeat(32)}`,
        },
      },
    },
    paymentRequirements: requirements,
  }),
});
assert(mainnet.response.status === 503, "mainnet request was not rejected");
assert(
  mainnet.body.success === false && mainnet.body.errorReason === "unsupported",
  "mainnet rejection response is not fail-closed",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    live: true,
    ready: true,
    mainnet: false,
    measuredRoutes: readiness.body.measuredRoutes,
    openReconciliationCases: status.body.openReconciliationCases,
  }),
);
