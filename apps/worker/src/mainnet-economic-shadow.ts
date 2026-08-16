import {
  XGuardError,
  bindEconomicIntent,
  parseUnsignedInteger,
  sha256Hex,
  type EconomicIntentBinding,
} from "@xguard/core/edge";
import type { ParsedMainnetRequest } from "./mainnet-protocol.js";

export type MainnetEconomicShadowMode = "off" | "observe";

export interface MainnetEconomicShadowBinding {
  intent: EconomicIntentBinding;
  authorizationHash: string;
  amountMicroUsd: number;
  payer: string;
  payTo: string;
  resourceUrl: string;
  expiresAt: string;
}

export function parseMainnetEconomicShadowMode(
  value: string | undefined,
): MainnetEconomicShadowMode {
  return value?.trim().toLowerCase() === "observe" ? "observe" : "off";
}

export function deriveMainnetEconomicShadowBinding(
  merchantId: string,
  request: ParsedMainnetRequest,
): MainnetEconomicShadowBinding {
  if (merchantId.trim().length === 0)
    throw new XGuardError("BAD_REQUEST", "merchantId is required", 400);

  const payload = record(request.paymentPayload, "paymentPayload");
  const resource = record(payload.resource, "paymentPayload.resource");
  const resourceUrl = nonEmptyString(
    resource.url,
    "paymentPayload.resource.url",
  );

  const paymentPayloadBody = record(
    request.paymentPayload.payload,
    "paymentPayload.payload",
  );
  const authorization = record(
    paymentPayloadBody.authorization,
    "paymentPayload.payload.authorization",
  );
  const nonce = nonEmptyString(authorization.nonce, "authorization.nonce");
  const validBeforeSeconds = parseUnsignedInteger(
    authorization.validBefore,
    "authorization.validBefore",
  );
  const maximumDateSeconds = BigInt(Math.floor(8_640_000_000_000_000 / 1000));
  if (validBeforeSeconds <= 0n || validBeforeSeconds > maximumDateSeconds)
    throw new XGuardError(
      "BAD_REQUEST",
      "authorization.validBefore is outside the supported timestamp range",
      400,
    );

  const expiresAt = new Date(Number(validBeforeSeconds) * 1000).toISOString();
  const requirements = request.paymentRequirements;
  const metadataHash = sha256Hex({
    payTo: request.payTo.toLowerCase(),
    scheme: requirements.scheme,
    amount: requirements.amount,
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    extra: requirements.extra ?? null,
  });

  const intent = bindEconomicIntent({
    merchantId: merchantId.trim(),
    actorId: request.payer.toLowerCase(),
    protocol: "x402",
    resource: {
      method: "X402",
      url: resourceUrl,
      bodyHash: null,
    },
    money: {
      maxAmountMicroUsd: request.amountMicroUsd,
      currency: "USD",
      network: requirements.network,
      asset: requirements.asset,
    },
    expiresAt,
    nonce,
    metadataHash,
  });

  return {
    intent,
    authorizationHash: sha256Hex(request.raw),
    amountMicroUsd: request.amountMicroUsd,
    payer: request.payer,
    payTo: request.payTo,
    resourceUrl: intent.terms.resource.url,
    expiresAt,
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", `${field} must be an object`, 400);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new XGuardError("BAD_REQUEST", `${field} is required`, 400);
  return value.trim();
}
