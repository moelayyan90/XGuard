import { translateV1FacilitatorEnvelope } from "./x402-compatibility-bridge.js";

const BRIDGE_PATH = "/v1/x402/bridge";
const BASE_V1 = "base";
const BASE_V2 = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_PAYMENT_HEADER_BYTES = 32 * 1024;
const XGUARD_MAINNET_HOST = "xguard-mainnet.maqamapp.workers.dev";

interface RateLimitDecision {
  success: boolean;
}

interface PublicRateLimit {
  limit(input: { key: string }): Promise<RateLimitDecision>;
}

export interface X402HttpCompatibilityEnv {
  REQUEST_RATE_LIMITER: PublicRateLimit;
}

export type X402BridgeFetch = (request: Request) => Promise<Response>;

interface CompatibleV2Requirement {
  scheme: "exact";
  network: typeof BASE_V2;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface CompatibleV2Challenge {
  raw: Record<string, unknown>;
  resource: Record<string, unknown>;
  accepts: CompatibleV2Requirement[];
  encoded: string;
}

export async function x402HttpCompatibilityResponse(
  request: Request,
  env: X402HttpCompatibilityEnv,
  fetchUpstream: X402BridgeFetch = (upstreamRequest) => fetch(upstreamRequest),
): Promise<Response | null> {
  const bridgeUrl = new URL(request.url);
  if (bridgeUrl.pathname !== BRIDGE_PATH) return null;

  if (request.method !== "GET")
    return bridgeJson(
      {
        error: "x402_bridge_method_not_allowed",
        message: "The compatibility bridge currently accepts GET only",
      },
      405,
      { Allow: "GET" },
    );

  const protection = await publicBridgeGuard(request, env);
  if (protection !== null) return protection;

  let target: URL;
  try {
    target = safeTargetUrl(bridgeUrl.searchParams.get("url"));
  } catch (error) {
    return bridgeJson({ error: bridgeErrorCode(error) }, 400);
  }

  let probe: Response;
  try {
    probe = await fetchUpstream(
      new Request(target.toString(), {
        method: "GET",
        headers: upstreamRequestHeaders(request),
        redirect: "manual",
      }),
    );
  } catch {
    return bridgeJson({ error: "x402_bridge_target_unavailable" }, 502);
  }

  if (isRedirect(probe.status))
    return bridgeJson(
      {
        error: "x402_bridge_redirect_rejected",
        upstreamStatus: probe.status,
      },
      502,
    );

  if (probe.status !== 402)
    return bridgeJson(
      {
        error: "target_is_not_x402_v2",
        upstreamStatus: probe.status,
      },
      409,
    );

  let challenge: CompatibleV2Challenge;
  try {
    challenge = parseCompatibleV2Challenge(probe);
  } catch (error) {
    return bridgeJson({ error: bridgeErrorCode(error) }, 422);
  }

  const legacyPayment = request.headers.get("x-payment")?.trim() ?? "";
  if (legacyPayment === "") return legacyChallengeResponse(challenge);

  let canonicalPayment: string;
  try {
    canonicalPayment = translateLegacyPaymentHeader(legacyPayment, challenge);
  } catch (error) {
    return bridgeJson({ error: bridgeErrorCode(error) }, 409);
  }

  let paid: Response;
  try {
    const headers = upstreamRequestHeaders(request);
    headers.set("PAYMENT-SIGNATURE", canonicalPayment);
    paid = await fetchUpstream(
      new Request(target.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
      }),
    );
  } catch {
    return bridgeJson({ error: "x402_bridge_target_unavailable" }, 502);
  }

  if (isRedirect(paid.status))
    return bridgeJson(
      {
        error: "x402_bridge_redirect_rejected",
        upstreamStatus: paid.status,
      },
      502,
    );

  if (paid.status === 402) {
    try {
      return legacyChallengeResponse(parseCompatibleV2Challenge(paid));
    } catch (error) {
      return bridgeJson({ error: bridgeErrorCode(error) }, 422);
    }
  }

  return adaptPaidResourceResponse(paid);
}

export function translateV2PaymentRequiredToV1(
  paymentRequired: Record<string, unknown>,
): Record<string, unknown> {
  const resource = asRecord(paymentRequired.resource);
  const acceptsRaw = paymentRequired.accepts;
  if (!Array.isArray(acceptsRaw)) throw new Error("v2_accepts_required");
  const accepts = acceptsRaw
    .filter(isRecord)
    .map(parseCompatibleRequirement)
    .filter(
      (requirement): requirement is CompatibleV2Requirement =>
        requirement !== null,
    );
  if (accepts.length === 0)
    throw new Error("no_compatible_base_exact_usdc_requirement");

  const resourceUrl = absolutePublicHttpsUrl(resource.url).toString();
  const description =
    typeof resource.description === "string" ? resource.description : undefined;
  const mimeType =
    typeof resource.mimeType === "string" ? resource.mimeType : undefined;

  const legacyAccepts = accepts.map((requirement) => ({
    scheme: "exact",
    network: BASE_V1,
    maxAmountRequired: requirement.amount,
    resource: resourceUrl,
    ...(description === undefined ? {} : { description }),
    ...(mimeType === undefined ? {} : { mimeType }),
    payTo: requirement.payTo,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    asset: requirement.asset,
    ...(requirement.extra === undefined ? {} : { extra: requirement.extra }),
  }));

  return {
    x402Version: 1,
    accepts: legacyAccepts,
    ...(typeof paymentRequired.error === "string"
      ? { error: paymentRequired.error }
      : {}),
  };
}

export function translateLegacyPaymentHeader(
  encodedLegacyPayment: string,
  challenge: CompatibleV2Challenge,
): string {
  const legacyPayment = decodeBase64JsonRecord(
    encodedLegacyPayment,
    "invalid_x_payment_header",
  );
  if (legacyPayment.x402Version !== 1)
    throw new Error("x_payment_must_be_x402_v1");
  if (legacyPayment.scheme !== "exact")
    throw new Error("x_payment_exact_scheme_required");
  if (legacyPayment.network !== BASE_V1)
    throw new Error("x_payment_base_mainnet_required");

  const payload = asRecord(legacyPayment.payload);
  const authorization = asRecord(payload.authorization);
  const signature = payload.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error("invalid_x_payment_signature");
  const payer = evmAddress(authorization.from, "authorization_from");
  const payTo = evmAddress(authorization.to, "authorization_to");
  const value = atomicAmount(authorization.value, "authorization_value");
  const validAfter = unsignedIntegerString(
    authorization.validAfter,
    "authorization_valid_after",
  );
  const validBefore = unsignedIntegerString(
    authorization.validBefore,
    "authorization_valid_before",
  );
  if (BigInt(validBefore) <= BigInt(validAfter))
    throw new Error("invalid_authorization_window");
  const nonce = authorization.nonce;
  if (typeof nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nonce))
    throw new Error("invalid_authorization_nonce");

  const accepted = challenge.accepts.find(
    (requirement) =>
      requirement.amount === value &&
      requirement.payTo.toLowerCase() === payTo.toLowerCase(),
  );
  if (accepted === undefined)
    throw new Error("x_payment_does_not_match_current_v2_terms");

  const resourceUrl = absolutePublicHttpsUrl(challenge.resource.url).toString();
  const v1Requirement: Record<string, unknown> = {
    scheme: "exact",
    network: BASE_V1,
    maxAmountRequired: accepted.amount,
    resource: resourceUrl,
    payTo: accepted.payTo,
    maxTimeoutSeconds: accepted.maxTimeoutSeconds,
    asset: accepted.asset,
  };
  if (typeof challenge.resource.description === "string")
    v1Requirement.description = challenge.resource.description;
  if (typeof challenge.resource.mimeType === "string")
    v1Requirement.mimeType = challenge.resource.mimeType;
  if (accepted.extra !== undefined) v1Requirement.extra = accepted.extra;

  const translated = translateV1FacilitatorEnvelope({
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network: BASE_V1,
      payload: {
        signature,
        authorization: {
          from: payer,
          to: payTo,
          value,
          validAfter,
          validBefore,
          nonce,
        },
      },
    },
    paymentRequirements: v1Requirement,
  });
  const canonical = asRecord(translated.paymentPayload);
  canonical.extensions = isRecord(challenge.raw.extensions)
    ? challenge.raw.extensions
    : {};
  return encodeBase64Json(canonical);
}

async function publicBridgeGuard(
  request: Request,
  env: X402HttpCompatibilityEnv,
): Promise<Response | null> {
  const client =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `public:${BRIDGE_PATH}:${client}`,
    });
    if (decision.success) return null;
    return bridgeJson({ error: "rate_limit_exceeded" }, 429, {
      "Retry-After": "60",
    });
  } catch {
    return bridgeJson({ error: "protection_unavailable" }, 503);
  }
}

function parseCompatibleV2Challenge(response: Response): CompatibleV2Challenge {
  const encoded = response.headers.get("payment-required")?.trim() ?? "";
  if (encoded === "") throw new Error("payment_required_header_missing");
  const raw = decodeBase64JsonRecord(
    encoded,
    "invalid_payment_required_header",
  );
  if (raw.x402Version !== 2)
    throw new Error("payment_required_must_be_x402_v2");
  const resource = asRecord(raw.resource);
  absolutePublicHttpsUrl(resource.url);
  if (!Array.isArray(raw.accepts)) throw new Error("v2_accepts_required");
  const accepts = raw.accepts
    .filter(isRecord)
    .map(parseCompatibleRequirement)
    .filter(
      (requirement): requirement is CompatibleV2Requirement =>
        requirement !== null,
    );
  if (accepts.length === 0)
    throw new Error("no_compatible_base_exact_usdc_requirement");
  return { raw, resource, accepts, encoded };
}

function parseCompatibleRequirement(
  raw: Record<string, unknown>,
): CompatibleV2Requirement | null {
  if (raw.scheme !== "exact" || raw.network !== BASE_V2) return null;
  if (
    typeof raw.asset !== "string" ||
    raw.asset.toLowerCase() !== BASE_USDC.toLowerCase()
  )
    return null;
  const amount = atomicAmount(raw.amount, "requirement_amount");
  const payTo = evmAddress(raw.payTo, "requirement_pay_to");
  if (
    !Number.isSafeInteger(raw.maxTimeoutSeconds) ||
    raw.maxTimeoutSeconds <= 0
  )
    throw new Error("invalid_requirement_max_timeout_seconds");
  const extra = raw.extra === undefined ? undefined : asRecord(raw.extra);
  return {
    scheme: "exact",
    network: BASE_V2,
    amount,
    asset: raw.asset,
    payTo,
    maxTimeoutSeconds: raw.maxTimeoutSeconds,
    ...(extra === undefined ? {} : { extra }),
  };
}

function legacyChallengeResponse(challenge: CompatibleV2Challenge): Response {
  const body = translateV2PaymentRequiredToV1(challenge.raw);
  return bridgeJson(body, 402, {
    "PAYMENT-REQUIRED": challenge.encoded,
    "X-XGuard-Compatibility": "x402-v2-resource-to-v1-client",
    "X-XGuard-Canonical-Network": BASE_V2,
  });
}

async function adaptPaidResourceResponse(
  upstream: Response,
): Promise<Response> {
  const headers = sanitizedUpstreamResponseHeaders(upstream.headers);
  headers.set("X-XGuard-Compatibility", "x402-v1-client-to-v2-resource");
  headers.set("X-XGuard-Canonical-Network", BASE_V2);
  const canonicalPaymentResponse =
    upstream.headers.get("payment-response")?.trim() ?? "";
  if (canonicalPaymentResponse !== "") {
    try {
      const settlement = decodeBase64JsonRecord(
        canonicalPaymentResponse,
        "invalid_payment_response_header",
      );
      if (settlement.network === BASE_V2) settlement.network = BASE_V1;
      headers.set("X-PAYMENT-RESPONSE", encodeBase64Json(settlement));
    } catch {
      return bridgeJson({ error: "invalid_payment_response_header" }, 502);
    }
  }
  exposeCompatibilityHeaders(headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function upstreamRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const acceptLanguage = request.headers.get("accept-language");
  if (accept !== null && accept.length <= 1024) headers.set("Accept", accept);
  if (acceptLanguage !== null && acceptLanguage.length <= 512)
    headers.set("Accept-Language", acceptLanguage);
  headers.set("User-Agent", "XGuard-x402-Compatibility-Bridge/1.0");
  return headers;
}

function sanitizedUpstreamResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (
      lower === "set-cookie" ||
      lower === "connection" ||
      lower === "transfer-encoding" ||
      lower.startsWith("cf-")
    )
      continue;
    headers.set(name, value);
  }
  exposeCompatibilityHeaders(headers);
  return headers;
}

function exposeCompatibilityHeaders(headers: Headers): void {
  const existing = headers.get("access-control-expose-headers");
  const values = new Set(
    (existing ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const name of [
    "PAYMENT-REQUIRED",
    "PAYMENT-RESPONSE",
    "X-PAYMENT-RESPONSE",
    "X-XGuard-Compatibility",
    "X-XGuard-Canonical-Network",
  ])
    values.add(name);
  headers.set("Access-Control-Expose-Headers", [...values].join(", "));
}

function safeTargetUrl(value: string | null): URL {
  if (value === null || value.trim() === "")
    throw new Error("x402_bridge_target_required");
  const url = absolutePublicHttpsUrl(value);
  if (url.port !== "" && url.port !== "443")
    throw new Error("x402_bridge_target_port_rejected");
  if (url.hostname.toLowerCase() === XGUARD_MAINNET_HOST)
    throw new Error("x402_bridge_recursive_target_rejected");
  return url;
}

function absolutePublicHttpsUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("invalid_https_url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_https_url");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
    throw new Error("invalid_https_url");
  if (blockedHostname(url.hostname)) throw new Error("private_target_rejected");
  return url;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.includes(":")
  )
    return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

function decodeBase64JsonRecord(
  encoded: string,
  code: string,
): Record<string, unknown> {
  if (encoded.length === 0 || encoded.length > MAX_PAYMENT_HEADER_BYTES)
    throw new Error(code);
  try {
    const binary = atob(encoded);
    if (binary.length > MAX_PAYMENT_HEADER_BYTES) throw new Error(code);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return asRecord(parsed);
  } catch {
    throw new Error(code);
  }
}

function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > MAX_PAYMENT_HEADER_BYTES)
    throw new Error("payment_header_too_large");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return btoa(binary);
}

function atomicAmount(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw new Error(`invalid_${field}`);
  const amount = BigInt(value);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`invalid_${field}`);
  return value;
}

function unsignedIntegerString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw new Error(`invalid_${field}`);
  return value;
}

function evmAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`invalid_${field}`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("expected_json_object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function bridgeJson(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  exposeCompatibilityHeaders(headers);
  return new Response(JSON.stringify(value), { status, headers });
}

function bridgeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z0-9_:-]+$/.test(error.message))
    return error.message;
  return "x402_bridge_error";
}
