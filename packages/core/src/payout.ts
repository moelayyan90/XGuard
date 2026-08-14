import type { FinancialReport } from "./store.js";

export interface PayoutSafetySignals {
  destinationVerified: boolean;
  kycComplete: boolean;
  providerAuthorized: boolean;
  availableBalanceCertain: boolean;
  reconciliationConsistent: boolean;
  providerOperational: boolean;
  previousPayoutUnambiguous: boolean;
  fundsFinal: boolean;
}

export interface PayoutPolicyConfig {
  enabled: boolean;
  minimumPayoutMicroUsd: bigint;
  providerMinimumMicroUsd: bigint;
  providerFeeMicroUsd: bigint;
}

export type PayoutDecision =
  | { state: "DISABLED"; reasons: string[]; amountMicroUsd: 0n }
  | { state: "BLOCKED"; reasons: string[]; amountMicroUsd: 0n }
  | { state: "BELOW_THRESHOLD"; reasons: string[]; amountMicroUsd: 0n }
  | {
      state: "READY";
      reasons: [];
      amountMicroUsd: bigint;
      providerFeeMicroUsd: bigint;
      grossCashRequirementMicroUsd: bigint;
    };

export function evaluateOwnerPayout(
  report: FinancialReport,
  safety: PayoutSafetySignals,
  config: PayoutPolicyConfig,
): PayoutDecision {
  if (!config.enabled)
    return {
      state: "DISABLED",
      reasons: ["automatic payout is disabled"],
      amountMicroUsd: 0n,
    };
  if (
    config.minimumPayoutMicroUsd <= 0n ||
    config.providerMinimumMicroUsd < 0n ||
    config.providerFeeMicroUsd < 0n
  ) {
    throw new RangeError("Payout policy monetary values are invalid");
  }
  const reasons: string[] = [];
  if (!safety.destinationVerified) reasons.push("destination_unverified");
  if (!safety.kycComplete) reasons.push("kyc_incomplete");
  if (!safety.providerAuthorized) reasons.push("provider_not_authorized");
  if (!safety.availableBalanceCertain)
    reasons.push("available_balance_uncertain");
  if (!safety.reconciliationConsistent)
    reasons.push("reconciliation_inconsistent");
  if (!safety.providerOperational) reasons.push("provider_incident");
  if (!safety.previousPayoutUnambiguous)
    reasons.push("previous_payout_ambiguous");
  if (!safety.fundsFinal) reasons.push("funds_not_final");
  if (report.ambiguousSettlementCount > 0n)
    reasons.push("ambiguous_settlements_open");
  if (report.unpaidOperatingLiabilitiesMicroUsd > 0n)
    reasons.push("operating_liabilities_unpaid");
  if (report.operatingReserveMicroUsd < report.requiredOperatingReserveMicroUsd)
    reasons.push("operating_reserve_underfunded");
  if (reasons.length > 0)
    return { state: "BLOCKED", reasons, amountMicroUsd: 0n };

  const threshold =
    config.minimumPayoutMicroUsd > config.providerMinimumMicroUsd
      ? config.minimumPayoutMicroUsd
      : config.providerMinimumMicroUsd;
  if (
    report.ownerDistributableMicroUsd <
    threshold + config.providerFeeMicroUsd
  ) {
    return {
      state: "BELOW_THRESHOLD",
      reasons: ["distributable_profit_below_payout_threshold_and_fee"],
      amountMicroUsd: 0n,
    };
  }
  return {
    state: "READY",
    reasons: [],
    amountMicroUsd:
      report.ownerDistributableMicroUsd - config.providerFeeMicroUsd,
    providerFeeMicroUsd: config.providerFeeMicroUsd,
    grossCashRequirementMicroUsd: report.ownerDistributableMicroUsd,
  };
}
