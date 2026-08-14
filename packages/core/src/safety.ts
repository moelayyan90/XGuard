import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { extractAndValidatePaymentIdentifier } from "@x402/extensions/payment-identifier";
import { x402ExactPermit2ProxyAddress } from "@x402/evm";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { XGuardError } from "./errors.js";
import { parseUnsignedInteger } from "./money.js";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVEN_HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})+$/;
const BYTES_32 = /^0x[0-9a-fA-F]{64}$/;
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface PaymentIdentities {
  logicalPaymentKey: string;
  replayKeys: readonly string[];
  settlementStepKey: string;
  requestFingerprint: string;
  paymentIdentifier: string | null;
  expiresAtSeconds: bigint;
  payer: string;
  portability: "PORTABLE" | "FACILITATOR_BOUND" | "UNKNOWN";
}

function normalizeRequirement(requirement: PaymentRequirements): unknown {
  const evm = requirement.network.startsWith("eip155:");
  return {
    ...requirement,
    asset: evm ? requirement.asset.toLowerCase() : requirement.asset,
    payTo: evm ? requirement.payTo.toLowerCase() : requirement.payTo,
  };
}

export function assertRequirementsMatch(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): void {
  if (payload.x402Version !== 2)
    throw new XGuardError(
      "UNSUPPORTED",
      "XGuard currently supports x402 v2 only",
      400,
    );
  if (
    canonicalJson(normalizeRequirement(payload.accepted)) !==
    canonicalJson(normalizeRequirement(requirements))
  ) {
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "paymentPayload.accepted does not match paymentRequirements",
      409,
    );
  }
  if (requirements.scheme !== "exact")
    throw new XGuardError(
      "UNSUPPORTED",
      "Only the x402 exact scheme is enabled in this release",
      400,
    );
  if (!/^eip155:(?:0|[1-9][0-9]*)$/.test(requirements.network)) {
    throw new XGuardError(
      "UNSUPPORTED",
      "Only exact EVM authorizations are enabled in this release",
      400,
    );
  }
  if (
    !EVM_ADDRESS.test(requirements.asset) ||
    !EVM_ADDRESS.test(requirements.payTo)
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "EVM asset and payTo must be valid addresses",
      400,
    );
  }
  const amount = parseUnsignedInteger(
    requirements.amount,
    "paymentRequirements.amount",
  );
  if (amount <= 0n || amount > MAX_UINT256) {
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentRequirements.amount must be a positive uint256 value",
      400,
    );
  }
  if (
    !Number.isSafeInteger(requirements.maxTimeoutSeconds) ||
    requirements.maxTimeoutSeconds <= 0 ||
    requirements.maxTimeoutSeconds > 86_400
  ) {
    throw new XGuardError(
      "BAD_REQUEST",
      "maxTimeoutSeconds must be a positive integer no greater than 86400",
      400,
    );
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", `${field} must be an object`, 400);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new XGuardError("BAD_REQUEST", `${field} must be a string`, 400);
  return value;
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value))
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} is not a valid EVM address`,
      400,
    );
  return value.toLowerCase();
}

function requireEip3009Nonce(value: unknown, field: string): string {
  if (typeof value !== "string" || !BYTES_32.test(value))
    throw new XGuardError("BAD_REQUEST", `${field} must be bytes32`, 400);
  return value.toLowerCase();
}

function requireSignature(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    !EVEN_HEX_BYTES.test(value) ||
    value.length > 8_194
  )
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be bounded even-length hex bytes`,
      400,
    );
}

function assertTransferMethod(
  requirements: PaymentRequirements,
  expected: "eip3009" | "permit2",
): void {
  const method = requirements.extra?.assetTransferMethod;
  if (
    (expected === "eip3009" && method !== undefined && method !== expected) ||
    (expected === "permit2" && method !== expected)
  )
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      `Payload mechanism requires explicit assetTransferMethod=${expected}`,
      409,
    );
  const flow = requirements.extra?.paymentFlow;
  if (flow !== undefined && flow !== "authorization")
    throw new XGuardError(
      "UNSUPPORTED",
      `Unsupported exact EVM paymentFlow=${String(flow)}`,
      400,
    );
}

function requireTimestamp(value: unknown, field: string): bigint {
  const parsed = parseUnsignedInteger(requireString(value, field), field);
  if (parsed > MAX_SQLITE_INTEGER)
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} exceeds XGuard's durable timestamp range`,
      400,
    );
  return parsed;
}

export function derivePaymentIdentities(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): PaymentIdentities {
  assertRequirementsMatch(payload, requirements);
  const exactPayload = requireRecord(payload.payload, "payload.payload");
  const hasEip3009 = "authorization" in exactPayload;
  const hasPermit2 = "permit2Authorization" in exactPayload;
  if (hasEip3009 === hasPermit2)
    throw new XGuardError(
      "BAD_REQUEST",
      "Payload must contain exactly one supported authorization mechanism",
      400,
    );
  let replayDomain: unknown;
  let expiresAtSeconds: bigint;
  let payer: string;

  if (hasEip3009) {
    assertTransferMethod(requirements, "eip3009");
    requireSignature(exactPayload.signature, "payload.signature");
    const authorization = requireRecord(
      exactPayload.authorization,
      "payload.authorization",
    );
    const from = requireAddress(
      authorization.from,
      "payload.authorization.from",
    );
    payer = from;
    const to = requireAddress(authorization.to, "payload.authorization.to");
    if (to !== requirements.payTo.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Authorization recipient differs from payTo",
        409,
      );
    if (
      parseUnsignedInteger(
        requireString(authorization.value, "payload.authorization.value"),
        "payload.authorization.value",
      ) !==
      parseUnsignedInteger(requirements.amount, "paymentRequirements.amount")
    ) {
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Authorization amount differs from the exact requirement",
        409,
      );
    }
    const validAfter = requireTimestamp(
      authorization.validAfter,
      "payload.authorization.validAfter",
    );
    expiresAtSeconds = requireTimestamp(
      authorization.validBefore,
      "payload.authorization.validBefore",
    );
    if (validAfter > nowSeconds + 30n)
      throw new XGuardError(
        "BAD_REQUEST",
        "Authorization is not valid yet",
        400,
      );
    if (expiresAtSeconds <= nowSeconds)
      throw new XGuardError("BAD_REQUEST", "Authorization has expired", 400);
    replayDomain = {
      mechanism: "eip3009",
      network: requirements.network,
      asset: requirements.asset.toLowerCase(),
      from,
      nonce: requireEip3009Nonce(
        authorization.nonce,
        "payload.authorization.nonce",
      ),
    };
  } else {
    assertTransferMethod(requirements, "permit2");
    requireSignature(exactPayload.signature, "payload.signature");
    const authorization = requireRecord(
      exactPayload.permit2Authorization,
      "payload.permit2Authorization",
    );
    const witness = requireRecord(
      authorization.witness,
      "payload.permit2Authorization.witness",
    );
    const permitted = requireRecord(
      authorization.permitted,
      "payload.permit2Authorization.permitted",
    );
    const from = requireAddress(
      authorization.from,
      "payload.permit2Authorization.from",
    );
    payer = from;
    const spender = requireAddress(
      authorization.spender,
      "payload.permit2Authorization.spender",
    );
    if (spender !== x402ExactPermit2ProxyAddress.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Permit2 spender is not the official exact-scheme proxy",
        409,
      );
    const to = requireAddress(
      witness.to,
      "payload.permit2Authorization.witness.to",
    );
    const token = requireAddress(
      permitted.token,
      "payload.permit2Authorization.permitted.token",
    );
    if (to !== requirements.payTo.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Permit2 recipient differs from payTo",
        409,
      );
    if (token !== requirements.asset.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Permit2 token differs from the required asset",
        409,
      );
    if (
      parseUnsignedInteger(
        requireString(
          permitted.amount,
          "payload.permit2Authorization.permitted.amount",
        ),
        "payload.permit2Authorization.permitted.amount",
      ) !==
      parseUnsignedInteger(requirements.amount, "paymentRequirements.amount")
    ) {
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Permit2 amount differs from the exact requirement",
        409,
      );
    }
    const validAfter = requireTimestamp(
      witness.validAfter,
      "payload.permit2Authorization.witness.validAfter",
    );
    expiresAtSeconds = requireTimestamp(
      authorization.deadline,
      "payload.permit2Authorization.deadline",
    );
    if (validAfter > nowSeconds + 30n)
      throw new XGuardError(
        "BAD_REQUEST",
        "Permit2 authorization is not valid yet",
        400,
      );
    if (expiresAtSeconds <= nowSeconds)
      throw new XGuardError(
        "BAD_REQUEST",
        "Permit2 authorization has expired",
        400,
      );
    const permit2Nonce = parseUnsignedInteger(
      requireString(authorization.nonce, "payload.permit2Authorization.nonce"),
      "payload.permit2Authorization.nonce",
    );
    if (permit2Nonce > MAX_UINT256)
      throw new XGuardError(
        "BAD_REQUEST",
        "payload.permit2Authorization.nonce exceeds uint256",
        400,
      );
    replayDomain = {
      mechanism: "permit2",
      network: requirements.network,
      from,
      nonce: permit2Nonce.toString(),
    };
  }

  const logicalPaymentKey = sha256Hex(replayDomain);
  const requestFingerprint = sha256Hex({
    paymentPayload: payloadForFingerprint(payload),
    paymentRequirements: normalizeRequirement(requirements),
  });
  const identifier = extractAndValidatePaymentIdentifier(payload);
  if (!identifier.validation.valid) {
    throw new XGuardError(
      "BAD_REQUEST",
      `Invalid payment identifier: ${identifier.validation.errors?.join("; ") ?? "validation failed"}`,
      400,
    );
  }
  const paymentIdentifier = identifier.id;
  return {
    logicalPaymentKey,
    replayKeys: [logicalPaymentKey],
    settlementStepKey: sha256Hex({
      logicalPaymentKey,
      phase: "authorization-charge",
    }),
    requestFingerprint,
    paymentIdentifier,
    expiresAtSeconds,
    payer,
    portability: "PORTABLE",
  };
}

function payloadForFingerprint(payload: PaymentPayload): PaymentPayload {
  const extensions =
    payload.extensions === undefined
      ? undefined
      : structuredClone(payload.extensions);
  const paymentIdentifier = extensions?.["payment-identifier"];
  if (
    typeof paymentIdentifier === "object" &&
    paymentIdentifier !== null &&
    !Array.isArray(paymentIdentifier)
  ) {
    const info = (paymentIdentifier as Record<string, unknown>).info;
    if (typeof info === "object" && info !== null && !Array.isArray(info))
      delete (info as Record<string, unknown>).id;
  }
  return { ...payload, ...(extensions === undefined ? {} : { extensions }) };
}

const TESTNETS = new Set([
  "eip155:84532",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
]);

export function isKnownTestnet(network: string): boolean {
  return TESTNETS.has(network);
}
