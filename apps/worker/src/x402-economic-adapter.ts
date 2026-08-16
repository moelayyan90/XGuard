import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  parsePaymentPayload,
  parsePaymentRequirements,
} from "@x402/core/schemas";
import {
  XGuardError,
  parseJsonStrict,
  parseUnsignedInteger,
  readHttpBodyTextCapped,
  sha256Hex,
  type EconomicIntentTerms,
} from "@xguard/core/edge";

const MAX_X402_RESPONSE_BYTES = 64 * 1024;
const VERIFY_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 25_000;

export interface ParsedEconomicX402Envelope {
  raw: Record<string, unknown>;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  amountMicroUsd: number;
  payer: string;
  payTo: string;
  authorizationHash: string;
}

export function parseEconomicX402Envelope(
  rawInput: Record<string, unknown>,
  intent: EconomicIntentTerms,
): ParsedEconomicX402Envelope {
  if (intent.protocol !== "x402")
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "Economic intent is not bound to x402",
      409,
    );

  const raw = plainJsonRecord(rawInput);
  const allowed = new Set([
    "x402Version",
    "paymentPayload",
    "paymentRequirements",
  ]);
  if (
    Object.keys(raw).some((key) => !allowed.has(key)) ||
    raw.x402Version !== 2 ||
    !("paymentPayload" in raw) ||
    !("paymentRequirements" in raw)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Request must use the exact x402 v2 facilitator envelope",
      400,
    );

  const payload = parsePaymentPayload(raw.paymentPayload);
  const requirements = parsePaymentRequirements(raw.paymentRequirements);
  if (
    !payload.success ||
    payload.data.x402Version !== 2 ||
    !("accepted" in payload.data)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentPayload does not match the official x402 v2 schema",
      400,
    );
  if (!requirements.success || !("amount" in requirements.data))
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentRequirements does not match the official x402 v2 schema",
      400,
    );

  const paymentPayload = payload.data as PaymentPayload;
  const paymentRequirements = requirements.data as PaymentRequirements;
  assertAcceptedMatchesRequirements(paymentPayload, paymentRequirements);
  assertIntentMatchesX402(intent, paymentPayload, paymentRequirements);

  const authorization = asRecord(
    asRecord(paymentPayload.payload).authorization,
    "paymentPayload.payload.authorization",
  );
  const payer = evmAddress(authorization.from, "authorization.from");
  const payTo = evmAddress(
    paymentRequirements.payTo,
    "paymentRequirements.payTo",
  );
  const amount = parseUnsignedInteger(
    paymentRequirements.amount,
    "paymentRequirements.amount",
  );
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentRequirements.amount is outside the supported range",
      400,
    );

  return {
    raw,
    paymentPayload,
    paymentRequirements,
    amountMicroUsd: Number(amount),
    payer,
    payTo,
    authorizationHash: sha256Hex(raw),
  };
}

export async function verifyEconomicX402(
  facilitatorBaseUrl: string,
  envelope: ParsedEconomicX402Envelope,
): Promise<VerifyResponse> {
  const response = await facilitatorRequest(
    facilitatorBaseUrl,
    "verify",
    envelope.raw,
    VERIFY_TIMEOUT_MS,
  );
  if (typeof response.isValid !== "boolean")
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      "x402 verifier returned a malformed response",
      503,
      true,
    );
  if (response.payer !== undefined) {
    const payer = evmAddress(response.payer, "verify.payer");
    if (payer.toLowerCase() !== envelope.payer.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "x402 verifier payer does not match the bound authorization",
        409,
      );
  }
  return response as unknown as VerifyResponse;
}

export async function settleEconomicX402(
  facilitatorBaseUrl: string,
  envelope: ParsedEconomicX402Envelope,
): Promise<SettleResponse> {
  const response = await facilitatorRequest(
    facilitatorBaseUrl,
    "settle",
    envelope.raw,
    SETTLE_TIMEOUT_MS,
  );
  if (
    typeof response.success !== "boolean" ||
    typeof response.transaction !== "string" ||
    response.network !== envelope.paymentRequirements.network
  )
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      "x402 settlement returned a malformed response",
      503,
      true,
    );
  if (response.payer !== undefined) {
    const payer = evmAddress(response.payer, "settlement.payer");
    if (payer.toLowerCase() !== envelope.payer.toLowerCase())
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "x402 settlement payer does not match the bound authorization",
        409,
      );
  }
  if (response.amount !== undefined) {
    if (
      typeof response.amount !== "string" ||
      parseUnsignedInteger(response.amount, "settlement.amount") !==
        BigInt(envelope.amountMicroUsd)
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "x402 settlement amount does not match the bound authorization",
        409,
      );
  }
  return response as unknown as SettleResponse;
}

function assertAcceptedMatchesRequirements(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): void {
  if (!("accepted" in payload))
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentPayload.accepted is required",
      400,
    );
  const accepted = payload.accepted;
  if (
    accepted.network !== requirements.network ||
    accepted.scheme !== requirements.scheme ||
    accepted.asset.toLowerCase() !== requirements.asset.toLowerCase() ||
    accepted.amount !== requirements.amount ||
    accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()
  )
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "paymentPayload.accepted does not match paymentRequirements",
      409,
    );
}

function assertIntentMatchesX402(
  intent: EconomicIntentTerms,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): void {
  if (intent.money.network !== null && intent.money.network !== requirements.network)
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "x402 network does not match the Economic Intent",
      409,
    );
  if (
    intent.money.asset !== null &&
    intent.money.asset.toLowerCase() !== requirements.asset.toLowerCase()
  )
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "x402 asset does not match the Economic Intent",
      409,
    );
  const amount = parseUnsignedInteger(
    requirements.amount,
    "paymentRequirements.amount",
  );
  if (amount > BigInt(intent.money.maxAmountMicroUsd))
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "x402 amount exceeds the Economic Intent ceiling",
      409,
    );
  const resourceUrl = new URL(payload.resource.url);
  resourceUrl.hash = "";
  if (resourceUrl.toString() !== intent.resource.url)
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "x402 resource URL does not match the Economic Intent",
      409,
    );
}

async function facilitatorRequest(
  facilitatorBaseUrl: string,
  operation: "verify" | "settle",
  raw: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const base = new URL(facilitatorBaseUrl);
  if (base.protocol !== "https:")
    throw new XGuardError(
      "INTERNAL_ERROR",
      "Configured x402 facilitator must use HTTPS",
      500,
    );
  const response = await fetch(new URL(`/${operation}`, base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "XGuard-Economic-Firewall/0.1.0",
    },
    body: JSON.stringify(raw),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = asRecord(
    parseJsonStrict(
      await readHttpBodyTextCapped(
        response,
        MAX_X402_RESPONSE_BYTES,
        `x402 ${operation} response`,
      ),
    ),
    `x402 ${operation} response`,
  );
  if (!response.ok)
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      `x402 ${operation} returned HTTP ${response.status}`,
      503,
      true,
    );
  return plainJsonRecord(body);
}

function plainJsonRecord(value: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return asRecord(normalized, "x402 envelope");
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", `${field} must be an object`, 400);
  return value as Record<string, unknown>;
}

function evmAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be an EVM address`,
      400,
    );
  return value;
}
