const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ??
    "https://xguard-mainnet.maqamapp.workers.dev",
);

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    // Some protocol errors can be non-JSON; callers assert only when needed.
  }
  return { response, body };
}

function legacyEnvelope(network = "base") {
  return {
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network,
      payload: {
        signature: `0x${"22".repeat(65)}`,
        authorization: {
          from: PAYER,
          to: PAY_TO,
          value: "10000",
          validAfter: "0",
          validBefore: "1999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
      },
    },
    paymentRequirements: {
      scheme: "exact",
      network,
      maxAmountRequired: "10000",
      resource: "https://example.com/xguard-compatibility-smoke",
      description: "Non-billable XGuard compatibility smoke request",
      mimeType: "application/json",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      asset: USDC,
      extra: { name: "USD Coin", version: "2" },
    },
  };
}

const supported = await request("/supported");
assert(supported.response.status === 200, "compatibility /supported failed");
assert(
  Array.isArray(supported.body?.kinds) &&
    supported.body.kinds.some(
      (kind) =>
        kind?.x402Version === 2 &&
        kind?.scheme === "exact" &&
        kind?.network === "eip155:8453",
    ),
  "canonical x402 v2 Base capability missing",
);
assert(
  supported.body.kinds.some(
    (kind) =>
      kind?.x402Version === 1 &&
      kind?.scheme === "exact" &&
      kind?.network === "base",
  ),
  "bridged x402 v1 Base capability missing",
);
assert(
  supported.body?.compatibility?.mode === "normalize-v1-to-v2",
  "compatibility bridge metadata missing",
);

const unauthenticatedLegacy = await request("/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(legacyEnvelope()),
});
assert(
  unauthenticatedLegacy.response.status === 401,
  "legacy V1 request did not reach the existing merchant authentication boundary",
);
assert(
  unauthenticatedLegacy.response.headers.get("x-xguard-compatibility") ===
    "x402-v1-to-v2",
  "legacy V1 request was not marked as bridged",
);
assert(
  unauthenticatedLegacy.response.headers.get("x-xguard-canonical-network") ===
    "eip155:8453",
  "canonical compatibility network header missing",
);

const wrongNetwork = await request("/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(legacyEnvelope("base-sepolia")),
});
assert(
  wrongNetwork.response.status === 400,
  "unsupported legacy network was not rejected fail-closed",
);
assert(
  wrongNetwork.body?.error === "x402_compatibility_rejected",
  "unsupported legacy network returned the wrong error boundary",
);
assert(
  wrongNetwork.response.headers.get("x-xguard-compatibility") === "rejected",
  "rejected compatibility request is not observable",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    x402CompatibilityBridge: true,
    nativeV2: "exact@eip155:8453",
    bridgedV1: "exact@base",
    liveTranslationReachedAuthBoundary: true,
    unsupportedLegacyNetworkFailsClosed: true,
    billableExecutionPerformed: false,
  }),
);
