import { XGuardError } from "./errors.js";
import { sha256Hex } from "./canonical.js";

export const ECONOMIC_INTENT_VERSION = 1 as const;

export const ECONOMIC_INTENT_STATES = [
  "CREATED",
  "BOUND",
  "AUTHORIZED",
  "LOCKED",
  "EXECUTING",
  "FULFILLED",
  "SETTLED",
  "FINAL",
  "FAILED",
  "AMBIGUOUS",
  "QUARANTINED",
  "EXPIRED",
] as const;

export type EconomicIntentState = (typeof ECONOMIC_INTENT_STATES)[number];

export interface EconomicResourceTerms {
  method: string;
  url: string;
  bodyHash: string | null;
}

export interface EconomicMoneyTerms {
  maxAmountMicroUsd: number;
  currency: string;
  network: string | null;
  asset: string | null;
}

export interface EconomicIntentTerms {
  version: typeof ECONOMIC_INTENT_VERSION;
  merchantId: string;
  actorId: string | null;
  protocol: string;
  resource: EconomicResourceTerms;
  money: EconomicMoneyTerms;
  expiresAt: string;
  nonce: string;
  metadataHash: string | null;
}

export interface EconomicIntentBinding {
  intentId: string;
  termsHash: string;
  terms: EconomicIntentTerms;
}

export interface EconomicAuthorizationBinding {
  intentId: string;
  termsHash: string;
  authorizationHash: string;
  authorizedAmountMicroUsd: number;
}

export interface EconomicFulfillmentBinding {
  intentId: string;
  termsHash: string;
  fulfillmentHash: string;
}

export interface EconomicSettlementBinding {
  intentId: string;
  termsHash: string;
  protocol: string;
  settlementHash: string;
  chargedAmountMicroUsd: number;
}

export interface XGuardProofPayload {
  version: typeof ECONOMIC_INTENT_VERSION;
  intentId: string;
  termsHash: string;
  authorizationHash: string;
  fulfillmentHash: string;
  settlementHash: string;
  protocol: string;
  authorizedAmountMicroUsd: number;
  chargedAmountMicroUsd: number;
  result: "EXACTLY_ONCE";
}

export interface XGuardProof extends XGuardProofPayload {
  proofHash: string;
}

const TRANSITIONS: Readonly<
  Record<EconomicIntentState, readonly EconomicIntentState[]>
> = {
  CREATED: ["BOUND", "FAILED", "QUARANTINED", "EXPIRED"],
  BOUND: ["AUTHORIZED", "FAILED", "QUARANTINED", "EXPIRED"],
  AUTHORIZED: ["LOCKED", "FAILED", "QUARANTINED", "EXPIRED"],
  LOCKED: ["EXECUTING", "FAILED", "AMBIGUOUS", "QUARANTINED"],
  EXECUTING: ["FULFILLED", "FAILED", "AMBIGUOUS", "QUARANTINED"],
  FULFILLED: ["SETTLED", "FAILED", "AMBIGUOUS", "QUARANTINED"],
  SETTLED: ["FINAL", "AMBIGUOUS", "QUARANTINED"],
  FINAL: [],
  FAILED: [],
  AMBIGUOUS: ["FINAL", "FAILED", "QUARANTINED"],
  QUARANTINED: [],
  EXPIRED: [],
};

export function assertEconomicIntentTransition(
  from: EconomicIntentState,
  to: EconomicIntentState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new XGuardError(
      "INTERNAL_ERROR",
      `Invalid economic intent transition ${from} -> ${to}`,
      500,
    );
  }
}

export function bindEconomicIntent(
  input: Omit<EconomicIntentTerms, "version"> & {
    version?: typeof ECONOMIC_INTENT_VERSION;
  },
): EconomicIntentBinding {
  const terms = normalizeEconomicIntentTerms(input);
  const termsHash = sha256Hex(terms);
  return {
    intentId: `xi_${termsHash.slice(0, 40)}`,
    termsHash,
    terms,
  };
}

export function bindEconomicAuthorization(input: {
  intent: EconomicIntentBinding;
  authorization: unknown;
  authorizedAmountMicroUsd: number;
}): EconomicAuthorizationBinding {
  assertMicroUsd(input.authorizedAmountMicroUsd, "authorizedAmountMicroUsd");
  if (
    input.authorizedAmountMicroUsd > input.intent.terms.money.maxAmountMicroUsd
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "Authorization exceeds the intent maximum amount",
      409,
    );
  }
  return {
    intentId: input.intent.intentId,
    termsHash: input.intent.termsHash,
    authorizationHash: sha256Hex(input.authorization),
    authorizedAmountMicroUsd: input.authorizedAmountMicroUsd,
  };
}

export function bindEconomicFulfillment(input: {
  intent: EconomicIntentBinding;
  fulfillment: unknown;
}): EconomicFulfillmentBinding {
  return {
    intentId: input.intent.intentId,
    termsHash: input.intent.termsHash,
    fulfillmentHash: sha256Hex(input.fulfillment),
  };
}

export function bindEconomicSettlement(input: {
  intent: EconomicIntentBinding;
  protocol: string;
  settlement: unknown;
  chargedAmountMicroUsd: number;
}): EconomicSettlementBinding {
  assertNonEmpty(input.protocol, "protocol");
  assertMicroUsd(input.chargedAmountMicroUsd, "chargedAmountMicroUsd");
  if (
    input.chargedAmountMicroUsd > input.intent.terms.money.maxAmountMicroUsd
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "Settlement exceeds the intent maximum amount",
      409,
    );
  }
  return {
    intentId: input.intent.intentId,
    termsHash: input.intent.termsHash,
    protocol: input.protocol.trim().toLowerCase(),
    settlementHash: sha256Hex(input.settlement),
    chargedAmountMicroUsd: input.chargedAmountMicroUsd,
  };
}

export function assertSameIntent(
  expected: Pick<EconomicIntentBinding, "intentId" | "termsHash">,
  actual: { intentId: string; termsHash: string },
): void {
  if (
    expected.intentId !== actual.intentId ||
    expected.termsHash !== actual.termsHash
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "Economic artifact is bound to different intent terms",
      409,
    );
  }
}

export function buildXGuardProof(input: {
  intent: EconomicIntentBinding;
  authorization: EconomicAuthorizationBinding;
  fulfillment: EconomicFulfillmentBinding;
  settlement: EconomicSettlementBinding;
}): XGuardProof {
  assertSameIntent(input.intent, input.authorization);
  assertSameIntent(input.intent, input.fulfillment);
  assertSameIntent(input.intent, input.settlement);
  if (
    input.settlement.chargedAmountMicroUsd >
    input.authorization.authorizedAmountMicroUsd
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "Settlement exceeds the authorized amount",
      409,
    );
  }

  const payload: XGuardProofPayload = {
    version: ECONOMIC_INTENT_VERSION,
    intentId: input.intent.intentId,
    termsHash: input.intent.termsHash,
    authorizationHash: input.authorization.authorizationHash,
    fulfillmentHash: input.fulfillment.fulfillmentHash,
    settlementHash: input.settlement.settlementHash,
    protocol: input.settlement.protocol,
    authorizedAmountMicroUsd: input.authorization.authorizedAmountMicroUsd,
    chargedAmountMicroUsd: input.settlement.chargedAmountMicroUsd,
    result: "EXACTLY_ONCE",
  };

  return { ...payload, proofHash: sha256Hex(payload) };
}

export function economicIntentIsExpired(
  intent: Pick<EconomicIntentBinding, "terms">,
  nowMs = Date.now(),
): boolean {
  return Date.parse(intent.terms.expiresAt) <= nowMs;
}

function normalizeEconomicIntentTerms(
  input: Omit<EconomicIntentTerms, "version"> & {
    version?: typeof ECONOMIC_INTENT_VERSION;
  },
): EconomicIntentTerms {
  assertNonEmpty(input.merchantId, "merchantId");
  assertNonEmpty(input.protocol, "protocol");
  assertNonEmpty(input.resource.method, "resource.method");
  assertNonEmpty(input.resource.url, "resource.url");
  assertNonEmpty(input.money.currency, "money.currency");
  assertNonEmpty(input.nonce, "nonce");
  assertMicroUsd(input.money.maxAmountMicroUsd, "money.maxAmountMicroUsd");

  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new XGuardError(
      "BAD_REQUEST",
      "expiresAt must be a valid timestamp",
      400,
    );
  }

  let normalizedUrl: string;
  try {
    const url = new URL(input.resource.url);
    url.hash = "";
    normalizedUrl = url.toString();
  } catch {
    throw new XGuardError("BAD_REQUEST", "resource.url must be absolute", 400);
  }

  assertHashOrNull(input.resource.bodyHash, "resource.bodyHash");
  assertHashOrNull(input.metadataHash, "metadataHash");

  return {
    version: ECONOMIC_INTENT_VERSION,
    merchantId: input.merchantId.trim(),
    actorId: normalizeOptional(input.actorId),
    protocol: input.protocol.trim().toLowerCase(),
    resource: {
      method: input.resource.method.trim().toUpperCase(),
      url: normalizedUrl,
      bodyHash: normalizeHash(input.resource.bodyHash),
    },
    money: {
      maxAmountMicroUsd: input.money.maxAmountMicroUsd,
      currency: input.money.currency.trim().toUpperCase(),
      network: normalizeOptional(input.money.network)?.toLowerCase() ?? null,
      asset: normalizeOptional(input.money.asset)?.toLowerCase() ?? null,
    },
    expiresAt: new Date(expiresAtMs).toISOString(),
    nonce: input.nonce.trim(),
    metadataHash: normalizeHash(input.metadataHash),
  };
}

function assertMicroUsd(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a non-negative safe integer`,
      400,
    );
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new XGuardError("BAD_REQUEST", `${field} is required`, 400);
  }
}

function assertHashOrNull(value: string | null, field: string): void {
  if (value !== null && !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a SHA-256 hex digest or null`,
      400,
    );
  }
}

function normalizeHash(value: string | null): string | null {
  return value === null ? null : value.toLowerCase();
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
