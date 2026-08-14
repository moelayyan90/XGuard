import { XGuardError } from "./errors.js";

export const MICRO_USD_SCALE = 6;
export const DEFAULT_XGUARD_FEE_MICRO_USD = 2_000n;
export const DEFAULT_MIN_RESERVE_MICRO_USD = 25_000_000n;

export function parseUnsignedInteger(value: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be an unsigned base-10 integer string`,
      400,
    );
  }
  return BigInt(value);
}

export function parseMicroUsd(value: string, field = "amount"): bigint {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value);
  if (!match) {
    throw new XGuardError(
      "BAD_REQUEST",
      `${field} must be a non-negative USD decimal with at most six places`,
      400,
    );
  }
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(MICRO_USD_SCALE, "0"));
  return whole * 1_000_000n + fraction;
}

export function formatMicroUsd(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export function percentageOf(value: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError("percent must be an integer from 0 through 100");
  }
  return (value * BigInt(percent)) / 100n;
}

export interface UnitEconomics {
  feeMicroUsd: bigint;
  downstreamCostMicroUsd: bigint | null;
  variableInfrastructureCostMicroUsd: bigint | null;
  contributionMicroUsd: bigint | null;
}

export function calculateUnitEconomics(
  feeMicroUsd: bigint,
  downstreamCostMicroUsd: bigint | null,
  variableInfrastructureCostMicroUsd: bigint | null,
): UnitEconomics {
  if (
    feeMicroUsd < 0n ||
    (downstreamCostMicroUsd !== null && downstreamCostMicroUsd < 0n) ||
    (variableInfrastructureCostMicroUsd !== null &&
      variableInfrastructureCostMicroUsd < 0n)
  ) {
    throw new RangeError("unit economics inputs cannot be negative");
  }
  const contributionMicroUsd =
    downstreamCostMicroUsd === null ||
    variableInfrastructureCostMicroUsd === null
      ? null
      : feeMicroUsd -
        downstreamCostMicroUsd -
        variableInfrastructureCostMicroUsd;
  return {
    feeMicroUsd,
    downstreamCostMicroUsd,
    variableInfrastructureCostMicroUsd,
    contributionMicroUsd,
  };
}
