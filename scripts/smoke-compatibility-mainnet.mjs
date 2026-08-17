import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = new URL(
  process.env.XGUARD_MAINNET_URL ?? "https://xguardgate.com",
);

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SMOKE_TOKEN = `${Date.now()}-${randomUUID()}`;
const COMPATIBILITY_PROPAGATION_ATTEMPTS = 18;
const COMPATIBILITY_PROPAGATION_INTERVAL_MS = 5_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      "Cache-Control": "no-cache",
      "X-XGuard-Monitor": "github-actions-compatibility-smoke",
      ...(init.headers ?? {}),
    },
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

async function waitForCompatibilityMetadata() {
  let last = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    last = await request(
      `/supported?compatSmoke=${encodeURIComponent(SMOKE_TOKEN)}&attempt=${attempt}`,
    );
    const kinds = Array.isArray(last.body?.kinds) ? last.body.kinds : [];
    const hasV2 = kinds.some(
      (kind) =>
        kind?.x402Version === 2 &&
        kind?.scheme === "exact" &&
        kind?.network === "eip155:8453",
    );
    const hasV1 = kinds.some(
      (kind) =>
        kind?.x402Version === 1 &&
        kind?.scheme === "exact" &&
        kind?.network === "base",
    );
    if (
      last.response.status === 200 &&
      hasV2 &&
      hasV1 &&
      last.body?.compatibility?.mode === "normalize-v1-to-v2"
    )
      return last;
    if (attempt < 8) await delay(2_000);
  }
  return last;
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

async function waitForCompatibilitySurface() {
  let last = { unauthenticatedLegacy: null, wrongNetwork: null };

  for (
    let attempt = 1;
    attempt <= COMPATIBILITY_PROPAGATION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const unauthenticatedLegacy = await request(
        `/verify?compatSmoke=${encodeURIComponent(SMOKE_TOKEN)}&surface=legacy&attempt=${attempt}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(legacyEnvelope()),
        },
      );
      const wrongNetwork = await request(
        `/verify?compatSmoke=${encodeURIComponent(SMOKE_TOKEN)}&surface=reject&attempt=${attempt}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(legacyEnvelope("base-sepolia")),
        },
      );
      last = { unauthenticatedLegacy, wrongNetwork };

      const bridgeReady =
        unauthenticatedLegacy.response.status === 401 &&
        unauthenticatedLegacy.response.headers.get("x-xguard-compatibility") ===
          "x402-v1-to-v2" &&
        unauthenticatedLegacy.response.headers.get(
          "x-xguard-canonical-network",
        ) === "eip155:8453";
      const rejectionReady =
        wrongNetwork.response.status === 400 &&
        wrongNetwork.body?.error === "x402_compatibility_rejected" &&
        wrongNetwork.response.headers.get("x-xguard-compatibility") ===
          "rejected";

      if (bridgeReady && rejectionReady) return last;
    } catch (error) {
      console.warn(
        JSON.stringify({
          compatibilityPropagationPending: true,
          attempt,
          code: error instanceof Error ? error.name : "unknown_error",
        }),
      );
    }

    if (attempt < COMPATIBILITY_PROPAGATION_ATTEMPTS)
      await delay(COMPATIBILITY_PROPAGATION_INTERVAL_MS);
  }

  return last;
}

const supported = await waitForCompatibilityMetadata();
assert(supported !== null, "compatibility /supported did not respond");
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
  "bridged x402 v1 Base capability missing after propagation window",
);
assert(
  supported.body?.compatibility?.mode === "normalize-v1-to-v2",
  "compatibility bridge metadata missing after propagation window",
);

const { unauthenticatedLegacy, wrongNetwork } =
  await waitForCompatibilitySurface();
assert(
  unauthenticatedLegacy !== null,
  "legacy V1 compatibility surface did not respond after propagation window",
);
assert(
  unauthenticatedLegacy.response.status === 401,
  "legacy V1 request did not reach the existing merchant authentication boundary after propagation window",
);
assert(
  unauthenticatedLegacy.response.headers.get("x-xguard-compatibility") ===
    "x402-v1-to-v2",
  "legacy V1 request was not marked as bridged after propagation window",
);
assert(
  unauthenticatedLegacy.response.headers.get("x-xguard-canonical-network") ===
    "eip155:8453",
  "canonical compatibility network header missing after propagation window",
);

assert(
  wrongNetwork !== null,
  "unsupported legacy network surface did not respond after propagation window",
);
assert(
  wrongNetwork.response.status === 400,
  "unsupported legacy network was not rejected fail-closed after propagation window",
);
assert(
  wrongNetwork.body?.error === "x402_compatibility_rejected",
  "unsupported legacy network returned the wrong error boundary after propagation window",
);
assert(
  wrongNetwork.response.headers.get("x-xguard-compatibility") === "rejected",
  "rejected compatibility request is not observable after propagation window",
);

console.log(
  JSON.stringify({
    url: baseUrl.origin,
    x402CompatibilityBridge: true,
    nativeV2: "exact@eip155:8453",
    bridgedV1: "exact@base",
    liveTranslationReachedAuthBoundary: true,
    unsupportedLegacyNetworkFailsClosed: true,
    propagationSafe: true,
    billableExecutionPerformed: false,
  }),
);
