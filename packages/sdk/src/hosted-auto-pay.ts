import type {
  XGuardAutomatedPaymentDecision,
  XGuardAutomatedPaymentIntent,
} from "./auto-pay.js";

export interface XGuardHostedAssetDefinition {
  /** Exact x402 network identifier, for example `eip155:8453`. */
  network: string;
  /** Exact x402 asset identifier returned in payment requirements. */
  asset: string;
  /** Human currency label accepted by XGuard Payment Decision, for example `USDC`. */
  currency: string;
  /** Number of atomic decimals used by the asset. */
  decimals: number;
}

export interface XGuardHostedPaymentReceipt {
  decisionId?: string;
  requestId?: string;
  decision?: "ALLOW" | "REVIEW" | "BLOCK" | string;
  riskScore?: number;
  reasonCodes?: string[];
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface XGuardHostedPaymentAuthorizerOptions {
  /** XGuard origin. Defaults to production `https://xguardgate.com`. */
  gateway?: string;
  /** Buyer Pass or merchant access key accepted by XGuard Payment Decision. */
  accessToken: string;
  /** Asset metadata needed to convert x402 atomic amounts into exact decimal amounts. */
  assets: XGuardHostedAssetDefinition[];
  /** Fail closed after this many milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /** Optional fetch implementation for runtimes that do not use global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Optional provider label stored in the decision record. Defaults to `x402`. */
  provider?: string;
  /** REVIEW remains blocked unless this is deliberately enabled. */
  allowReview?: boolean;
  /** Optional logical payment reference for server-side settled-duplicate detection. */
  paymentReference?: (
    intent: XGuardAutomatedPaymentIntent,
  ) => string | undefined | null;
  /** Optional deterministic request ID. Otherwise XGuard generates a unique agent request ID. */
  requestId?: (intent: XGuardAutomatedPaymentIntent) => string;
  /** Optional callback for durable XGuard decision/evidence receipts. */
  onReceipt?: (
    receipt: XGuardHostedPaymentReceipt,
    intent: XGuardAutomatedPaymentIntent,
  ) => void | Promise<void>;
}

export function createXGuardHostedPaymentAuthorizer(
  options: XGuardHostedPaymentAuthorizerOptions,
): (
  intent: XGuardAutomatedPaymentIntent,
) => Promise<XGuardAutomatedPaymentDecision> {
  const gateway = normalizeGateway(options.gateway ?? "https://xguardgate.com");
  const accessToken = requiredToken(options.accessToken);
  const assets = options.assets.map(validateAssetDefinition);
  if (!assets.length)
    throw new TypeError("XGuard hosted authorization requires at least one asset definition");
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000)
    throw new TypeError("XGuard hosted authorization timeoutMs must be 1..60000");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw new TypeError("XGuard hosted authorization requires fetch");
  const provider = safeId(options.provider ?? "x402", "provider");

  return async (intent) => {
    const asset = findAsset(assets, intent.network, intent.asset);
    if (!asset)
      return {
        allow: false,
        reason: "XGuard hosted authorization has no asset metadata for this payment",
      };

    const amount = atomicToDecimal(intent.amountAtomic, asset.decimals);
    const requestId = options.requestId?.(intent) ?? createAgentRequestId();
    validateRequestId(requestId);
    const paymentReference = options.paymentReference?.(intent) ?? undefined;
    if (paymentReference !== undefined && paymentReference !== null) {
      const value = String(paymentReference).trim();
      if (!value || value.length > 160)
        throw new TypeError("XGuard paymentReference must be 1..160 characters");
    }

    const merchantOrigin = resourceOrigin(intent.resourceUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${gateway}/v1/payment/decision`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-XGuard-SDK": "@xguard/sdk/hosted-auto-pay",
        },
        body: JSON.stringify({
          requestId,
          channel: "agent",
          rail: "x402",
          provider,
          amount,
          currency: asset.currency,
          payee: intent.payTo,
          merchantOrigin,
          network: intent.network,
          asset: intent.asset,
          ...(paymentReference
            ? { paymentReference: String(paymentReference).trim() }
            : {}),
          metadata: {
            resourceUrl: intent.resourceUrl.slice(0, 512),
            ...(intent.serviceName
              ? { serviceName: intent.serviceName.slice(0, 160) }
              : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error("XGuard hosted authorization timed out");
      throw new Error(`XGuard hosted authorization request failed: ${safeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    const receipt = (await response.json().catch(() => null)) as
      | XGuardHostedPaymentReceipt
      | null;
    if (!response.ok) {
      const code = errorCode(receipt);
      if (response.status === 402)
        throw new Error("XGuard service balance is insufficient for automated payment authorization");
      if (response.status === 401)
        throw new Error("XGuard automated payment access token is invalid or expired");
      if (response.status === 403)
        throw new Error("XGuard automated payment credential lacks billing scope");
      throw new Error(
        `XGuard hosted authorization returned HTTP ${response.status}${code ? `: ${code}` : ""}`,
      );
    }
    if (!receipt || typeof receipt.decision !== "string")
      throw new Error("XGuard hosted authorization returned an invalid decision receipt");

    await options.onReceipt?.(receipt, intent);
    const decision = receipt.decision.toUpperCase();
    if (decision === "ALLOW") return { allow: true };
    if (decision === "REVIEW" && options.allowReview === true)
      return { allow: true, reason: receiptReason(receipt, "XGuard returned REVIEW") };
    if (decision === "REVIEW")
      return { allow: false, reason: receiptReason(receipt, "XGuard requires review") };
    if (decision === "BLOCK")
      return { allow: false, reason: receiptReason(receipt, "XGuard blocked automated payment") };
    return { allow: false, reason: `Unknown XGuard decision: ${decision}` };
  };
}

function validateAssetDefinition(
  value: XGuardHostedAssetDefinition,
): XGuardHostedAssetDefinition {
  const network = requiredString(value.network, "asset network", 96);
  const asset = requiredString(value.asset, "asset identifier", 128);
  const currency = requiredString(value.currency, "asset currency", 12).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,11}$/.test(currency))
    throw new TypeError("XGuard asset currency is invalid");
  if (!Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 30)
    throw new TypeError("XGuard asset decimals must be an integer from 0 to 30");
  return { network, asset, currency, decimals: value.decimals };
}

function findAsset(
  assets: XGuardHostedAssetDefinition[],
  network: string,
  asset: string,
): XGuardHostedAssetDefinition | undefined {
  return assets.find(
    (entry) =>
      entry.network === network &&
      sameAsset(network, entry.asset, asset),
  );
}

function sameAsset(network: string, left: string, right: string): boolean {
  return network.startsWith("eip155:")
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function atomicToDecimal(value: string, decimals: number): string {
  const normalized = String(value).trim();
  if (!/^[0-9]+$/.test(normalized))
    throw new TypeError("XGuard atomic payment amount must be an integer string");
  const amount = BigInt(normalized);
  if (amount <= 0n)
    throw new TypeError("XGuard atomic payment amount must be greater than zero");
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

function resourceOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("XGuard automated payment resource URL is invalid");
  }
  if (url.protocol !== "https:")
    throw new TypeError("XGuard hosted automated payment resources must use HTTPS");
  return url.origin;
}

function normalizeGateway(value: string): string {
  const raw = String(value).trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("XGuard hosted authorization gateway is invalid");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new TypeError("XGuard hosted authorization gateway must use HTTPS");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new TypeError("XGuard hosted authorization gateway must be an origin");
  return url.origin;
}

function requiredToken(value: string): string {
  const token = String(value ?? "").trim();
  if (token.length < 16 || token.length > 4096 || /\s/.test(token))
    throw new TypeError("XGuard hosted authorization accessToken is invalid");
  return token;
}

function validateRequestId(value: string): void {
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(String(value)))
    throw new TypeError("XGuard hosted authorization requestId is invalid");
}

function createAgentRequestId(): string {
  return `agent:${globalThis.crypto.randomUUID()}`;
}

function safeId(value: string, label: string): string {
  const normalized = requiredString(value, label, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized))
    throw new TypeError(`XGuard ${label} is invalid`);
  return normalized;
}

function requiredString(value: string, label: string, max: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max)
    throw new TypeError(`XGuard ${label} must be 1..${max} characters`);
  return normalized;
}

function errorCode(receipt: XGuardHostedPaymentReceipt | null): string {
  if (!receipt) return "";
  const value = receipt.error;
  return typeof value === "string" ? value.slice(0, 160) : "";
}

function receiptReason(
  receipt: XGuardHostedPaymentReceipt,
  fallback: string,
): string {
  const codes = Array.isArray(receipt.reasonCodes)
    ? receipt.reasonCodes.filter((value) => typeof value === "string").slice(0, 5)
    : [];
  return codes.length ? `${fallback}: ${codes.join(", ")}` : fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "unknown error";
}
