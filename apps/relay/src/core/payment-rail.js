/**
 * Runtime-neutral payment invariants used by the Cloudflare adapter.
 * x402 is the active adapter, not the execution core's identity.
 */

export const PAYMENT_ENVIRONMENTS = Object.freeze({
  PRODUCTION: "production",
  TEST: "test",
});

export const PAYMENT_STATES = Object.freeze([
  "pending",
  "verified",
  "settled",
  "succeeded",
  "failed",
  "ambiguous",
  "refunded",
  "credited",
]);

export const PAYMENT_TRANSITIONS = Object.freeze({
  pending: new Set(["verified", "failed", "ambiguous"]),
  verified: new Set(["settled", "failed", "ambiguous"]),
  ambiguous: new Set(["settled", "failed", "ambiguous"]),
  settled: new Set(["succeeded", "credited"]),
  credited: new Set(["succeeded", "credited"]),
  succeeded: new Set(["succeeded"]),
  failed: new Set(["failed"]),
  refunded: new Set(["refunded"]),
});

const PRODUCTION_NETWORKS = new Set(["eip155:8453"]);
const TEST_NETWORKS = new Set(["eip155:84532"]);

export function normalizePaymentEnvironment(value, fallback = PAYMENT_ENVIRONMENTS.PRODUCTION) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["production", "prod", "mainnet", "live"].includes(normalized)) return PAYMENT_ENVIRONMENTS.PRODUCTION;
  if (["test", "testnet", "sandbox", "staging", "development", "dev"].includes(normalized)) return PAYMENT_ENVIRONMENTS.TEST;
  return fallback;
}

export function networkEnvironment(network) {
  const value = String(network || "");
  if (PRODUCTION_NETWORKS.has(value)) return PAYMENT_ENVIRONMENTS.PRODUCTION;
  if (TEST_NETWORKS.has(value)) return PAYMENT_ENVIRONMENTS.TEST;
  return null;
}

export function paymentStateCanTransition(from, to) {
  return PAYMENT_STATES.includes(to) && Boolean(PAYMENT_TRANSITIONS[from]?.has(to));
}

export function isRealRevenueSettlement(record, settlement = {}) {
  return record?.environment === PAYMENT_ENVIRONMENTS.PRODUCTION
    && record?.traffic_class === "external"
    && networkEnvironment(settlement.network || record?.network) === PAYMENT_ENVIRONMENTS.PRODUCTION
    && settlement?.success === true
    && /^0x[0-9a-fA-F]{64}$/.test(String(settlement.transaction || ""));
}

export function validatePaymentRailConfig({ environment, network, asset, payTo, amount, facilitator }) {
  const suppliedEnvironment = String(environment ?? "").trim().toLowerCase();
  const environmentConfigured = ["production", "prod", "mainnet", "live", "test", "testnet", "sandbox", "staging", "development", "dev"].includes(suppliedEnvironment);
  const normalizedEnvironment = normalizePaymentEnvironment(environment);
  const networkClass = networkEnvironment(network);
  const validRecipient = /^0x[0-9a-fA-F]{40}$/.test(String(payTo || "")) && !/^0x0{40}$/i.test(String(payTo || ""));
  const validAsset = /^0x[0-9a-fA-F]{40}$/.test(String(asset || "")) && !/^0x0{40}$/i.test(String(asset || ""));
  const validAmount = /^[1-9][0-9]{0,8}$/.test(String(amount || ""));
  const validFacilitator = /^https:\/\//.test(String(facilitator || ""));
  const environmentMatchesNetwork = networkClass === normalizedEnvironment;
  return {
    configured: Boolean(environmentConfigured && networkClass && environmentMatchesNetwork && validRecipient && validAsset && validAmount && validFacilitator),
    environment: normalizedEnvironment,
    environment_configured: environmentConfigured,
    network_class: networkClass,
    environment_matches_network: environmentMatchesNetwork,
    recipient_configured: validRecipient,
    amount_configured: validAmount,
    facilitator_configured: validFacilitator,
    asset_configured: validAsset,
  };
}
