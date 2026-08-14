export type XGuardErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "UNSUPPORTED"
  | "PAYMENT_CONFLICT"
  | "INSUFFICIENT_SERVICE_BALANCE"
  | "SETTLEMENT_IN_PROGRESS"
  | "SETTLEMENT_AMBIGUOUS"
  | "FACILITATOR_UNAVAILABLE"
  | "MAINNET_DISABLED"
  | "INTERNAL_ERROR";

export class XGuardError extends Error {
  public constructor(
    public readonly code: XGuardErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "XGuardError";
  }
}

export class AmbiguousSettlementError extends XGuardError {
  public constructor(
    message = "Settlement outcome is ambiguous; automatic retry is blocked",
  ) {
    super("SETTLEMENT_AMBIGUOUS", message, 409, false);
    this.name = "AmbiguousSettlementError";
  }
}
