export type XGuardBatchExecutionPolicy =
  | "ATOMIC_ONCHAIN"
  | "PLATFORM_SPLIT"
  | "COORDINATED_CHILD_PAYMENTS";

export type XGuardBatchAtomicityPolicy =
  | "ALL_OR_NOTHING"
  | "BEST_EFFORT"
  | "GROUP_ATOMIC";

export interface XGuardPaymentClaim {
  claimId: string;
  beneficiary: string;
  amount: string;
  currency: string;
  rail: string;
  destination: string;
  reference: string;
  validBefore: string;
  evidence?: string;
  groupId?: string;
  mandatory?: boolean;
}

export interface XGuardBatchTotal {
  currency: string;
  amount: string;
}

export interface XGuardBatchFee {
  recipient: string;
  amount: string;
  currency: string;
  label: string;
}

export interface XGuardBatchPaymentIntent {
  version: "xguard-batch-intent/1";
  batchIntentId: string;
  payer?: string;
  claims: XGuardPaymentClaim[];
  totals: XGuardBatchTotal[];
  fees?: XGuardBatchFee[];
  executionPolicy: XGuardBatchExecutionPolicy;
  atomicityPolicy: XGuardBatchAtomicityPolicy;
  validBefore: string;
  nonce: string;
  claimsRoot: string;
  payerAuthorization?: string;
}

export type XGuardChildPaymentStatus =
  | "RESERVED"
  | "PAID"
  | "PENDING"
  | "FAILED"
  | "REFUNDED";

export interface XGuardBatchReceiptItem {
  claimId: string;
  status: XGuardChildPaymentStatus;
  providerReference?: string;
  settlementEvidence?: string[];
}

export interface XGuardBatchReceipt {
  version: "xguard-batch-receipt/1";
  batchIntentId: string;
  claimsRoot: string;
  items: XGuardBatchReceiptItem[];
  createdAt: string;
}
