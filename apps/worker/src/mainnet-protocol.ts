import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
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
} from "@xguard/core/edge";

export const BASE_MAINNET = "eip155:8453";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const XPAY_URL = "https://facilitator.xpay.sh";
/** @deprecated Legacy source-level alias retained while persisted historical identifiers are migrated separately. */
export const PAYAI_URL = XPAY_URL;
export const MAX_HTTP_BODY_BYTES = 64 * 1024;
const XPAY_SUPPORTED_TIMEOUT_MS = 10_000;
const XPAY_HEALTH_TIMEOUT_MS = 5_000;

export interface MainnetProtocolEnv {
  XPAY_API_KEY_ID?: string;
  XPAY_API_KEY_SECRET?: string;
  /** @deprecated xpay's current public facilitator does not require these legacy fields. */
  PAYAI_API_KEY_ID?: string;
  /** @deprecated xpay's current public facilitator does not require these legacy fields. */
  PAYAI_API_KEY_SECRET?: string;
}

export interface ParsedMainnetRequest {
  raw: Record<string, unknown>;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  amountMicroUsd: number;
  payer: string;
  payTo: string;
}

export async function parseMainnetFacilitatorRequest(
  request: Request,
): Promise<ParsedMainnetRequest> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  const raw = asRecord(
    parseJsonStrict(
      await readHttpBodyTextCapped(
        request,
        MAX_HTTP_BODY_BYTES,
        "Facilitator request body",
      ),
    ),
  );
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
  enforceBaseMainnetUsdc(paymentPayload, paymentRequirements);

  const authorization = asRecord(
    asRecord(paymentPayload.payload).authorization,
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
  };
}

export function enforceBaseMainnetUsdc(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): void {
  if (requirements.network !== BASE_MAINNET)
    throw new XGuardError(
      "UNSUPPORTED",
      "XGuard mainnet currently supports Base mainnet only",
      400,
    );
  if (requirements.scheme !== "exact")
    throw new XGuardError(
      "BAD_REQUEST",
      "XGuard mainnet supports the exact scheme only",
      400,
    );
  if (
    typeof requirements.asset !== "string" ||
    requirements.asset.toLowerCase() !== BASE_USDC.toLowerCase()
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "XGuard mainnet currently supports native Base USDC only",
      400,
    );
  const extra = requirements.extra ?? {};
  if (
    (extra.assetTransferMethod !== undefined &&
      extra.assetTransferMethod !== "eip3009") ||
    (extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization")
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "XGuard mainnet requires exact EIP-3009 authorization payments",
      400,
    );

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

export async function xPayVerify(
  _env: MainnetProtocolEnv,
  body: Record<string, unknown>,
  expectedPayer: string,
): Promise<VerifyResponse> {
  const response = await xPayRequest("verify", body, 8_000);
  const record = asRecord(response);
  if (typeof record.isValid !== "boolean")
    throw new Error("malformed_verify_response");
  if (record.payer !== undefined) {
    const payer = evmAddress(record.payer, "verify.payer");
    if (payer.toLowerCase() !== expectedPayer.toLowerCase())
      throw new Error("verify_payer_conflict");
  }
  return record as unknown as VerifyResponse;
}

export async function xPaySettle(
  _env: MainnetProtocolEnv,
  body: Record<string, unknown>,
  requirements: PaymentRequirements,
  expectedPayer: string,
): Promise<SettleResponse> {
  const response = await xPayRequest("settle", body, 20_000);
  const record = asRecord(response);
  if (
    typeof record.success !== "boolean" ||
    typeof record.transaction !== "string" ||
    record.network !== requirements.network
  )
    throw new Error("malformed_settle_response");
  if (record.success && !/^0x[0-9a-fA-F]{64}$/.test(record.transaction))
    throw new Error("malformed_evm_transaction_reference");
  if (!record.success && record.transaction !== "")
    throw new Error("failed_settlement_with_transaction_reference");
  if (
    record.amount !== undefined &&
    (typeof record.amount !== "string" ||
      parseUnsignedInteger(record.amount, "settlement.amount") !==
        parseUnsignedInteger(requirements.amount, "paymentRequirements.amount"))
  )
    throw new Error("settlement_amount_conflict");
  if (record.payer !== undefined) {
    const payer = evmAddress(record.payer, "settlement.payer");
    if (payer.toLowerCase() !== expectedPayer.toLowerCase())
      throw new Error("settlement_payer_conflict");
  }
  return record as unknown as SettleResponse;
}

export async function fetchXPaySupported(
  _env: MainnetProtocolEnv,
): Promise<SupportedResponse> {
  try {
    return normalizeXPaySupportedResponse(
      await xPayGetJson("supported", XPAY_SUPPORTED_TIMEOUT_MS),
    );
  } catch (supportedError) {
    console.warn(
      JSON.stringify({
        event: "xpay_supported_probe_failed",
        code: upstreamErrorCode(supportedError),
      }),
    );

    const health = normalizeXPayHealthResponse(
      await xPayGetJson("health", XPAY_HEALTH_TIMEOUT_MS),
    );
    if (health !== null) return health;
    throw supportedError;
  }
}

export function normalizeXPaySupportedResponse(
  value: unknown,
): SupportedResponse {
  const parsed = upstreamRecord(value, "upstream_supported_malformed");

  if (Array.isArray(parsed.kinds)) {
    if (!parsed.kinds.some(isBaseMainnetExactV2Kind))
      throw new Error("upstream_base_mainnet_not_supported");
    if (!Array.isArray(parsed.extensions)) parsed.extensions = [];
    if (parsed.signers === undefined) parsed.signers = {};
    return parsed as unknown as SupportedResponse;
  }

  const networks = extractV2Networks(
    parsed.supportedNetworks,
    parsed.supportedVersions,
  );
  if (!networks.includes(BASE_MAINNET))
    throw new Error("upstream_base_mainnet_not_supported");
  return canonicalSupported(networks);
}

export function normalizeXPayHealthResponse(
  value: unknown,
): SupportedResponse | null {
  const parsed = upstreamRecord(value, "upstream_health_malformed");
  if (parsed.status !== "ok") throw new Error("upstream_health_unhealthy");

  const networks = extractV2Networks(
    parsed.supportedNetworks,
    parsed.supportedVersions,
  );
  if (networks.length === 0) return null;
  if (!networks.includes(BASE_MAINNET))
    throw new Error("upstream_base_mainnet_not_supported");
  return canonicalSupported(networks);
}

/** @deprecated Use xPayVerify; retained to avoid changing persisted production call sites in the same release. */
export const payAIVerify = xPayVerify;
/** @deprecated Use xPaySettle; retained to avoid changing persisted production call sites in the same release. */
export const payAISettle = xPaySettle;
/** @deprecated Use fetchXPaySupported; retained for source compatibility. */
export const fetchPayAISupported = fetchXPaySupported;

async function xPayGetJson(
  path: "supported" | "health",
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${XPAY_URL}/${path}`, {
        headers: { "User-Agent": "XGuard/0.1.0" },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw new Error(`upstream_${path}_timeout`);
      throw error;
    }
    if (!response.ok) throw new Error(`upstream_${path}_http_${response.status}`);
    return parseJsonStrict(
      await readHttpBodyTextCapped(
        response,
        MAX_HTTP_BODY_BYTES,
        `xpay ${path} response`,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function xPayRequest(
  operation: "verify" | "settle",
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${XPAY_URL}/${operation}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "XGuard/0.1.0",
          "X-XGuard-Mode": "mainnet",
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw new Error(`upstream_${operation}_timeout`);
      throw error;
    }
    if (!response.ok)
      throw new Error(`upstream_${operation}_http_${response.status}`);
    return parseJsonStrict(
      await readHttpBodyTextCapped(
        response,
        MAX_HTTP_BODY_BYTES,
        `xpay ${operation} response`,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

function canonicalSupported(networks: string[]): SupportedResponse {
  return {
    kinds: networks.map((network) => ({
      x402Version: 2,
      scheme: "exact",
      network,
    })),
    extensions: [],
    signers: {},
  } as SupportedResponse;
}

function extractV2Networks(
  rawNetworks: unknown,
  rawVersions: unknown,
): string[] {
  if (!Array.isArray(rawNetworks)) return [];

  const globalV2 =
    Array.isArray(rawVersions) &&
    rawVersions.some(
      (version) => version === 2 || version === "2" || version === "v2",
    );
  const networks = new Set<string>();

  for (const rawNetwork of rawNetworks) {
    if (typeof rawNetwork === "string") {
      if (globalV2) networks.add(rawNetwork);
      continue;
    }
    const network = recordOrNull(rawNetwork);
    if (network === null) continue;
    const networkId =
      typeof network.networkId === "string"
        ? network.networkId
        : typeof network.network === "string"
          ? network.network
          : null;
    const version = network.version ?? network.x402Version;
    if (
      networkId !== null &&
      (version === 2 || version === "2" || version === "v2")
    )
      networks.add(networkId);
  }

  return [...networks];
}

function isBaseMainnetExactV2Kind(value: unknown): boolean {
  const kind = recordOrNull(value);
  return (
    kind !== null &&
    kind.x402Version === 2 &&
    kind.scheme === "exact" &&
    kind.network === BASE_MAINNET
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function upstreamErrorCode(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return "unknown_upstream_error";
}

function upstreamRecord(
  value: unknown,
  errorCode: string,
): Record<string, unknown> {
  const record = recordOrNull(value);
  if (record === null) throw new Error(errorCode);
  return record;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", "Expected a JSON object", 400);
  return value as Record<string, unknown>;
}
