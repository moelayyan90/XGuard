import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { validatePaymentIdentifier } from "@x402/extensions/payment-identifier";
import { parseJsonStrict } from "@xguard/core";

const ALPHA_NETWORK = "eip155:84532";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface EndpointCheckResult {
  url: string;
  compatible: boolean;
  status: number | null;
  latencyMs: number | null;
  protocolVersion: number | null;
  facilitatorMigration: "YES" | "UNKNOWN";
  compatibilityScope: "x402-v2-exact-eip155:84532-authorization";
  issues: string[];
  features: {
    paymentIdentifier: boolean;
    bazaar: boolean;
    offerReceipt: boolean;
  };
  featureEvidence: {
    paymentIdentifier: string;
    bazaar: string;
    offerReceipt: string;
  };
}

export interface EndpointCheckerDependencies {
  lookup: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<{ address: string; family: number }[]>;
  fetch: (
    input: string | URL,
    init: RequestInit & { dispatcher: Agent },
  ) => Promise<Response>;
}

const defaultDependencies: EndpointCheckerDependencies = {
  lookup,
  fetch: undiciFetch as unknown as EndpointCheckerDependencies["fetch"],
};

export async function checkEndpoint(
  rawUrl: string,
  dependencies: EndpointCheckerDependencies = defaultDependencies,
): Promise<EndpointCheckResult> {
  const url = validatePublicUrl(rawUrl);
  const addresses = await dependencies.lookup(url.hostname, {
    all: true,
    verbatim: true,
  });
  if (
    addresses.length === 0 ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new Error("Endpoint DNS includes a non-public address");
  const selected = addresses[0];
  if (selected === undefined)
    throw new Error("Endpoint DNS returned no address");
  const pinnedLookup = ((
    _hostname: string,
    _options: unknown,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup } });
  const started = performance.now();
  try {
    const response = await dependencies.fetch(url, {
      method: "GET",
      redirect: "manual",
      dispatcher,
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "XGuard-Compatibility-Checker/0.1",
      },
    });
    const latencyMs = performance.now() - started;
    await consumeLimited(
      response.body as unknown as NodeReadableStream<Uint8Array> | null,
      64 * 1024,
    );
    const issues: string[] = [];
    const header = response.headers.get("payment-required");
    let required: PaymentRequired | null = null;
    if (response.status !== 402)
      issues.push(`Expected HTTP 402; received ${response.status}`);
    if (header === null) issues.push("PAYMENT-REQUIRED header is missing");
    else if (Buffer.byteLength(header, "utf8") > 32 * 1024)
      issues.push("PAYMENT-REQUIRED header is oversized");
    else {
      try {
        parseJsonStrict(Buffer.from(header, "base64").toString("utf8"), {
          maxBytes: 32 * 1024,
        });
        required = decodePaymentRequiredHeader(header);
      } catch {
        issues.push("PAYMENT-REQUIRED is not valid base64-encoded strict JSON");
      }
    }
    const protocolVersion =
      typeof required?.x402Version === "number" ? required.x402Version : null;
    if (protocolVersion !== 2)
      issues.push("Endpoint does not advertise x402 v2");
    const extensions =
      required !== null && required.x402Version === 2
        ? required.extensions
        : undefined;
    const alphaCandidates =
      required !== null && required.x402Version === 2
        ? required.accepts.filter(
            (option) =>
              option.scheme === "exact" && option.network === ALPHA_NETWORK,
          )
        : [];
    const compatibleOptions = alphaCandidates.filter((option, index) => {
      const errors = alphaRequirementErrors(option);
      if (errors.length > 0)
        issues.push(
          `Base Sepolia option ${index + 1} is not XGuard-alpha compatible: ${errors.join("; ")}`,
        );
      return errors.length === 0;
    });
    if (protocolVersion === 2 && compatibleOptions.length === 0)
      issues.push(
        "No structurally valid x402 v2 exact authorization option for eip155:84532 is advertised",
      );
    const cacheControl =
      response.headers.get("cache-control")?.toLowerCase() ?? "";
    if (cacheControl.includes("public") || cacheControl.includes("s-maxage"))
      issues.push("HTTP 402 is marked as shared-cacheable");
    const paymentIdentifierExtension = extensions?.["payment-identifier"];
    const paymentIdentifier =
      paymentIdentifierExtension !== undefined &&
      validatePaymentIdentifier(paymentIdentifierExtension).valid;
    if (paymentIdentifierExtension !== undefined && !paymentIdentifier)
      issues.push("Payment Identifier declaration is malformed");
    const bazaarExtension = extensions?.bazaar;
    const bazaar =
      bazaarExtension !== undefined &&
      validateDiscoveryExtension(
        bazaarExtension as Parameters<typeof validateDiscoveryExtension>[0],
      ).valid;
    if (bazaarExtension !== undefined && !bazaar)
      issues.push("Bazaar metadata declaration is malformed");
    const offerReceipt = extensions?.["offer-receipt"] !== undefined;
    const compatible =
      response.status === 402 &&
      protocolVersion === 2 &&
      compatibleOptions.length > 0;
    return {
      url: url.toString(),
      compatible,
      status: response.status,
      latencyMs,
      protocolVersion,
      facilitatorMigration: compatible ? "YES" : "UNKNOWN",
      compatibilityScope: "x402-v2-exact-eip155:84532-authorization",
      issues,
      features: {
        paymentIdentifier,
        bazaar,
        offerReceipt,
      },
      featureEvidence: {
        paymentIdentifier: paymentIdentifier
          ? "Valid declaration detected; resource-response caching was not exercised"
          : "No valid declaration detected",
        bazaar: bazaar
          ? "Valid metadata detected; facilitator catalog ingestion or listing was not verified"
          : "No valid metadata detected",
        offerReceipt: offerReceipt
          ? "Extension data detected; signatures and receipt issuance were not verified"
          : "No extension data detected",
      },
    };
  } finally {
    await dispatcher.close();
  }
}

function alphaRequirementErrors(
  option: PaymentRequired["accepts"][number],
): string[] {
  const errors: string[] = [];
  if (option.scheme !== "exact") errors.push("scheme must be exact");
  if (option.network !== ALPHA_NETWORK)
    errors.push(`network must be ${ALPHA_NETWORK}`);
  if (!EVM_ADDRESS.test(option.asset))
    errors.push("asset is not an EVM address");
  if (!EVM_ADDRESS.test(option.payTo))
    errors.push("payTo is not an EVM address");
  if (
    !UNSIGNED_INTEGER.test(option.amount) ||
    BigInt(option.amount) <= 0n ||
    BigInt(option.amount) > MAX_UINT256
  )
    errors.push("amount must be a positive uint256 atomic-unit integer");
  if (
    !Number.isSafeInteger(option.maxTimeoutSeconds) ||
    option.maxTimeoutSeconds <= 0 ||
    option.maxTimeoutSeconds > 86_400
  )
    errors.push("maxTimeoutSeconds must be an integer from 1 through 86400");
  const extra = option.extra;
  if (extra !== undefined && (extra === null || Array.isArray(extra))) {
    errors.push("extra must be an object");
    return errors;
  }
  const method = extra?.assetTransferMethod;
  const flow = extra?.paymentFlow;
  if (flow !== undefined && flow !== "authorization")
    errors.push("paymentFlow must be authorization when present");
  if (method !== undefined && method !== "eip3009" && method !== "permit2")
    errors.push("assetTransferMethod must be eip3009 or permit2 when present");
  if (
    method !== "permit2" &&
    (typeof extra?.name !== "string" ||
      extra.name.length === 0 ||
      typeof extra.version !== "string" ||
      extra.version.length === 0)
  )
    errors.push("EIP-3009 requires non-empty extra.name and extra.version");
  return errors;
}

function validatePublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:")
    throw new Error("Only public HTTPS endpoints can be checked");
  if (url.username !== "" || url.password !== "")
    throw new Error("Endpoint credentials are forbidden");
  if (url.port !== "" && url.port !== "443")
    throw new Error("Only TCP port 443 is allowed");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
    throw new Error("Local endpoints are forbidden");
  return url;
}

function isPublicAddress(address: string): boolean {
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  return parsed.range() === "unicast";
}

async function consumeLimited(
  body: NodeReadableStream<Uint8Array> | null,
  limit: number,
): Promise<void> {
  if (body === null) return;
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return;
      bytes += item.value.byteLength;
      if (bytes > limit)
        throw new Error("Endpoint response exceeds the checker limit");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
