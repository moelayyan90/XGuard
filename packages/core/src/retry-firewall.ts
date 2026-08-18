export type XGuardPaymentOutcome =
  | "FINALIZED"
  | "PROVEN_FAILED"
  | "AMBIGUOUS"
  | "MANUAL_REVIEW";

export type XGuardRetryDecision = "ALLOW_ONCE" | "DENY" | "WAIT";

export type XGuardMoneyOperation =
  | "AUTHORIZE"
  | "CAPTURE"
  | "SALE"
  | "REFUND"
  | "PAYOUT"
  | "SETTLE";

export interface XGuardExecutionLease {
  version: "xguard-execution-lease/1";
  logicalPaymentId: string;
  attemptId: string;
  rail: string;
  operation: XGuardMoneyOperation;
  amount: string;
  currency: string;
  expiresAt: string;
  nonce: string;
}

export interface XGuardRetryPermit {
  version: "xguard-retry-permit/1";
  permitId: string;
  logicalPaymentId: string;
  priorAttemptId: string;
  decision: XGuardRetryDecision;
  priorOutcome?: XGuardPaymentOutcome;
  operation: XGuardMoneyOperation;
  rail: string;
  amount: string;
  currency: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  reason: string;
  evidenceRefs?: string[];
  signature?: string;
}

export interface XGuardRetryFirewall {
  acquireInitialLease(input: {
    logicalPaymentId: string;
    rail: string;
    operation: XGuardMoneyOperation;
    amount: string;
    currency: string;
  }): Promise<XGuardExecutionLease>;

  markSubmitted(input: {
    logicalPaymentId: string;
    attemptId: string;
    railReference?: string;
  }): Promise<void>;

  observeOutcome(input: {
    logicalPaymentId: string;
    attemptId: string;
    outcome: XGuardPaymentOutcome;
    evidenceRefs?: string[];
  }): Promise<void>;

  requestRetryPermit(input: {
    logicalPaymentId: string;
    priorAttemptId: string;
    nextRail: string;
    operation: XGuardMoneyOperation;
    amount: string;
    currency: string;
  }): Promise<XGuardRetryPermit>;

  consumeRetryPermit(permit: XGuardRetryPermit): Promise<XGuardExecutionLease>;
}
