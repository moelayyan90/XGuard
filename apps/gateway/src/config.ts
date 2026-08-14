import { randomBytes } from "node:crypto";
import { parseMicroUsd, parseUnsignedInteger } from "@xguard/core";

export interface GatewayConfig {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  feeMicroUsd: bigint;
  mainnetEnabled: boolean;
  supportedNetworks: ReadonlySet<string>;
  apiKeyPepper: string;
  adminToken: string | null;
  publicTestnet: boolean;
  reservePercent: number;
  minimumReserveMicroUsd: bigint;
  lowBalanceThresholdMicroUsd: bigint;
  facilitatorDefinitions: {
    id: string;
    url: string;
    downstreamCostMicroUsd: bigint | null;
    timeoutMs: number;
    authToken: string | null;
    exactEvmTransferMethods: readonly ("eip3009" | "permit2")[];
  }[];
}

interface FacilitatorEnvironment {
  id?: unknown;
  url?: unknown;
  downstreamCostUsd?: unknown;
  timeoutMs?: unknown;
  authTokenEnv?: unknown;
  exactEvmTransferMethods?: unknown;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const port = parseSafeInteger(environment.PORT ?? "8787", "PORT", 1, 65_535);
  const reservePercent = parseSafeInteger(
    environment.OPERATING_RESERVE_PERCENT ?? "20",
    "OPERATING_RESERVE_PERCENT",
    0,
    100,
  );
  const mainnetEnabled = environment.XGUARD_MAINNET_ENABLED === "true";
  if (mainnetEnabled) {
    throw new Error(
      "Mainnet is compile-time disabled in this alpha; environment variables cannot override the release gate",
    );
  }
  if (
    (environment.NODE_ENV === "production" ||
      environment.XGUARD_DEMO_API_KEY !== undefined) &&
    environment.XGUARD_API_KEY_PEPPER === undefined
  ) {
    throw new Error(
      "XGUARD_API_KEY_PEPPER is required for production or persistent API-key authentication",
    );
  }
  const supportedNetworks = new Set(
    (environment.XGUARD_SUPPORTED_NETWORKS ?? "eip155:84532")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const facilitatorDefinitions = parseFacilitators(environment);
  const adminToken = environment.XGUARD_ADMIN_TOKEN;
  if (adminToken !== undefined && adminToken.length < 32)
    throw new Error("XGUARD_ADMIN_TOKEN must contain at least 32 characters");
  return {
    port,
    databasePath: environment.XGUARD_DATABASE_PATH ?? "./xguard.db",
    publicBaseUrl:
      environment.XGUARD_PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    feeMicroUsd:
      environment.XGUARD_FEE_MICRO_USD === undefined
        ? 2_000n
        : parseUnsignedInteger(
            environment.XGUARD_FEE_MICRO_USD,
            "XGUARD_FEE_MICRO_USD",
          ),
    mainnetEnabled,
    supportedNetworks,
    apiKeyPepper:
      environment.XGUARD_API_KEY_PEPPER ?? randomBytes(32).toString("hex"),
    adminToken: adminToken ?? null,
    publicTestnet: environment.XGUARD_PUBLIC_TESTNET !== "false",
    reservePercent,
    minimumReserveMicroUsd:
      environment.MIN_OPERATING_RESERVE_MICRO_USD === undefined
        ? 25_000_000n
        : parseUnsignedInteger(
            environment.MIN_OPERATING_RESERVE_MICRO_USD,
            "MIN_OPERATING_RESERVE_MICRO_USD",
          ),
    lowBalanceThresholdMicroUsd:
      environment.LOW_BALANCE_THRESHOLD_MICRO_USD === undefined
        ? 20_000n
        : parseUnsignedInteger(
            environment.LOW_BALANCE_THRESHOLD_MICRO_USD,
            "LOW_BALANCE_THRESHOLD_MICRO_USD",
          ),
    facilitatorDefinitions,
  };
}

function parseFacilitators(
  environment: NodeJS.ProcessEnv,
): GatewayConfig["facilitatorDefinitions"] {
  if (environment.XGUARD_FACILITATORS_JSON === undefined) {
    return [
      {
        id: "x402-public-testnet",
        url: "https://x402.org/facilitator",
        downstreamCostMicroUsd: 0n,
        timeoutMs: 10_000,
        authToken: null,
        exactEvmTransferMethods: ["eip3009", "permit2"],
      },
    ];
  }
  const parsed = JSON.parse(environment.XGUARD_FACILITATORS_JSON) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("XGUARD_FACILITATORS_JSON must be a non-empty array");
  return parsed.map((entry, index) => {
    const item = entry as FacilitatorEnvironment;
    if (
      typeof item.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(item.id)
    )
      throw new Error(`Facilitator ${index} has an invalid id`);
    if (typeof item.url !== "string")
      throw new Error(`Facilitator ${index} is missing a URL`);
    const url = new URL(item.url);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      throw new Error(
        `Facilitator ${index} URL must be an HTTPS origin/path without credentials or query data`,
      );
    const cost =
      item.downstreamCostUsd === null || item.downstreamCostUsd === undefined
        ? null
        : typeof item.downstreamCostUsd === "string"
          ? parseMicroUsd(
              item.downstreamCostUsd,
              `facilitator ${index} downstreamCostUsd`,
            )
          : (() => {
              throw new Error("downstreamCostUsd must be a string or null");
            })();
    const authTokenEnv = item.authTokenEnv;
    if (authTokenEnv !== undefined && typeof authTokenEnv !== "string")
      throw new Error(
        "authTokenEnv must be a secret environment variable name",
      );
    const transferMethods = item.exactEvmTransferMethods ?? ["eip3009"];
    if (
      !Array.isArray(transferMethods) ||
      transferMethods.length < 1 ||
      !transferMethods.every(
        (method) => method === "eip3009" || method === "permit2",
      )
    )
      throw new Error(
        `Facilitator ${index} exactEvmTransferMethods must explicitly list eip3009 and/or permit2`,
      );
    return {
      id: item.id,
      url: url.toString().replace(/\/$/, ""),
      downstreamCostMicroUsd: cost,
      timeoutMs:
        item.timeoutMs === undefined
          ? 10_000
          : parseSafeInteger(
              String(item.timeoutMs),
              `facilitator ${index} timeoutMs`,
              250,
              60_000,
            ),
      authToken:
        typeof authTokenEnv === "string"
          ? (environment[authTokenEnv] ?? null)
          : null,
      exactEvmTransferMethods: [
        ...new Set(transferMethods as ("eip3009" | "permit2")[]),
      ],
    };
  });
}

function parseSafeInteger(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  return parsed;
}
