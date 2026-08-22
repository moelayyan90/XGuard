export const SETTLEMENT_TRUTH_EXTENSION = "settlement-truth" as const;
export const XGUARD_SAFE_SETTLEMENT_PROFILE = "xguard-safe-settlement/1" as const;

export type SettlementTruthState =
  | "FINALIZED"
  | "PENDING"
  | "PROVEN_FAILED"
  | "CONFLICT";

export interface SettlementTruthEvidence {
  network: string;
  transaction?: string;
  ledgerPosition?: string;
  asset?: string;
  payer?: string;
  payTo?: string;
  amount?: string;
  confirmations?: number;
  source?: string;
  observedAtEpochSeconds?: number;
  resolvedAtEpochSeconds?: number;
}

export interface SettlementTruthRecord {
  version: 1;
  logicalPaymentId: string;
  state: SettlementTruthState;
  railId: string;
  evidence: SettlementTruthEvidence;
}

export interface SettlementTruthPaymentIntent {
  protocol?: string;
  protocolVersion?: number;
  scheme?: string;
  network: string;
  payer?: string;
  payTo: string;
  asset: string;
  amount: string;
  authorizationId: string;
  validAfterEpochSeconds?: number;
  validBeforeEpochSeconds?: number;
  resource?: string;
}

export interface SettlementTruthSubmissionEvidence {
  logicalPaymentId: string;
  railId: string;
  submittedAtEpochSeconds: number;
  downstreamRoute?: string;
  transaction?: string;
}

export interface SettlementTruthRailPrincipal {
  railId: string;
  displayName?: string;
}

/**
 * Transport-neutral contract for payment-rail settlement truth.
 *
 * Implementations must preserve the original buyer-authorized payment and must
 * not create a second value-moving submission merely to resolve uncertainty.
 */
export interface SettlementTruthAdapter {
  identifyRailPrincipal(request: unknown): Promise<SettlementTruthRailPrincipal>;
  prepare(
    principal: SettlementTruthRailPrincipal,
    intent: SettlementTruthPaymentIntent,
  ): Promise<{ logicalPaymentId: string }>;
  markSubmissionBoundary(
    evidence: SettlementTruthSubmissionEvidence,
  ): Promise<void>;
  resolve(
    principal: SettlementTruthRailPrincipal,
    logicalPaymentId: string,
  ): Promise<SettlementTruthRecord>;
  getTruth(
    principal: SettlementTruthRailPrincipal,
    logicalPaymentId: string,
  ): Promise<SettlementTruthRecord | null>;
}

export function isFinalSettlementTruth(
  state: SettlementTruthState,
): state is "FINALIZED" | "PROVEN_FAILED" | "CONFLICT" {
  return state !== "PENDING";
}

export function allowsAutomaticResubmission(state: SettlementTruthState): boolean {
  // STS intentionally does not grant resubmission authority for CONFLICT.
  return state === "PROVEN_FAILED";
}
