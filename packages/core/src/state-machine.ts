import { XGuardError } from "./errors.js";

export const PAYMENT_STATES = [
  "RECEIVED",
  "VALIDATING",
  "VERIFIED",
  "SETTLEMENT_IN_PROGRESS",
  "SETTLED",
  "FAILED_DEFINITIVE",
  "AMBIGUOUS",
  "QUARANTINED",
  "EXPIRED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

const TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  RECEIVED: ["VALIDATING", "FAILED_DEFINITIVE", "QUARANTINED"],
  VALIDATING: ["VERIFIED", "FAILED_DEFINITIVE", "QUARANTINED"],
  VERIFIED: ["SETTLEMENT_IN_PROGRESS", "EXPIRED", "QUARANTINED"],
  SETTLEMENT_IN_PROGRESS: [
    "SETTLED",
    "FAILED_DEFINITIVE",
    "AMBIGUOUS",
    "QUARANTINED",
  ],
  SETTLED: [],
  FAILED_DEFINITIVE: [],
  AMBIGUOUS: ["SETTLED", "FAILED_DEFINITIVE", "QUARANTINED"],
  QUARANTINED: [],
  EXPIRED: [],
};

export function assertPaymentTransition(
  from: PaymentState,
  to: PaymentState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new XGuardError(
      "INTERNAL_ERROR",
      `Invalid payment state transition ${from} -> ${to}`,
      500,
    );
  }
}

export const ATTEMPT_STATES = [
  "OUTBOUND_PREPARED",
  "OUTBOUND_STARTED",
  "RESPONSE_RECEIVED",
  "FINALIZED",
  "REJECTED_NO_COMMIT",
  "PENDING",
  "AMBIGUOUS",
  "QUARANTINED",
] as const;

export type SettlementAttemptState = (typeof ATTEMPT_STATES)[number];
