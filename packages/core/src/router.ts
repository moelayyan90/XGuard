import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import {
  FacilitatorResponseError,
  type FacilitatorClient,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { SettleError, VerifyError } from "@x402/core/types";
import ipaddr from "ipaddr.js";
import { Agent, fetch as boundedFetch } from "undici";
import { parseJsonStrict } from "./canonical.js";
import { XGuardError } from "./errors.js";
import { calculateUnitEconomics, parseUnsignedInteger } from "./money.js";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_TRANSACTION = /^0x[0-9a-fA-F]{64}$/;
const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024;

export type FacilitatorState =
  | "HEALTHY"
  | "DEGRADED"
  | "OPEN"
  | "HALF_OPEN"
  | "QUARANTINED"
  | "DISABLED";

export interface FacilitatorDefinition {
  id: string;
  url: string;
  client?: FacilitatorClient;
  enabled?: boolean;
  downstreamCostMicroUsd: bigint | null;
  timeoutMs?: number;
  authHeaders?: () => Promise<Record<string, string>>;
  /** Explicit adapter matrix used when an official exact-EVM capability omits `extra`. */
  exactEvmTransferMethods?: readonly ("eip3009" | "permit2")[];
}

export interface RoutingPolicy {
  requiredExtensions?: readonly string[];
}

export interface FacilitatorSnapshot {
  id: string;
  state: FacilitatorState;
  latencyEwmaMs: number | null;
  successEwma: number;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  capabilities: SupportedResponse | null;
  quarantineReason: string | null;
}

interface RuntimeFacilitator extends FacilitatorDefinition {
  client: FacilitatorClient;
  state: FacilitatorState;
  latencyEwmaMs: number | null;
  successEwma: number;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  capabilities: SupportedResponse | null;
  quarantineReason: string | null;
}

export interface RoutedResult<T> {
  facilitatorId: string;
  result: T;
  latencyMs: number;
  downstreamCostMicroUsd: bigint | null;
}

export class RoutingEngine {
  private readonly facilitators: RuntimeFacilitator[];

  public constructor(
    definitions: readonly FacilitatorDefinition[],
    private readonly feeMicroUsd: bigint,
    private readonly variableInfrastructureCostMicroUsd: bigint | null = 0n,
  ) {
    if (definitions.length === 0)
      throw new Error("At least one facilitator is required");
    this.facilitators = definitions.map((definition) => {
      return {
        ...definition,
        client:
          definition.client ??
          new HardenedHttpFacilitatorClient(
            definition.url,
            definition.timeoutMs ?? 10_000,
            definition.authHeaders,
          ),
        state: definition.enabled === false ? "DISABLED" : "DEGRADED",
        latencyEwmaMs: null,
        successEwma: 0.5,
        consecutiveFailures: 0,
        lastCheckedAt: null,
        capabilities: null,
        quarantineReason: null,
      };
    });
  }

  public async refreshCapabilities(): Promise<void> {
    await Promise.all(
      this.facilitators
        .filter((item) => item.state !== "DISABLED")
        .map(async (item) => {
          const started = performance.now();
          try {
            const supported = await item.client.getSupported();
            this.validateCapabilities(supported);
            item.capabilities = supported;
            this.mark(item, true, performance.now() - started);
          } catch (error) {
            if (error instanceof FacilitatorResponseError) {
              this.quarantine(
                item,
                "Malformed or timed-out facilitator capability response",
              );
            } else {
              this.mark(item, false, performance.now() - started);
            }
          }
        }),
    );
  }

  public getCombinedSupported(): SupportedResponse {
    const kinds = new Map<string, SupportedResponse["kinds"][number]>();
    let extensions: Set<string> | null = null;
    let signers: Map<string, Set<string>> | null = null;
    for (const facilitator of this.facilitators) {
      if (
        !["HEALTHY", "DEGRADED", "HALF_OPEN"].includes(facilitator.state) ||
        facilitator.capabilities === null
      )
        continue;
      const normalizedKinds = facilitator.capabilities.kinds.flatMap((kind) => {
        if (
          kind.x402Version !== 2 ||
          kind.scheme !== "exact" ||
          !kind.network.startsWith("eip155:")
        )
          return [];
        return normalizeExactEvmKinds(
          kind,
          facilitator.exactEvmTransferMethods ?? ["eip3009"],
        );
      });
      if (normalizedKinds.length === 0) continue;
      for (const normalized of normalizedKinds) {
        kinds.set(
          `${normalized.x402Version}:${normalized.scheme}:${normalized.network}:${JSON.stringify(normalized.extra ?? {})}`,
          normalized,
        );
      }
      const supportedExtensions = new Set(facilitator.capabilities.extensions);
      if (extensions === null) extensions = supportedExtensions;
      else {
        const previous: Set<string> = extensions;
        extensions = new Set<string>(
          [...previous].filter((extension) =>
            supportedExtensions.has(extension),
          ),
        );
      }
      const advertisedSigners = new Map(
        Object.entries(facilitator.capabilities.signers).map(
          ([family, addresses]) => [family, new Set(addresses)],
        ),
      );
      if (signers === null) signers = advertisedSigners;
      else {
        for (const [family, addresses] of signers) {
          const next = advertisedSigners.get(family);
          if (next === undefined) {
            signers.delete(family);
            continue;
          }
          for (const address of addresses)
            if (!next.has(address)) addresses.delete(address);
          if (addresses.size === 0) signers.delete(family);
        }
      }
    }
    return {
      kinds: [...kinds.values()],
      extensions: [...(extensions ?? [])].sort(),
      signers: Object.fromEntries(
        [...(signers ?? new Map<string, Set<string>>())].map(
          ([family, addresses]) => [family, [...addresses].sort()],
        ),
      ),
    };
  }

  public async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    expectedPayer?: string,
  ): Promise<RoutedResult<VerifyResponse>> {
    const candidates = this.candidates(
      requirements,
      false,
      requiredExtensionKeys(payload),
    );
    let lastError: unknown;
    for (const facilitator of candidates) {
      const started = performance.now();
      try {
        const result = await facilitator.client.verify(payload, requirements);
        const latencyMs = performance.now() - started;
        this.validateVerifyResponse(result, expectedPayer);
        this.mark(facilitator, true, latencyMs);
        return {
          facilitatorId: facilitator.id,
          result,
          latencyMs,
          downstreamCostMicroUsd: facilitator.downstreamCostMicroUsd,
        };
      } catch (error) {
        if (error instanceof VerifyError) {
          const latencyMs = performance.now() - started;
          const result: VerifyResponse = {
            isValid: false,
            ...(error.invalidReason === undefined
              ? {}
              : { invalidReason: error.invalidReason }),
            ...(error.invalidMessage === undefined
              ? {}
              : { invalidMessage: error.invalidMessage }),
            ...(error.payer === undefined ? {} : { payer: error.payer }),
          };
          try {
            this.validateVerifyResponse(result, expectedPayer);
          } catch (validationError) {
            this.quarantine(facilitator, "Invalid verify boundary response");
            lastError = validationError;
            continue;
          }
          this.mark(facilitator, true, latencyMs);
          return {
            facilitatorId: facilitator.id,
            result,
            latencyMs,
            downstreamCostMicroUsd: facilitator.downstreamCostMicroUsd,
          };
        }
        lastError = error;
        const latencyMs = performance.now() - started;
        if (error instanceof FacilitatorResponseError)
          this.quarantine(facilitator, "Invalid verify boundary response");
        else this.mark(facilitator, false, latencyMs);
      }
    }
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      lastError instanceof Error
        ? lastError.message
        : "No facilitator could verify the payment",
      503,
      true,
    );
  }

  public selectForSettlement(
    requirements: PaymentRequirements,
    billable = true,
    policy: RoutingPolicy = {},
  ): FacilitatorDefinition & { client: FacilitatorClient } {
    const [selected] = this.candidates(
      requirements,
      billable,
      policy.requiredExtensions ?? [],
    );
    if (selected === undefined)
      throw new XGuardError(
        "FACILITATOR_UNAVAILABLE",
        "No safe facilitator path is available",
        503,
        true,
      );
    return selected;
  }

  public async settleOnce(
    selected: FacilitatorDefinition & { client: FacilitatorClient },
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    expectedPayer?: string,
  ): Promise<RoutedResult<SettleResponse>> {
    const facilitator = this.facilitators.find(
      (item) => item.id === selected.id,
    );
    if (facilitator === undefined)
      throw new Error("Selected facilitator is no longer registered");
    const started = performance.now();
    try {
      const result = await facilitator.client.settle(payload, requirements);
      const latencyMs = performance.now() - started;
      this.validateSettleResponse(result, requirements, expectedPayer);
      this.mark(facilitator, true, latencyMs);
      return {
        facilitatorId: facilitator.id,
        result,
        latencyMs,
        downstreamCostMicroUsd: facilitator.downstreamCostMicroUsd,
      };
    } catch (error) {
      const latencyMs = performance.now() - started;
      if (error instanceof FacilitatorResponseError)
        this.quarantine(
          facilitator,
          "Invalid or ambiguous settle boundary response",
        );
      else this.mark(facilitator, false, latencyMs);
      throw error;
    }
  }

  public snapshots(): FacilitatorSnapshot[] {
    return this.facilitators.map(
      ({
        id,
        state,
        latencyEwmaMs,
        successEwma,
        consecutiveFailures,
        lastCheckedAt,
        capabilities,
        quarantineReason,
      }) => ({
        id,
        state,
        latencyEwmaMs,
        successEwma,
        consecutiveFailures,
        lastCheckedAt,
        capabilities,
        quarantineReason,
      }),
    );
  }

  private candidates(
    requirements: PaymentRequirements,
    billable: boolean,
    requiredExtensions: readonly string[],
  ): RuntimeFacilitator[] {
    return this.facilitators
      .filter(
        (item) =>
          item.state === "HEALTHY" ||
          item.state === "DEGRADED" ||
          item.state === "HALF_OPEN",
      )
      .filter((item) =>
        requiredExtensions.every((extension) =>
          item.capabilities?.extensions.includes(extension),
        ),
      )
      .filter(
        (item) =>
          item.capabilities?.kinds.some(
            (kind) =>
              kind.x402Version === 2 &&
              kind.scheme === requirements.scheme &&
              kind.network === requirements.network &&
              kindSupportsRequirements(
                kind.extra,
                requirements.extra,
                item.exactEvmTransferMethods ?? ["eip3009"],
              ),
          ) ?? false,
      )
      .filter((item) => {
        if (!billable) return true;
        const unit = calculateUnitEconomics(
          this.feeMicroUsd,
          item.downstreamCostMicroUsd,
          this.variableInfrastructureCostMicroUsd,
        );
        return (
          unit.contributionMicroUsd !== null && unit.contributionMicroUsd >= 0n
        );
      })
      .sort((left, right) => this.score(right) - this.score(left));
  }

  private score(item: RuntimeFacilitator): number {
    const latencyPenalty = (item.latencyEwmaMs ?? 1_000) / 10_000;
    const statePenalty =
      item.state === "DEGRADED" ? 0.25 : item.state === "HALF_OPEN" ? 0.5 : 0;
    return item.successEwma - latencyPenalty - statePenalty;
  }

  private mark(
    item: RuntimeFacilitator,
    success: boolean,
    latencyMs: number,
  ): void {
    const alpha = 0.2;
    item.latencyEwmaMs =
      item.latencyEwmaMs === null
        ? latencyMs
        : alpha * latencyMs + (1 - alpha) * item.latencyEwmaMs;
    item.successEwma =
      alpha * (success ? 1 : 0) + (1 - alpha) * item.successEwma;
    item.lastCheckedAt = new Date().toISOString();
    if (success) {
      item.consecutiveFailures = 0;
      item.state = "HEALTHY";
    } else {
      item.consecutiveFailures += 1;
      item.state = item.consecutiveFailures >= 3 ? "OPEN" : "DEGRADED";
    }
  }

  private quarantine(item: RuntimeFacilitator, reason: string): void {
    item.state = "QUARANTINED";
    item.quarantineReason = reason;
    item.lastCheckedAt = new Date().toISOString();
  }

  private validateCapabilities(value: SupportedResponse): void {
    if (
      !Array.isArray(value.kinds) ||
      value.kinds.length > 256 ||
      !Array.isArray(value.extensions) ||
      value.extensions.length > 128 ||
      typeof value.signers !== "object" ||
      value.signers === null ||
      Array.isArray(value.signers) ||
      !value.kinds.every(
        (kind) =>
          typeof kind === "object" &&
          kind !== null &&
          Number.isSafeInteger(kind.x402Version) &&
          kind.x402Version > 0 &&
          typeof kind.scheme === "string" &&
          kind.scheme.length > 0 &&
          kind.scheme.length <= 64 &&
          typeof kind.network === "string" &&
          kind.network.length > 0 &&
          kind.network.length <= 128 &&
          (kind.extra === undefined ||
            (typeof kind.extra === "object" &&
              kind.extra !== null &&
              !Array.isArray(kind.extra))),
      ) ||
      !value.extensions.every(
        (extension) =>
          typeof extension === "string" &&
          extension.length > 0 &&
          extension.length <= 128,
      ) ||
      !Object.entries(value.signers).every(
        ([family, addresses]) =>
          family.length > 0 &&
          family.length <= 64 &&
          Array.isArray(addresses) &&
          addresses.length <= 256 &&
          addresses.every(
            (address) => typeof address === "string" && address.length <= 256,
          ),
      )
    ) {
      throw new FacilitatorResponseError(
        "Facilitator capability response is malformed",
      );
    }
  }

  private validateVerifyResponse(
    value: VerifyResponse,
    expectedPayer?: string,
  ): void {
    if (
      typeof value.isValid !== "boolean" ||
      (value.payer !== undefined &&
        (typeof value.payer !== "string" ||
          !EVM_ADDRESS.test(value.payer) ||
          (expectedPayer !== undefined &&
            value.payer.toLowerCase() !== expectedPayer.toLowerCase())))
    )
      throw new FacilitatorResponseError(
        "Facilitator verify response is malformed",
      );
  }

  private validateSettleResponse(
    value: SettleResponse,
    requirements: PaymentRequirements,
    expectedPayer?: string,
  ): void {
    if (
      typeof value.success !== "boolean" ||
      value.network !== requirements.network
    ) {
      throw new FacilitatorResponseError(
        "Facilitator settle response conflicts with the requested network",
      );
    }
    if (value.success && value.transaction.length === 0) {
      throw new FacilitatorResponseError(
        "Successful settlement omitted its transaction identifier",
      );
    }
    if (
      value.success &&
      requirements.network.startsWith("eip155:") &&
      !EVM_TRANSACTION.test(value.transaction)
    ) {
      throw new FacilitatorResponseError(
        "Successful EVM settlement returned a malformed transaction identifier",
      );
    }
    if (!value.success && value.transaction.length > 0) {
      throw new FacilitatorResponseError(
        "Failed settlement unexpectedly included a transaction identifier",
      );
    }
    try {
      if (
        value.amount !== undefined &&
        parseUnsignedInteger(value.amount, "settlement.amount") !==
          parseUnsignedInteger(
            requirements.amount,
            "paymentRequirements.amount",
          )
      )
        throw new FacilitatorResponseError(
          "Exact settlement response amount conflicts with requirements",
        );
    } catch (error) {
      if (error instanceof FacilitatorResponseError) throw error;
      throw new FacilitatorResponseError(
        "Facilitator settlement amount is malformed",
      );
    }
    if (
      value.payer !== undefined &&
      (typeof value.payer !== "string" ||
        !EVM_ADDRESS.test(value.payer) ||
        (expectedPayer !== undefined &&
          value.payer.toLowerCase() !== expectedPayer.toLowerCase()))
    )
      throw new FacilitatorResponseError(
        "Facilitator settlement payer conflicts with the authorization",
      );
  }
}

function requiredExtensionKeys(payload: PaymentPayload): string[] {
  return Object.keys(payload.extensions ?? {}).filter(
    (key) =>
      key !== "payment-identifier" &&
      key !== "offer-receipt" &&
      key !== "sign-in-with-x",
  );
}

function kindSupportsRequirements(
  capability: Record<string, unknown> | undefined,
  required: Record<string, unknown> | null | undefined,
  modeledTransferMethods: readonly ("eip3009" | "permit2")[],
): boolean {
  const requiredTransferMethod =
    required?.assetTransferMethod === undefined
      ? "eip3009"
      : required.assetTransferMethod;
  const capabilityTransferMethod = capability?.assetTransferMethod;
  const requiredFlow =
    required?.paymentFlow === undefined
      ? "authorization"
      : required.paymentFlow;
  const capabilityFlow =
    capability?.paymentFlow === undefined
      ? "authorization"
      : capability.paymentFlow;
  return (
    (requiredTransferMethod === "eip3009" ||
      requiredTransferMethod === "permit2") &&
    (capabilityTransferMethod === undefined
      ? modeledTransferMethods.includes(requiredTransferMethod)
      : capabilityTransferMethod === requiredTransferMethod) &&
    requiredFlow === "authorization" &&
    capabilityFlow === requiredFlow
  );
}

function normalizeExactEvmKinds(
  kind: SupportedResponse["kinds"][number],
  modeledTransferMethods: readonly ("eip3009" | "permit2")[],
): SupportedResponse["kinds"][number][] {
  const explicitTransferMethod = kind.extra?.assetTransferMethod;
  const paymentFlow = kind.extra?.paymentFlow ?? "authorization";
  if (
    (explicitTransferMethod !== undefined &&
      explicitTransferMethod !== "eip3009" &&
      explicitTransferMethod !== "permit2") ||
    paymentFlow !== "authorization"
  )
    return [];
  const transferMethods =
    explicitTransferMethod === undefined
      ? [...new Set(modeledTransferMethods)]
      : [explicitTransferMethod];
  return transferMethods.map((assetTransferMethod) => ({
    ...kind,
    extra: {
      ...(kind.extra ?? {}),
      assetTransferMethod,
      paymentFlow,
    },
  }));
}

class HardenedHttpFacilitatorClient implements FacilitatorClient {
  private readonly baseUrl: string;
  private readonly dispatcher: Agent;

  public constructor(
    rawUrl: string,
    private readonly timeoutMs: number,
    private readonly authHeaders?: () => Promise<Record<string, string>>,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 250 ||
      timeoutMs > 60_000
    )
      throw new RangeError("Facilitator timeout must be 250-60000ms");
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      throw new Error(
        "Facilitator URL must use HTTPS without credentials, query, or fragment",
      );
    assertPublicAddressLiteral(url.hostname);
    this.baseUrl = url.toString().replace(/\/+$/, "");
    this.dispatcher = new Agent({
      connect: { lookup: publicOnlyLookup },
      connectTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      maxResponseSize: MAX_FACILITATOR_RESPONSE_BYTES,
      pipelining: 1,
    });
  }

  public async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const response = await this.request("verify", {
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements,
    });
    if (!response.ok) {
      const value = await parseFacilitatorJson(response, "verify");
      if (!isVerifyResponse(value))
        throw new FacilitatorResponseError(
          "Facilitator verify error response is malformed",
        );
      throw new VerifyError(response.status, value);
    }
    return (await parseFacilitatorJson(response, "verify")) as VerifyResponse;
  }

  public async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const response = await this.request("settle", {
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements,
    });
    if (!response.ok) {
      const value = await parseFacilitatorJson(response, "settle");
      if (!isSettleResponse(value))
        throw new FacilitatorResponseError(
          "Facilitator settle error response is malformed",
        );
      throw new SettleError(response.status, value);
    }
    return (await parseFacilitatorJson(response, "settle")) as SettleResponse;
  }

  public async getSupported(): Promise<SupportedResponse> {
    const response = await this.request("supported");
    if (!response.ok)
      throw new Error(
        `Facilitator supported request failed (${response.status})`,
      );
    return (await parseFacilitatorJson(
      response,
      "supported",
    )) as SupportedResponse;
  }

  private async request(
    path: "verify" | "settle" | "supported",
    body?: unknown,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const configuredHeaders = (await this.authHeaders?.()) ?? {};
      return await boundedFetch(`${this.baseUrl}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...configuredHeaders,
        },
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body, (_key, value: unknown) =>
                typeof value === "bigint" ? value.toString() : value,
              ),
            }),
        redirect: "error",
        signal: controller.signal,
        dispatcher: this.dispatcher,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseFacilitatorJson(
  response: Awaited<ReturnType<typeof boundedFetch>>,
  operation: string,
): Promise<unknown> {
  if (
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    throw new FacilitatorResponseError(
      `Facilitator ${operation} response must be JSON`,
    );
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (/^[0-9]+$/.test(contentLength) === false ||
      BigInt(contentLength) > BigInt(MAX_FACILITATOR_RESPONSE_BYTES))
  ) {
    await response.body?.cancel();
    throw new FacilitatorResponseError(
      `Facilitator ${operation} response exceeds the size limit`,
    );
  }
  const reader = response.body?.getReader();
  if (reader === undefined)
    throw new FacilitatorResponseError(
      `Facilitator ${operation} response body is missing`,
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_FACILITATOR_RESPONSE_BYTES) {
        await reader.cancel();
        throw new FacilitatorResponseError(
          `Facilitator ${operation} response exceeds the size limit`,
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof FacilitatorResponseError) throw error;
    throw new FacilitatorResponseError(
      `Facilitator ${operation} response could not be read safely`,
    );
  }
  try {
    return parseJsonStrict(text, {
      maxBytes: MAX_FACILITATOR_RESPONSE_BYTES,
      maxDepth: 32,
      maxKeys: 1_000,
    });
  } catch {
    throw new FacilitatorResponseError(
      `Facilitator ${operation} response contains malformed JSON`,
    );
  }
}

function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { isValid?: unknown }).isValid === "boolean"
  );
}

function isSettleResponse(value: unknown): value is SettleResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.success === "boolean" &&
    typeof record.transaction === "string" &&
    typeof record.network === "string"
  );
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, [], 0);
      return;
    }
    const blocked = addresses.some(({ address }) => !isPublicIp(address));
    if (blocked || addresses.length === 0) {
      const failure = new Error(
        "Facilitator DNS resolved to a non-public address",
      ) as NodeJS.ErrnoException;
      failure.code = "EACCES";
      callback(failure, [], 0);
      return;
    }
    if (options.all) callback(null, addresses);
    else {
      const first = addresses[0];
      if (first === undefined) {
        callback(new Error("Facilitator DNS returned no address"), [], 0);
        return;
      }
      callback(null, first.address, first.family);
    }
  });
};

function assertPublicAddressLiteral(hostname: string): void {
  if (ipaddr.isValid(hostname) && !isPublicIp(hostname))
    throw new Error("Facilitator URL cannot target a non-public IP address");
}

function isPublicIp(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
