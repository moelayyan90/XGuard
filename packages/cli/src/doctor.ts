import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { validatePaymentIdentifier } from "@x402/extensions/payment-identifier";
import { inspectProject, validateGatewayUrl } from "./migration.js";

const ALPHA_NETWORK = "eip155:84532";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const MAX_UINT256 = (1n << 256n) - 1n;

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface GatewayKind {
  x402Version?: unknown;
  scheme?: unknown;
  network?: unknown;
  extra?: unknown;
}

export async function runDoctor(
  projectRootInput: string,
  endpoint?: string,
): Promise<DoctorCheck[]> {
  const projectRoot = resolve(projectRootInput);
  const checks: DoctorCheck[] = [];
  let inspection;
  try {
    inspection = await inspectProject(projectRoot);
  } catch (error) {
    return [
      {
        name: "project",
        status: "FAIL",
        detail:
          error instanceof Error ? error.message : "Could not inspect project",
      },
    ];
  }
  const packages = Object.entries(inspection.x402Packages);
  checks.push({
    name: "x402 dependency",
    status: packages.length > 0 ? "PASS" : "FAIL",
    detail:
      packages.length > 0
        ? packages.map(([name, version]) => `${name}@${version}`).join(", ")
        : "No x402 dependency detected",
  });
  const nonV2 = packages.filter(([_name, version]) => !declaresX402V2(version));
  checks.push({
    name: "protocol version",
    status:
      inspection.v1References.length === 0 && nonV2.length === 0
        ? "PASS"
        : "FAIL",
    detail:
      inspection.v1References.length > 0
        ? `Legacy X-PAYMENT headers in ${inspection.v1References.join(", ")}`
        : nonV2.length > 0
          ? "One or more packages are not pinned to x402 v2"
          : "x402 v2 conventions detected",
  });
  checks.push({
    name: "migration target",
    status:
      inspection.migrationBlockers.length > 0
        ? "WARN"
        : inspection.migratable.length > 0
          ? "PASS"
          : "WARN",
    detail:
      inspection.migrationBlockers.length > 0
        ? `${inspection.migrationBlockers.length} facilitator configuration file(s) require manual auth-safe migration`
        : inspection.migratable.length > 0
          ? `${inspection.migratable.length} facilitator configuration file(s) can be migrated conservatively`
          : "No literal HTTPFacilitatorClient URL was found",
  });

  let configuredUrl: string | undefined;
  try {
    const config = JSON.parse(
      await readFile(join(projectRoot, "xguard.config.json"), "utf8"),
    ) as { gatewayUrl?: string; protocolVersion?: number };
    configuredUrl = config.gatewayUrl;
    checks.push({
      name: "XGuard configuration",
      status:
        config.protocolVersion === 2 && configuredUrl !== undefined
          ? "PASS"
          : "FAIL",
      detail: configuredUrl ?? "Configuration is incomplete",
    });
  } catch {
    checks.push({
      name: "XGuard configuration",
      status: "WARN",
      detail: "xguard.config.json is not installed",
    });
  }

  const gateway = process.env.XGUARD_URL ?? configuredUrl;
  let gatewayKinds: GatewayKind[] | null = null;
  if (gateway !== undefined) {
    const probe = await probeGateway(gateway);
    checks.push(...probe.checks);
    gatewayKinds = probe.kinds;
  } else
    checks.push({
      name: "gateway connectivity",
      status: "WARN",
      detail: "Set XGUARD_URL or run xguard init",
    });
  if (endpoint !== undefined)
    checks.push(...(await probePaidEndpoint(endpoint, gatewayKinds)));
  return checks;
}

function declaresX402V2(version: string): boolean {
  const normalized = version.trim().replace(/^workspace:/, "");
  return (
    /^(?:\^|~)?2(?:\.\d+|\.x)*(?:$|[-+])/.test(normalized) ||
    /^>=?2(?:\.\d+){0,2}\s+<3(?:\.0+){0,2}$/.test(normalized)
  );
}

async function probeGateway(
  url: string,
): Promise<{ checks: DoctorCheck[]; kinds: GatewayKind[] }> {
  try {
    const base = validateGatewayUrl(url);
    const started = performance.now();
    const [health, supported] = await Promise.all([
      fetch(`${base}/healthz`, {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      }),
      fetch(`${base}/supported`, {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      }),
    ]);
    const latency = Math.round(performance.now() - started);
    const capabilities = (await supported.json()) as { kinds?: GatewayKind[] };
    const advertisedKinds = Array.isArray(capabilities.kinds)
      ? capabilities.kinds
      : [];
    const kinds = advertisedKinds.filter(isAlphaGatewayKind);
    return {
      kinds,
      checks: [
        {
          name: "gateway connectivity",
          status: health.ok && supported.ok ? "PASS" : "FAIL",
          detail: `${health.status}/${supported.status}, ${latency}ms`,
        },
        {
          name: "facilitator compatibility",
          status: kinds.length > 0 ? "PASS" : "WARN",
          detail:
            kinds.length > 0
              ? `${kinds.length} advertised route(s) match the XGuard alpha matrix (v2 exact authorization on ${ALPHA_NETWORK})`
              : `No advertised route matches the XGuard alpha matrix (${ALPHA_NETWORK} only)`,
        },
      ],
    };
  } catch (error) {
    return {
      kinds: [],
      checks: [
        {
          name: "gateway connectivity",
          status: "FAIL",
          detail:
            error instanceof Error ? error.message : "Gateway probe failed",
        },
      ],
    };
  }
}

async function probePaidEndpoint(
  endpoint: string,
  gatewayKinds: GatewayKind[] | null,
): Promise<DoctorCheck[]> {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1"
    )
      throw new Error("Endpoint must use HTTPS");
    const started = performance.now();
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    const latency = Math.round(performance.now() - started);
    const required = response.headers.get("payment-required");
    if (response.status !== 402 || required === null) {
      return [
        {
          name: "paid endpoint",
          status: "FAIL",
          detail: `Expected 402 plus PAYMENT-REQUIRED; received ${response.status} in ${latency}ms`,
        },
      ];
    }
    if (Buffer.byteLength(required, "utf8") > 32 * 1024)
      return [
        {
          name: "paid endpoint",
          status: "FAIL",
          detail: "PAYMENT-REQUIRED exceeds 32 KiB",
        },
      ];
    const paymentRequired = decodePaymentRequiredHeader(required);
    const v2Requirements = paymentRequired.accepts.filter(
      (item) => "amount" in item,
    );
    const compatibleKinds = v2Requirements.filter((item) => {
      if (!alphaRequirementCompatible(item)) return false;
      if (gatewayKinds === null) return item.network === ALPHA_NETWORK;
      return gatewayKinds.some(
        (kind) =>
          kind.x402Version === 2 &&
          kind.scheme === item.scheme &&
          kind.network === item.network &&
          mechanismCompatible(kind.extra, item.extra),
      );
    });
    const cacheControl =
      response.headers.get("cache-control")?.toLowerCase() ?? "";
    const unsafeCache =
      cacheControl.includes("public") || cacheControl.includes("s-maxage");
    const paymentIdentifierExtension =
      paymentRequired.extensions?.["payment-identifier"];
    const paymentIdentifierValid =
      paymentIdentifierExtension !== undefined &&
      validatePaymentIdentifier(paymentIdentifierExtension).valid;
    const bazaarExtension = paymentRequired.extensions?.bazaar;
    const bazaarValid =
      bazaarExtension !== undefined &&
      validateDiscoveryExtension(
        bazaarExtension as Parameters<typeof validateDiscoveryExtension>[0],
      ).valid;
    const offerReceiptPresent =
      paymentRequired.extensions?.["offer-receipt"] !== undefined;
    return [
      {
        name: "paid endpoint",
        status: paymentRequired.x402Version === 2 ? "PASS" : "FAIL",
        detail: `x402 v${paymentRequired.x402Version}, ${latency}ms`,
      },
      {
        name: "XGuard compatibility",
        status: compatibleKinds.length > 0 ? "PASS" : "FAIL",
        detail:
          compatibleKinds.length > 0
            ? `${compatibleKinds.length} exact EVM option(s) can use this XGuard release`
            : `No structurally valid v2 exact authorization option on ${ALPHA_NETWORK} matches this XGuard alpha`,
      },
      {
        name: "Payment Identifier",
        status:
          paymentIdentifierExtension === undefined
            ? "WARN"
            : paymentIdentifierValid
              ? "PASS"
              : "FAIL",
        detail:
          paymentIdentifierExtension === undefined
            ? "Not advertised"
            : paymentIdentifierValid
              ? "Valid declaration detected; resource-response caching behavior was not exercised"
              : "Malformed Payment Identifier declaration",
      },
      {
        name: "duplicate-settlement risk",
        status: "WARN",
        detail: paymentIdentifierValid
          ? "A declaration does not prove cached resource responses; exercise an identical paid retry end-to-end. XGuard independently suppresses duplicate settlement."
          : "Resource-response idempotency is unproven; XGuard independently suppresses duplicate settlement.",
      },
      {
        name: "Bazaar metadata",
        status:
          bazaarExtension === undefined
            ? "WARN"
            : bazaarValid
              ? "PASS"
              : "FAIL",
        detail:
          bazaarExtension === undefined
            ? "Not advertised"
            : bazaarValid
              ? "Valid metadata declaration; facilitator catalog ingestion and public listing were not verified"
              : "Malformed Bazaar metadata declaration",
      },
      {
        name: "Signed Offers",
        status: "WARN",
        detail: !offerReceiptPresent
          ? "Signed offer/receipt evidence is not advertised"
          : "Extension data is present; signatures and successful receipt issuance were not verified",
      },
      {
        name: "402 cache safety",
        status: unsafeCache ? "FAIL" : "PASS",
        detail: unsafeCache
          ? `Unsafe shared-cache directive: ${cacheControl}`
          : cacheControl || "No shared-cache directive observed",
      },
    ];
  } catch (error) {
    return [
      {
        name: "paid endpoint",
        status: "FAIL",
        detail:
          error instanceof Error ? error.message : "Endpoint probe failed",
      },
    ];
  }
}

function mechanismCompatible(
  capability: unknown,
  required: Record<string, unknown> | null | undefined,
): boolean {
  if (required === null || required === undefined) return true;
  const extra =
    typeof capability === "object" &&
    capability !== null &&
    !Array.isArray(capability)
      ? (capability as Record<string, unknown>)
      : null;
  for (const key of ["assetTransferMethod", "paymentFlow"]) {
    if (
      required[key] !== undefined &&
      extra?.[key] !== undefined &&
      extra[key] !== required[key]
    )
      return false;
  }
  return true;
}

function isAlphaGatewayKind(kind: GatewayKind): boolean {
  if (
    kind.x402Version !== 2 ||
    kind.scheme !== "exact" ||
    kind.network !== ALPHA_NETWORK
  )
    return false;
  if (
    kind.extra !== undefined &&
    (typeof kind.extra !== "object" ||
      kind.extra === null ||
      Array.isArray(kind.extra))
  )
    return false;
  const extra = kind.extra as Record<string, unknown> | undefined;
  return (
    (extra?.assetTransferMethod === undefined ||
      extra.assetTransferMethod === "eip3009" ||
      extra.assetTransferMethod === "permit2") &&
    (extra?.paymentFlow === undefined || extra.paymentFlow === "authorization")
  );
}

function alphaRequirementCompatible(item: PaymentRequirements): boolean {
  if (
    item.scheme !== "exact" ||
    item.network !== ALPHA_NETWORK ||
    !EVM_ADDRESS.test(item.asset) ||
    !EVM_ADDRESS.test(item.payTo) ||
    !UNSIGNED_INTEGER.test(item.amount) ||
    BigInt(item.amount) <= 0n ||
    BigInt(item.amount) > MAX_UINT256 ||
    !Number.isSafeInteger(item.maxTimeoutSeconds) ||
    item.maxTimeoutSeconds <= 0 ||
    item.maxTimeoutSeconds > 86_400
  )
    return false;
  if (
    item.extra !== undefined &&
    (item.extra === null || Array.isArray(item.extra))
  )
    return false;
  const method = item.extra?.assetTransferMethod;
  const flow = item.extra?.paymentFlow;
  if (flow !== undefined && flow !== "authorization") return false;
  if (method !== undefined && method !== "eip3009" && method !== "permit2")
    return false;
  return (
    method === "permit2" ||
    (typeof item.extra?.name === "string" &&
      item.extra.name.length > 0 &&
      typeof item.extra.version === "string" &&
      item.extra.version.length > 0)
  );
}
