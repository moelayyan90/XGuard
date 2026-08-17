import {
  parseJsonStrict,
  readHttpBodyTextCapped,
} from "@xguard/core/edge";

const MAX_COMPAT_BODY_BYTES = 64 * 1024;
const BASE_V1 = "base";
const BASE_V2 = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type X402ClientVersion = 1 | 2;

export interface CompatibilityRequest {
  request: Request;
  clientVersion: X402ClientVersion;
  operation: "/verify" | "/settle";
}

export async function normalizeX402CompatibilityRequest(
  request: Request,
): Promise<CompatibilityRequest | null> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    (url.pathname !== "/verify" && url.pathname !== "/settle")
  )
    return null;

  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    return {
      request,
      clientVersion: 2,
      operation: url.pathname,
    };

  let raw: Record<string, unknown>;
  try {
    raw = asRecord(
      parseJsonStrict(
        await readHttpBodyTextCapped(
          request.clone(),
          MAX_COMPAT_BODY_BYTES,
          "x402 compatibility request body",
        ),
      ),
    );
  } catch {
    return {
      request,
      clientVersion: 2,
      operation: url.pathname,
    };
  }

  if (raw.x402Version !== 1)
    return {
      request,
      clientVersion: 2,
      operation: url.pathname,
    };

  const translated = translateV1FacilitatorEnvelope(raw);
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  headers.set("X-XGuard-Compatibility-Input", "x402-v1");

  return {
    request: new Request(request, {
      headers,
      body: JSON.stringify(translated),
    }),
    clientVersion: 1,
    operation: url.pathname,
  };
}

export function translateV1FacilitatorEnvelope(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  assertAllowedKeys(raw, [
    "x402Version",
    "paymentPayload",
    "paymentRequirements",
  ]);
  if (raw.x402Version !== 1)
    throw new Error("compatibility_bridge_requires_x402_v1");

  const paymentPayload = asRecord(raw.paymentPayload);
  assertAllowedKeys(paymentPayload, [
    "x402Version",
    "scheme",
    "network",
    "payload",
  ]);
  if (paymentPayload.x402Version !== 1)
    throw new Error("v1_payment_payload_version_required");
  if (paymentPayload.scheme !== "exact")
    throw new Error("v1_exact_scheme_required");
  if (paymentPayload.network !== BASE_V1)
    throw new Error("v1_base_mainnet_required");

  const requirements = asRecord(raw.paymentRequirements);
  assertAllowedKeys(requirements, [
    "scheme",
    "network",
    "maxAmountRequired",
    "amount",
    "resource",
    "description",
    "mimeType",
    "outputSchema",
    "payTo",
    "maxTimeoutSeconds",
    "asset",
    "extra",
  ]);
  if (requirements.scheme !== "exact")
    throw new Error("v1_exact_scheme_required");
  if (requirements.network !== BASE_V1)
    throw new Error("v1_base_mainnet_required");
  if (
    typeof requirements.asset !== "string" ||
    requirements.asset.toLowerCase() !== BASE_USDC.toLowerCase()
  )
    throw new Error("v1_base_usdc_required");

  const amount = atomicAmount(requirements.maxAmountRequired);
  const payTo = evmAddress(requirements.payTo, "paymentRequirements.payTo");
  const resourceUrl = absoluteHttpsUrl(requirements.resource);
  const maxTimeoutSeconds = positiveInteger(
    requirements.maxTimeoutSeconds,
    "paymentRequirements.maxTimeoutSeconds",
  );
  const extra = optionalRecord(requirements.extra);

  const accepted: Record<string, unknown> = {
    scheme: "exact",
    network: BASE_V2,
    amount,
    asset: requirements.asset,
    payTo,
    maxTimeoutSeconds,
  };
  if (extra !== undefined) accepted.extra = extra;

  const resource: Record<string, unknown> = { url: resourceUrl };
  if (typeof requirements.description === "string")
    resource.description = requirements.description;
  if (typeof requirements.mimeType === "string")
    resource.mimeType = requirements.mimeType;

  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource,
      accepted,
      payload: asRecord(paymentPayload.payload),
      extensions: {},
    },
    paymentRequirements: accepted,
  };
}

export async function adaptCompatibilityResponse(
  response: Response,
  compatibility: CompatibilityRequest | null,
): Promise<Response> {
  if (compatibility === null) return response;

  if (compatibility.clientVersion === 2) {
    if (
      compatibility.operation === "/verify" ||
      compatibility.operation === "/settle"
    ) {
      const headers = new Headers(response.headers);
      headers.set("X-XGuard-Compatibility", "native-x402-v2");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("X-XGuard-Compatibility", "x402-v1-to-v2");
  headers.set("X-XGuard-Canonical-Network", BASE_V2);

  if (compatibility.operation !== "/settle")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

  try {
    const parsed = (await response.clone().json()) as unknown;
    if (!isRecord(parsed)) throw new Error("non_json_settle_response");
    if (parsed.network === BASE_V2) parsed.network = BASE_V1;
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.delete("Content-Length");
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export async function augmentSupportedCompatibility(
  response: Response,
): Promise<Response> {
  if (!response.ok) return response;
  try {
    const parsed = (await response.clone().json()) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.kinds)) return response;
    const kinds = parsed.kinds.filter(isRecord);
    const hasCanonical = kinds.some(
      (kind) =>
        kind.x402Version === 2 &&
        kind.scheme === "exact" &&
        kind.network === BASE_V2,
    );
    const hasV1 = kinds.some(
      (kind) =>
        kind.x402Version === 1 &&
        kind.scheme === "exact" &&
        kind.network === BASE_V1,
    );
    if (hasCanonical && !hasV1)
      kinds.push({ x402Version: 1, scheme: "exact", network: BASE_V1 });
    parsed.kinds = kinds;
    parsed.compatibility = {
      canonical: { x402Version: 2, network: BASE_V2, scheme: "exact" },
      acceptedLegacy: [{ x402Version: 1, network: BASE_V1, scheme: "exact" }],
      mode: "normalize-v1-to-v2",
    };
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.delete("Content-Length");
    headers.set("X-XGuard-Compatibility", "x402-v1-v2");
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

function atomicAmount(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw new Error("invalid_v1_max_amount_required");
  const amount = BigInt(value);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("invalid_v1_max_amount_required");
  return value;
}

function evmAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`invalid_${field.replaceAll(".", "_")}`);
  return value;
}

function absoluteHttpsUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_v1_resource_url");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("invalid_v1_resource_url");
  return url.toString();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`invalid_${field.replaceAll(".", "_")}`);
  return value as number;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return asRecord(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected !== undefined)
    throw new Error(`unsupported_v1_field:${unexpected}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("expected_json_object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
