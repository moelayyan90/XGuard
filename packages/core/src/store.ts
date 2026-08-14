import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { SettleResponse, VerifyResponse } from "@x402/core/types";
import { XGuardError } from "./errors.js";
import {
  DEFAULT_MIN_RESERVE_MICRO_USD,
  parseUnsignedInteger,
  percentageOf,
} from "./money.js";
import {
  evaluateOwnerPayout,
  type PayoutPolicyConfig,
  type PayoutSafetySignals,
} from "./payout.js";
import type { PaymentState } from "./state-machine.js";

const EVM_TRANSACTION = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface MerchantRecord {
  id: string;
  name: string;
  availableBalanceMicroUsd: bigint;
  active: boolean;
}

export interface PrepareSettlementInput {
  logicalPaymentKey: string;
  settlementStepKey: string;
  requestFingerprint: string;
  paymentIdentifier: string | null;
  paymentIdentifierExpiresAtSeconds: bigint;
  merchantId: string;
  network: string;
  scheme: string;
  payer: string;
  asset: string;
  payTo: string;
  amountAtomic: string;
  expiresAtSeconds: bigint;
  testnet: boolean;
  feeMicroUsd: bigint;
}

export type PrepareSettlementResult =
  | { kind: "OWNER"; paymentKey: string }
  | { kind: "CACHED"; paymentKey: string; response: SettleResponse }
  | { kind: "IN_PROGRESS"; paymentKey: string }
  | { kind: "AMBIGUOUS"; paymentKey: string }
  | { kind: "FAILED"; paymentKey: string; response: SettleResponse | null };

export interface FinancialReport {
  transactionCount: bigint;
  billableSettlementCount: bigint;
  ambiguousSettlementCount: bigint;
  grossRevenueMicroUsd: bigint;
  operatingCostsMicroUsd: bigint;
  contributionMicroUsd: bigint;
  treasuryAssetMicroUsd: bigint;
  customerLiabilitiesMicroUsd: bigint;
  unpaidOperatingLiabilitiesMicroUsd: bigint;
  availableTreasuryMicroUsd: bigint;
  requiredOperatingReserveMicroUsd: bigint;
  operatingReserveMicroUsd: bigint;
  ownerDistributableMicroUsd: bigint;
  pendingOwnerPayoutMicroUsd: bigint;
  paidOwnerProfitMicroUsd: bigint;
}

export interface StoredPayment {
  logicalPaymentKey: string;
  merchantId: string;
  requestFingerprint: string;
  state: PaymentState;
  network: string;
  payer: string;
  asset: string;
  payTo: string;
  amountAtomic: string;
  testnet: boolean;
  feeMicroUsd: bigint;
  facilitatorId: string | null;
  response: SettleResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface DurableSettlementEvidence {
  source: "FACILITATOR_TESTNET" | "INDEPENDENT_CHAIN";
  finalized: true;
  confirmations: number;
  network: string;
  transaction: string;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  observedAt: string;
  evidenceReference: string;
}

export interface SettlementFailureEvidence {
  source: "INDEPENDENT_CHAIN";
  network: string;
  paymentKey: string;
  authorizationUnused: true;
  observedAt: string;
  evidenceReference: string;
}

export interface DefinitiveFacilitatorRejectionEvidence {
  source: "FACILITATOR_RESPONSE";
  facilitatorId: string;
  observedAt: string;
  evidenceReference: string;
}

export interface PayoutTransferEvidence {
  provider: string;
  providerReference: string;
  status: "FINAL_CREDIT" | "FINAL_RETURN";
  destinationAmountMicroUsd: bigint;
  providerFeeMicroUsd: bigint;
  observedAt: string;
  evidenceReference: string;
}

export interface PayoutPolicySnapshot extends PayoutPolicyConfig {
  reservePercent: number;
  minimumReserveMicroUsd: bigint;
}

export interface PayoutRecord {
  id: string;
  provider: string;
  providerIdempotencyKey: string;
  providerReference: string | null;
  /** Amount intended to reach the owner destination, excluding provider fees. */
  amountMicroUsd: bigint;
  providerFeeMicroUsd: bigint;
  grossCashRequirementMicroUsd: bigint;
  safetySnapshot: Readonly<PayoutSafetySignals>;
  policySnapshot: Readonly<PayoutPolicySnapshot>;
  transferEvidence: Readonly<PayoutTransferEvidence> | null;
  state:
    | "PREPARED"
    | "PENDING"
    | "SUBMITTED"
    | "AMBIGUOUS"
    | "PAID"
    | "FAILED"
    | "RETURNED";
  createdAt: string;
  updatedAt: string;
}

export interface PrepareOwnerPayoutInput {
  provider: string;
  providerIdempotencyKey: string;
  policy: PayoutPolicyConfig;
  safety: PayoutSafetySignals;
  reservePercent?: number;
  minimumReserveMicroUsd?: bigint;
}

export interface OperatingExpenseRecord {
  id: string;
  paymentKey: string | null;
  category: string;
  amountMicroUsd: bigint;
  state: "ACCRUED" | "PAID" | "REVERSED";
  createdAt: string;
}

interface Row {
  [key: string]: unknown;
}

function bigintFrom(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^-?[0-9]+$/.test(value))
    return BigInt(value);
  throw new TypeError(
    `Expected an integer database value, got ${String(value)}`,
  );
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function payoutSafetySnapshotFromJson(value: unknown): PayoutSafetySignals {
  if (typeof value !== "string")
    throw new TypeError("Payout safety snapshot is not valid JSON text");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TypeError("Payout safety snapshot is not a JSON object");
  const snapshot = parsed as Record<string, unknown>;
  return {
    destinationVerified: snapshot.destinationVerified === true,
    kycComplete: snapshot.kycComplete === true,
    providerAuthorized: snapshot.providerAuthorized === true,
    availableBalanceCertain: snapshot.availableBalanceCertain === true,
    reconciliationConsistent: snapshot.reconciliationConsistent === true,
    providerOperational: snapshot.providerOperational === true,
    previousPayoutUnambiguous: snapshot.previousPayoutUnambiguous === true,
    fundsFinal: snapshot.fundsFinal === true,
  };
}

function payoutPolicySnapshotFromJson(value: unknown): PayoutPolicySnapshot {
  if (typeof value !== "string")
    throw new TypeError("Payout policy snapshot is not valid JSON text");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TypeError("Payout policy snapshot is not a JSON object");
  const snapshot = parsed as Record<string, unknown>;
  const monetary = (name: string): bigint => {
    const item = snapshot[name];
    if (typeof item !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(item))
      throw new TypeError(`Payout policy ${name} is invalid`);
    return BigInt(item);
  };
  if (
    typeof snapshot.enabled !== "boolean" ||
    !Number.isInteger(snapshot.reservePercent) ||
    (snapshot.reservePercent as number) < 0 ||
    (snapshot.reservePercent as number) > 100
  )
    throw new TypeError("Payout policy snapshot is invalid");
  return {
    enabled: snapshot.enabled,
    minimumPayoutMicroUsd: monetary("minimumPayoutMicroUsd"),
    providerMinimumMicroUsd: monetary("providerMinimumMicroUsd"),
    providerFeeMicroUsd: monetary("providerFeeMicroUsd"),
    reservePercent: snapshot.reservePercent as number,
    minimumReserveMicroUsd: monetary("minimumReserveMicroUsd"),
  };
}

function payoutTransferEvidenceFromJson(
  value: unknown,
): PayoutTransferEvidence | null {
  if (value === null) return null;
  if (typeof value !== "string")
    throw new TypeError("Payout transfer evidence is not valid JSON text");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TypeError("Payout transfer evidence is not a JSON object");
  const evidence = parsed as Record<string, unknown>;
  const monetary = (name: string): bigint => {
    const item = evidence[name];
    if (typeof item !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(item))
      throw new TypeError(`Payout evidence ${name} is invalid`);
    return BigInt(item);
  };
  if (
    typeof evidence.provider !== "string" ||
    typeof evidence.providerReference !== "string" ||
    (evidence.status !== "FINAL_CREDIT" &&
      evidence.status !== "FINAL_RETURN") ||
    typeof evidence.observedAt !== "string" ||
    typeof evidence.evidenceReference !== "string"
  )
    throw new TypeError("Payout transfer evidence is invalid");
  return {
    provider: evidence.provider,
    providerReference: evidence.providerReference,
    status: evidence.status,
    destinationAmountMicroUsd: monetary("destinationAmountMicroUsd"),
    providerFeeMicroUsd: monetary("providerFeeMicroUsd"),
    observedAt: evidence.observedAt,
    evidenceReference: evidence.evidenceReference,
  };
}

export class SqliteFinancialStore {
  private readonly database: DatabaseSync;

  public constructor(path = ":memory:") {
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  public close(): void {
    this.database.close();
  }

  public createMerchant(input: {
    id: string;
    name: string;
    apiKeyHash: string;
    openingBalanceMicroUsd?: bigint;
  }): void {
    const opening = input.openingBalanceMicroUsd ?? 0n;
    if (opening < 0n)
      throw new RangeError("Opening balance cannot be negative");
    this.transaction(() => {
      this.database
        .prepare(
          `
        INSERT INTO merchants (id, name, api_key_hash, available_balance_micro_usd, active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, api_key_hash = excluded.api_key_hash
      `,
        )
        .run(
          input.id,
          input.name,
          input.apiKeyHash,
          0n,
          new Date().toISOString(),
        );
      if (opening > 0n)
        this.creditMerchantInternal(input.id, opening, `opening:${input.id}`);
    });
  }

  public creditMerchant(
    merchantId: string,
    amountMicroUsd: bigint,
    externalReference: string,
  ): void {
    if (amountMicroUsd <= 0n)
      throw new RangeError("Credit amount must be positive");
    this.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT merchant_id,amount_micro_usd FROM top_ups WHERE external_reference=?",
        )
        .get(externalReference) as Row | undefined;
      if (existing !== undefined) {
        if (
          String(existing.merchant_id) !== merchantId ||
          bigintFrom(existing.amount_micro_usd) !== amountMicroUsd
        )
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Top-up reference was reused with different terms",
            409,
          );
        return;
      }
      const now = new Date().toISOString();
      this.creditMerchantInternal(
        merchantId,
        amountMicroUsd,
        externalReference,
      );
      this.database
        .prepare(
          "INSERT INTO top_ups(id,merchant_id,external_reference,amount_micro_usd,state,created_at) VALUES(?,?,?,?, 'FINAL',?)",
        )
        .run(randomUUID(), merchantId, externalReference, amountMicroUsd, now);
    });
  }

  public findMerchantByApiKeyHash(apiKeyHash: string): MerchantRecord | null {
    const statement = this.bigIntStatement(
      "SELECT id, name, available_balance_micro_usd, active FROM merchants WHERE api_key_hash = ?",
    );
    const row = statement.get(apiKeyHash) as Row | undefined;
    if (row === undefined) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      availableBalanceMicroUsd: bigintFrom(row.available_balance_micro_usd),
      active: bigintFrom(row.active) === 1n,
    };
  }

  public getMerchant(merchantId: string): MerchantRecord | null {
    const statement = this.bigIntStatement(
      "SELECT id, name, available_balance_micro_usd, active FROM merchants WHERE id = ?",
    );
    const row = statement.get(merchantId) as Row | undefined;
    if (row === undefined) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      availableBalanceMicroUsd: bigintFrom(row.available_balance_micro_usd),
      active: bigintFrom(row.active) === 1n,
    };
  }

  public recordVerification(input: {
    merchantId: string;
    logicalPaymentKey: string;
    facilitatorId: string;
    result: VerifyResponse;
    latencyMs: number;
  }): void {
    this.database
      .prepare(
        `
      INSERT INTO verification_attempts (id, merchant_id, logical_payment_key, facilitator_id, is_valid, latency_ms, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        randomUUID(),
        input.merchantId,
        input.logicalPaymentKey,
        input.facilitatorId,
        input.result.isValid ? 1 : 0,
        Math.round(input.latencyMs),
        jsonStringify(input.result),
        new Date().toISOString(),
      );
  }

  public prepareSettlement(
    input: PrepareSettlementInput,
  ): PrepareSettlementResult {
    if (
      input.scheme !== "exact" ||
      !input.network.startsWith("eip155:") ||
      !EVM_ADDRESS.test(input.payer) ||
      !EVM_ADDRESS.test(input.asset) ||
      !EVM_ADDRESS.test(input.payTo)
    )
      throw new XGuardError(
        "BAD_REQUEST",
        "Stored settlement identity is outside the supported exact EVM matrix",
        400,
      );
    parseUnsignedInteger(input.amountAtomic, "settlement.amountAtomic");
    return this.transaction(() => {
      const nowSeconds = BigInt(Math.floor(Date.now() / 1_000));
      if (input.paymentIdentifier !== null) {
        let identifier = this.bigIntStatement(
          `SELECT logical_payment_key,request_fingerprint,expires_at_seconds
           FROM payment_identifier_claims
           WHERE merchant_id=? AND payment_identifier=?`,
        ).get(input.merchantId, input.paymentIdentifier) as Row | undefined;
        if (
          identifier !== undefined &&
          bigintFrom(identifier.expires_at_seconds) <= nowSeconds
        ) {
          this.database
            .prepare(
              "DELETE FROM payment_identifier_claims WHERE merchant_id=? AND payment_identifier=? AND expires_at_seconds<=?",
            )
            .run(input.merchantId, input.paymentIdentifier, nowSeconds);
          identifier = undefined;
        }
        if (
          identifier !== undefined &&
          (identifier.logical_payment_key !== input.logicalPaymentKey ||
            identifier.request_fingerprint !== input.requestFingerprint)
        ) {
          this.securityEvent(
            "PAYMENT_IDENTIFIER_CONFLICT",
            input.merchantId,
            input.logicalPaymentKey,
          );
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Payment Identifier was reused with a different payment fingerprint",
            409,
          );
        }
      }

      if (input.paymentIdentifierExpiresAtSeconds <= nowSeconds)
        throw new XGuardError(
          "BAD_REQUEST",
          "Payment Identifier claim would already be expired",
          400,
        );

      const existing = this.readPaymentRow(input.logicalPaymentKey);
      if (existing !== null) {
        if (
          existing.merchantId !== input.merchantId ||
          existing.requestFingerprint !== input.requestFingerprint
        ) {
          this.securityEvent(
            "REPLAY_BINDING_CONFLICT",
            input.merchantId,
            input.logicalPaymentKey,
          );
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Authorization was reused for an incompatible payment request",
            409,
          );
        }
        this.claimPaymentIdentifier(input);
        if (existing.state === "SETTLED" && existing.response !== null)
          return {
            kind: "CACHED",
            paymentKey: input.logicalPaymentKey,
            response: existing.response,
          };
        if (existing.state === "AMBIGUOUS" || existing.state === "QUARANTINED")
          return { kind: "AMBIGUOUS", paymentKey: input.logicalPaymentKey };
        if (
          existing.state === "FAILED_DEFINITIVE" ||
          existing.state === "EXPIRED"
        )
          return {
            kind: "FAILED",
            paymentKey: input.logicalPaymentKey,
            response: existing.response,
          };
        const attempt = this.database
          .prepare(
            "SELECT state FROM settlement_attempts WHERE payment_key = ? AND settlement_step_key = ?",
          )
          .get(input.logicalPaymentKey, input.settlementStepKey) as
          | Row
          | undefined;
        if (attempt?.state === "OUTBOUND_PREPARED")
          return { kind: "OWNER", paymentKey: input.logicalPaymentKey };
        return { kind: "IN_PROGRESS", paymentKey: input.logicalPaymentKey };
      }

      const merchant = this.getMerchantForUpdate(input.merchantId);
      const effectiveFee = input.testnet ? 0n : input.feeMicroUsd;
      if (merchant.availableBalanceMicroUsd < effectiveFee) {
        throw new XGuardError(
          "INSUFFICIENT_SERVICE_BALANCE",
          "Merchant service balance is below the configured XGuard fee",
          402,
        );
      }
      const now = new Date().toISOString();
      this.database
        .prepare(
          `
        INSERT INTO payments (
          logical_payment_key, merchant_id, request_fingerprint, state, network, scheme,
          payer, asset, pay_to, amount_atomic,
          testnet, fee_micro_usd, expires_at_seconds, created_at, updated_at
        ) VALUES (?, ?, ?, 'SETTLEMENT_IN_PROGRESS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.logicalPaymentKey,
          input.merchantId,
          input.requestFingerprint,
          input.network,
          input.scheme,
          input.payer,
          input.asset,
          input.payTo,
          input.amountAtomic,
          input.testnet ? 1 : 0,
          effectiveFee,
          input.expiresAtSeconds,
          now,
          now,
        );
      this.claimPaymentIdentifier(input);
      this.database
        .prepare(
          `
        INSERT INTO settlement_attempts (
          id, payment_key, settlement_step_key, attempt_number, state, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 'OUTBOUND_PREPARED', ?, ?)
      `,
        )
        .run(
          randomUUID(),
          input.logicalPaymentKey,
          input.settlementStepKey,
          now,
          now,
        );
      if (effectiveFee > 0n) {
        this.database
          .prepare(
            "UPDATE merchants SET available_balance_micro_usd = available_balance_micro_usd - ? WHERE id = ?",
          )
          .run(effectiveFee, input.merchantId);
        this.database
          .prepare(
            "INSERT INTO balance_holds (payment_key, merchant_id, amount_micro_usd, state, created_at, updated_at) VALUES (?, ?, ?, 'RESERVED', ?, ?)",
          )
          .run(
            input.logicalPaymentKey,
            input.merchantId,
            effectiveFee,
            now,
            now,
          );
      }
      return { kind: "OWNER", paymentKey: input.logicalPaymentKey };
    });
  }

  public markOutboundStarted(
    paymentKey: string,
    facilitatorId: string,
  ): boolean {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const result = this.database
        .prepare(
          `
        UPDATE settlement_attempts
        SET state = 'OUTBOUND_STARTED', facilitator_id = ?, outbound_started_at = ?, updated_at = ?
        WHERE payment_key = ? AND state = 'OUTBOUND_PREPARED'
      `,
        )
        .run(facilitatorId, now, now, paymentKey);
      if (result.changes === 1) {
        this.database
          .prepare(
            "UPDATE payments SET facilitator_id = ?, updated_at = ? WHERE logical_payment_key = ? AND state = 'SETTLEMENT_IN_PROGRESS'",
          )
          .run(facilitatorId, now, paymentKey);
        return true;
      }
      return false;
    });
  }

  public finalizeSuccess(input: {
    paymentKey: string;
    response: SettleResponse;
    facilitatorId: string;
    downstreamCostMicroUsd: bigint | null;
    finalityEvidence: DurableSettlementEvidence;
  }): void {
    this.transaction(() => this.finalizeSuccessInternal(input));
  }

  public finalizeDefinitiveFailure(input: {
    paymentKey: string;
    response: SettleResponse;
    reason: string;
    rejectionEvidence: DefinitiveFacilitatorRejectionEvidence;
  }): void {
    this.transaction(() => {
      const payment = this.readPaymentRow(input.paymentKey);
      if (payment === null || payment.state === "SETTLED") return;
      if (payment.state !== "SETTLEMENT_IN_PROGRESS")
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Cannot finalize definitive failure from ${payment.state}`,
          409,
        );
      if (
        input.response.success !== false ||
        input.response.transaction !== "" ||
        input.response.network !== payment.network ||
        input.rejectionEvidence.source !== "FACILITATOR_RESPONSE" ||
        input.rejectionEvidence.facilitatorId !== payment.facilitatorId ||
        !Number.isFinite(Date.parse(input.rejectionEvidence.observedAt)) ||
        input.rejectionEvidence.evidenceReference.length < 1 ||
        input.rejectionEvidence.evidenceReference.length > 512
      )
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Definitive failure evidence conflicts with the stored payment",
          409,
        );
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payments SET state = 'FAILED_DEFINITIVE', response_json = ?, failure_reason = ?, updated_at = ? WHERE logical_payment_key = ?",
        )
        .run(
          jsonStringify(input.response),
          input.reason.slice(0, 500),
          now,
          input.paymentKey,
        );
      this.database
        .prepare(
          "UPDATE settlement_attempts SET state = 'REJECTED_NO_COMMIT', response_json = ?, updated_at = ? WHERE payment_key = ?",
        )
        .run(jsonStringify(input.response), now, input.paymentKey);
      this.database
        .prepare(
          "UPDATE settlement_attempts SET finality_evidence_json=? WHERE payment_key=?",
        )
        .run(jsonStringify(input.rejectionEvidence), input.paymentKey);
      this.releaseHold(input.paymentKey, now);
    });
  }

  public markAmbiguous(paymentKey: string, reason: string): void {
    this.transaction(() => {
      const payment = this.readPaymentRow(paymentKey);
      if (payment === null || payment.state === "SETTLED") return;
      if (
        payment.state !== "SETTLEMENT_IN_PROGRESS" &&
        payment.state !== "AMBIGUOUS"
      )
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Cannot mark payment ambiguous from ${payment.state}`,
          409,
        );
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payments SET state = 'AMBIGUOUS', failure_reason = ?, updated_at = ? WHERE logical_payment_key = ?",
        )
        .run(reason.slice(0, 500), now, paymentKey);
      this.database
        .prepare(
          "UPDATE settlement_attempts SET state = 'AMBIGUOUS', updated_at = ? WHERE payment_key = ?",
        )
        .run(now, paymentKey);
      this.database
        .prepare(
          `
        INSERT INTO reconciliation_cases (id, payment_key, state, reason, opened_at, updated_at)
        VALUES (?, ?, 'OPEN', ?, ?, ?)
        ON CONFLICT(payment_key) DO UPDATE SET state = 'OPEN', reason = excluded.reason, updated_at = excluded.updated_at
      `,
        )
        .run(randomUUID(), paymentKey, reason.slice(0, 500), now, now);
    });
  }

  public reconcileAsSettled(input: {
    paymentKey: string;
    response: SettleResponse;
    facilitatorId: string;
    downstreamCostMicroUsd: bigint | null;
    finalityEvidence: DurableSettlementEvidence;
  }): void {
    this.transaction(() => {
      const payment = this.readPaymentRow(input.paymentKey);
      if (payment === null || payment.state !== "AMBIGUOUS")
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Only ambiguous payments can be reconciled",
          409,
        );
      this.finalizeSuccessInternal(input);
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE reconciliation_cases SET state = 'RESOLVED_SETTLED', evidence = ?, updated_at = ? WHERE payment_key = ?",
        )
        .run(jsonStringify(input.finalityEvidence), now, input.paymentKey);
    });
  }

  public reconcileAsFailed(input: {
    paymentKey: string;
    reason: string;
    failureEvidence: SettlementFailureEvidence;
  }): void {
    this.transaction(() => {
      const payment = this.readPaymentRow(input.paymentKey);
      if (payment === null || payment.state !== "AMBIGUOUS")
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Only ambiguous payments can be reconciled",
          409,
        );
      this.assertFailureEvidence(input.failureEvidence, payment);
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payments SET state='FAILED_DEFINITIVE',response_json=NULL,failure_reason=?,updated_at=? WHERE logical_payment_key=? AND state='AMBIGUOUS'",
        )
        .run(input.reason.slice(0, 500), now, input.paymentKey);
      this.database
        .prepare(
          "UPDATE settlement_attempts SET state='REJECTED_NO_COMMIT',updated_at=? WHERE payment_key=? AND state='AMBIGUOUS'",
        )
        .run(now, input.paymentKey);
      this.releaseHold(input.paymentKey, now);
      this.database
        .prepare(
          "UPDATE reconciliation_cases SET state='RESOLVED_FAILED',evidence=?,updated_at=? WHERE payment_key=?",
        )
        .run(jsonStringify(input.failureEvidence), now, input.paymentKey);
    });
  }

  public getPayment(paymentKey: string): StoredPayment | null {
    return this.readPaymentRow(paymentKey);
  }

  public getFinancialReport(
    reservePercent = 20,
    minimumReserveMicroUsd = DEFAULT_MIN_RESERVE_MICRO_USD,
  ): FinancialReport {
    const transactionCount = this.scalarBigInt("SELECT COUNT(*) FROM payments");
    const billableSettlementCount = this.scalarBigInt(
      "SELECT COUNT(*) FROM usage_events",
    );
    const ambiguousSettlementCount = this.scalarBigInt(
      "SELECT COUNT(*) FROM reconciliation_cases WHERE state IN ('OPEN','QUARANTINED')",
    );
    const grossRevenueMicroUsd = -this.accountBalance("XGUARD_SERVICE_REVENUE");
    const operatingCostsMicroUsd =
      this.accountBalance("FACILITATOR_EXPENSE") +
      this.accountBalance("INFRASTRUCTURE_EXPENSE") +
      this.accountBalance("OFFRAMP_EXPENSE");
    const contributionMicroUsd = grossRevenueMicroUsd - operatingCostsMicroUsd;
    const treasuryAssetMicroUsd = this.accountBalance("TREASURY_ASSET");
    const customerLiabilitiesMicroUsd = -this.accountBalance(
      "MERCHANT_PREPAID_LIABILITY",
    );
    const unpaidOperatingLiabilitiesMicroUsd = -(
      this.accountBalance("FACILITATOR_PAYABLE") +
      this.accountBalance("OPERATING_PAYABLE")
    );
    const availableTreasuryMicroUsd = maxBigInt(
      0n,
      treasuryAssetMicroUsd - customerLiabilitiesMicroUsd,
    );
    const desiredReserve =
      grossRevenueMicroUsd > 0n
        ? maxBigInt(
            minimumReserveMicroUsd,
            percentageOf(maxBigInt(0n, contributionMicroUsd), reservePercent),
          )
        : 0n;
    const pendingOwnerPayoutMicroUsd = this.scalarBigInt(
      "SELECT COALESCE(SUM(gross_cash_requirement_micro_usd), 0) FROM payouts WHERE state IN ('PREPARED', 'PENDING', 'SUBMITTED', 'AMBIGUOUS')",
    );
    const paidOwnerProfitMicroUsd = this.scalarBigInt(
      "SELECT COALESCE(SUM(amount_micro_usd), 0) FROM payouts WHERE state = 'PAID'",
    );
    const afterLiabilities = maxBigInt(
      0n,
      availableTreasuryMicroUsd -
        unpaidOperatingLiabilitiesMicroUsd -
        pendingOwnerPayoutMicroUsd,
    );
    const operatingReserveMicroUsd = minBigInt(
      desiredReserve,
      afterLiabilities,
    );
    const ownerDistributableMicroUsd = maxBigInt(
      0n,
      afterLiabilities - operatingReserveMicroUsd,
    );
    return {
      transactionCount,
      billableSettlementCount,
      ambiguousSettlementCount,
      grossRevenueMicroUsd,
      operatingCostsMicroUsd,
      contributionMicroUsd,
      treasuryAssetMicroUsd,
      customerLiabilitiesMicroUsd,
      unpaidOperatingLiabilitiesMicroUsd,
      availableTreasuryMicroUsd,
      requiredOperatingReserveMicroUsd: desiredReserve,
      operatingReserveMicroUsd,
      ownerDistributableMicroUsd,
      pendingOwnerPayoutMicroUsd,
      paidOwnerProfitMicroUsd,
    };
  }

  public verifyLedgerBalance(): {
    balanced: boolean;
    imbalancedTransactionIds: string[];
  } {
    const statement = this.bigIntStatement(`
      SELECT transaction_id, SUM(amount_micro_usd) AS total
      FROM ledger_postings GROUP BY transaction_id HAVING SUM(amount_micro_usd) != 0
    `);
    const rows = statement.all() as Row[];
    return {
      balanced: rows.length === 0,
      imbalancedTransactionIds: rows.map((row) => String(row.transaction_id)),
    };
  }

  public markStaleStartedAsAmbiguous(olderThanIso: string): number {
    const rows = this.database
      .prepare(
        `
      SELECT payment_key FROM settlement_attempts
      WHERE state = 'OUTBOUND_STARTED' AND outbound_started_at < ?
    `,
      )
      .all(olderThanIso) as Row[];
    for (const row of rows)
      this.markAmbiguous(
        String(row.payment_key),
        "Worker recovery found an unresolved outbound settlement submission",
      );
    return rows.length;
  }

  public expirePreparedPayments(nowSeconds: bigint): number {
    return this.transaction(() => {
      const rows = this.bigIntStatement(
        `SELECT p.logical_payment_key
         FROM payments p
         JOIN settlement_attempts a ON a.payment_key=p.logical_payment_key
         WHERE p.state='SETTLEMENT_IN_PROGRESS'
           AND a.state='OUTBOUND_PREPARED'
           AND p.expires_at_seconds<=?`,
      ).all(nowSeconds) as Row[];
      const now = new Date().toISOString();
      for (const row of rows) {
        const paymentKey = String(row.logical_payment_key);
        this.database
          .prepare(
            "UPDATE payments SET state='EXPIRED',failure_reason='Authorization expired before submission',updated_at=? WHERE logical_payment_key=? AND state='SETTLEMENT_IN_PROGRESS'",
          )
          .run(now, paymentKey);
        this.database
          .prepare(
            "UPDATE settlement_attempts SET state='REJECTED_NO_COMMIT',updated_at=? WHERE payment_key=? AND state='OUTBOUND_PREPARED'",
          )
          .run(now, paymentKey);
        this.releaseHold(paymentKey, now);
      }
      return rows.length;
    });
  }

  public accrueOperatingExpense(input: {
    category:
      | "COMPUTE"
      | "DATABASE"
      | "NETWORK"
      | "MONITORING"
      | "OFFRAMP"
      | "OTHER_INFRASTRUCTURE";
    amountMicroUsd: bigint;
    externalReference: string;
    evidence: string;
  }): OperatingExpenseRecord {
    if (input.amountMicroUsd <= 0n)
      throw new RangeError("Operating expense amount must be positive");
    return this.transaction(() => {
      const priorEvidence = this.readExpenseByEvidenceReference(
        input.externalReference,
      );
      if (priorEvidence !== null) {
        const prior = priorEvidence.expense;
        if (
          priorEvidence.phase !== "ACCRUAL" ||
          prior.category !== input.category ||
          prior.amountMicroUsd !== input.amountMicroUsd
        )
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Operating expense reference was reused with different terms",
            409,
          );
        return prior;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare(
          "INSERT INTO operating_expenses(id,payment_key,category,amount_micro_usd,state,created_at) VALUES(?,NULL,?,?,'ACCRUED',?)",
        )
        .run(id, input.category, input.amountMicroUsd, now);
      this.recordExpenseEvidence(
        id,
        "ACCRUAL",
        input.externalReference,
        input.evidence,
        now,
      );
      const expenseAccount =
        input.category === "OFFRAMP"
          ? "OFFRAMP_EXPENSE"
          : "INFRASTRUCTURE_EXPENSE";
      this.postLedger(`operating-expense:${id}`, "OPERATING_EXPENSE_ACCRUAL", [
        { account: expenseAccount, amount: input.amountMicroUsd },
        { account: "OPERATING_PAYABLE", amount: -input.amountMicroUsd },
      ]);
      return this.requireOperatingExpense(id);
    });
  }

  public markOperatingExpensePaid(input: {
    expenseId: string;
    paymentReference: string;
    evidence: string;
  }): OperatingExpenseRecord {
    return this.transaction(() =>
      this.markOperatingExpensePaidInternal(
        input.expenseId,
        input.paymentReference,
        input.evidence,
      ),
    );
  }

  public markFacilitatorExpensePaid(input: {
    paymentKey: string;
    paymentReference: string;
    evidence: string;
  }): OperatingExpenseRecord {
    return this.transaction(() => {
      const row = this.bigIntStatement(
        "SELECT id FROM operating_expenses WHERE payment_key=? AND category='FACILITATOR'",
      ).get(input.paymentKey) as Row | undefined;
      if (row === undefined)
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Facilitator expense was not found",
          404,
        );
      return this.markOperatingExpensePaidInternal(
        String(row.id),
        input.paymentReference,
        input.evidence,
      );
    });
  }

  public prepareOwnerPayout(input: PrepareOwnerPayoutInput): PayoutRecord {
    return this.transaction(() => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(input.provider))
        throw new XGuardError(
          "BAD_REQUEST",
          "Payout provider identifier is invalid",
          400,
        );
      if (
        input.providerIdempotencyKey.length < 8 ||
        input.providerIdempotencyKey.length > 255 ||
        hasAsciiControlCharacter(input.providerIdempotencyKey)
      )
        throw new XGuardError(
          "BAD_REQUEST",
          "Payout idempotency key is invalid",
          400,
        );
      const policySnapshot: PayoutPolicySnapshot = {
        ...input.policy,
        reservePercent: input.reservePercent ?? 20,
        minimumReserveMicroUsd:
          input.minimumReserveMicroUsd ?? DEFAULT_MIN_RESERVE_MICRO_USD,
      };
      const existing = this.readPayoutByIdempotencyKey(
        input.providerIdempotencyKey,
      );
      if (existing !== null) {
        const expectedSafetySnapshot = jsonStringify(input.safety);
        if (
          existing.provider !== input.provider ||
          jsonStringify(existing.policySnapshot) !==
            jsonStringify(policySnapshot) ||
          jsonStringify(existing.safetySnapshot) !== expectedSafetySnapshot
        ) {
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Payout idempotency key was reused with different terms",
            409,
          );
        }
        return existing;
      }
      const report = this.getFinancialReport(
        policySnapshot.reservePercent,
        policySnapshot.minimumReserveMicroUsd,
      );
      const decision = evaluateOwnerPayout(report, input.safety, input.policy);
      const blockers = decision.state === "READY" ? [] : [...decision.reasons];
      const openReconciliationCases = this.scalarBigInt(
        "SELECT COUNT(*) FROM reconciliation_cases WHERE state NOT IN ('RESOLVED_SETTLED','RESOLVED_FAILED')",
      );
      if (openReconciliationCases > 0n)
        blockers.push("open_reconciliation_cases");
      const ambiguousPayouts = this.scalarBigInt(
        "SELECT COUNT(*) FROM payouts WHERE state='AMBIGUOUS'",
      );
      if (ambiguousPayouts > 0n) blockers.push("previous_payout_ambiguous");
      if (decision.state !== "READY" || blockers.length > 0) {
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Owner payout is not eligible: ${[...new Set(blockers)].join(",")}`,
          409,
        );
      }
      if (
        decision.amountMicroUsd <= 0n ||
        decision.grossCashRequirementMicroUsd !==
          decision.amountMicroUsd + decision.providerFeeMicroUsd ||
        decision.grossCashRequirementMicroUsd >
          report.ownerDistributableMicroUsd
      )
        throw new XGuardError(
          "INTERNAL_ERROR",
          "Payout policy produced an invalid cash requirement",
          500,
        );
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO payouts(
            id,provider,provider_idempotency_key,amount_micro_usd,
            provider_fee_micro_usd,gross_cash_requirement_micro_usd,safety_snapshot_json,policy_snapshot_json,
            state,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,'PREPARED',?,?)`,
        )
        .run(
          id,
          input.provider,
          input.providerIdempotencyKey,
          decision.amountMicroUsd,
          decision.providerFeeMicroUsd,
          decision.grossCashRequirementMicroUsd,
          jsonStringify(input.safety),
          jsonStringify(policySnapshot),
          now,
          now,
        );
      return this.requirePayout(id);
    });
  }

  public markPayoutSubmitted(
    id: string,
    providerReference: string,
  ): PayoutRecord {
    if (
      providerReference.length < 1 ||
      providerReference.length > 512 ||
      hasAsciiControlCharacter(providerReference)
    )
      throw new XGuardError(
        "BAD_REQUEST",
        "Payout provider reference is invalid",
        400,
      );
    return this.transitionPayout(
      id,
      ["PREPARED"],
      "SUBMITTED",
      providerReference,
      null,
    );
  }

  public markPayoutPending(id: string): PayoutRecord {
    return this.transitionPayout(id, ["SUBMITTED"], "PENDING", null, null);
  }

  public markPayoutAmbiguous(id: string, reason: string): PayoutRecord {
    return this.transitionPayout(
      id,
      ["SUBMITTED", "PENDING"],
      "AMBIGUOUS",
      null,
      reason,
    );
  }

  public markPayoutFailed(id: string, reason: string): PayoutRecord {
    return this.transitionPayout(id, ["PREPARED"], "FAILED", null, reason);
  }

  public markPayoutPaid(
    id: string,
    evidence: PayoutTransferEvidence,
  ): PayoutRecord {
    return this.transaction(() => {
      const payout = this.requirePayout(id);
      if (payout.state === "PAID") {
        this.assertPayoutEvidence(payout, evidence, "FINAL_CREDIT");
        this.assertPayoutEvidenceReplay(payout, evidence);
        return payout;
      }
      if (payout.state !== "SUBMITTED" && payout.state !== "PENDING") {
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Cannot mark payout paid from ${payout.state}`,
          409,
        );
      }
      this.assertPayoutEvidence(payout, evidence, "FINAL_CREDIT");
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payouts SET state='PAID',evidence=?,updated_at=? WHERE id=?",
        )
        .run(jsonStringify(evidence), now, id);
      this.postPaidPayoutLedger(payout);
      return this.requirePayout(id);
    });
  }

  public reconcileAmbiguousPayoutPaid(
    id: string,
    evidence: PayoutTransferEvidence,
  ): PayoutRecord {
    return this.transaction(() => {
      const payout = this.requirePayout(id);
      if (payout.state === "PAID") {
        this.assertPayoutEvidence(payout, evidence, "FINAL_CREDIT");
        this.assertPayoutEvidenceReplay(payout, evidence);
        return payout;
      }
      if (payout.state !== "AMBIGUOUS")
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Only an ambiguous payout can be reconciled as paid",
          409,
        );
      this.assertPayoutEvidence(payout, evidence, "FINAL_CREDIT");
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payouts SET state='PAID',evidence=?,updated_at=? WHERE id=?",
        )
        .run(jsonStringify(evidence), now, id);
      this.postPaidPayoutLedger(payout);
      return this.requirePayout(id);
    });
  }

  public markPayoutReturned(
    id: string,
    evidence: PayoutTransferEvidence,
  ): PayoutRecord {
    return this.transaction(() => {
      const payout = this.requirePayout(id);
      if (payout.state === "RETURNED") {
        this.assertPayoutEvidence(payout, evidence, "FINAL_RETURN");
        this.assertPayoutEvidenceReplay(payout, evidence);
        return payout;
      }
      if (
        payout.state !== "PAID" &&
        payout.state !== "SUBMITTED" &&
        payout.state !== "PENDING" &&
        payout.state !== "AMBIGUOUS"
      )
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Cannot mark payout returned from ${payout.state}`,
          409,
        );
      this.assertPayoutEvidence(payout, evidence, "FINAL_RETURN");
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE payouts SET state='RETURNED',evidence=?,updated_at=? WHERE id=?",
        )
        .run(jsonStringify(evidence), now, id);
      if (payout.state === "PAID")
        this.postLedger(
          `owner-payout-return:${id}`,
          "OWNER_DISTRIBUTION_RETURNED",
          [
            { account: "TREASURY_ASSET", amount: payout.amountMicroUsd },
            { account: "OWNER_DISTRIBUTIONS", amount: -payout.amountMicroUsd },
          ],
        );
      else if (payout.providerFeeMicroUsd > 0n)
        this.postLedger(
          `owner-payout-direct-return:${id}`,
          "OWNER_PAYOUT_RETURN_FEE",
          [
            {
              account: "OFFRAMP_EXPENSE",
              amount: payout.providerFeeMicroUsd,
            },
            {
              account: "TREASURY_ASSET",
              amount: -payout.providerFeeMicroUsd,
            },
          ],
        );
      return this.requirePayout(id);
    });
  }

  private finalizeSuccessInternal(input: {
    paymentKey: string;
    response: SettleResponse;
    facilitatorId: string;
    downstreamCostMicroUsd: bigint | null;
    finalityEvidence: DurableSettlementEvidence;
  }): void {
    const payment = this.readPaymentRow(input.paymentKey);
    if (payment === null)
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Payment record disappeared before finalization",
        500,
      );
    if (payment.state === "SETTLED") return;
    if (
      payment.state !== "SETTLEMENT_IN_PROGRESS" &&
      payment.state !== "AMBIGUOUS"
    ) {
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `Cannot finalize payment from ${payment.state}`,
        409,
      );
    }
    if (
      input.response.success !== true ||
      input.response.network !== payment.network ||
      (payment.network.startsWith("eip155:") &&
        !EVM_TRANSACTION.test(input.response.transaction))
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Settlement evidence is not a valid successful response for the stored payment",
        409,
      );
    this.assertFinalityEvidence(
      input.finalityEvidence,
      payment,
      input.response,
    );
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE payments SET state = 'SETTLED', response_json = ?, facilitator_id = ?, updated_at = ? WHERE logical_payment_key = ?",
      )
      .run(
        jsonStringify(input.response),
        input.facilitatorId,
        now,
        input.paymentKey,
      );
    this.database
      .prepare(
        "UPDATE settlement_attempts SET state = 'FINALIZED', response_json = ?, finality_evidence_json = ?, updated_at = ? WHERE payment_key = ?",
      )
      .run(
        jsonStringify(input.response),
        jsonStringify(input.finalityEvidence),
        now,
        input.paymentKey,
      );
    const hold = this.bigIntStatement(
      "SELECT merchant_id, amount_micro_usd, state FROM balance_holds WHERE payment_key = ?",
    ).get(input.paymentKey) as Row | undefined;
    if (hold !== undefined && hold.state === "RESERVED") {
      const fee = bigintFrom(hold.amount_micro_usd);
      this.database
        .prepare(
          "UPDATE balance_holds SET state = 'CAPTURED', updated_at = ? WHERE payment_key = ? AND state = 'RESERVED'",
        )
        .run(now, input.paymentKey);
      this.database
        .prepare(
          `
        INSERT INTO usage_events (id, payment_key, merchant_id, event_kind, fee_micro_usd, fee_policy_version, created_at)
        VALUES (?, ?, ?, 'SUCCESSFUL_BILLABLE_SETTLEMENT', ?, 'v1', ?)
      `,
        )
        .run(
          randomUUID(),
          input.paymentKey,
          String(hold.merchant_id),
          fee,
          now,
        );
      this.postLedger(`fee:${input.paymentKey}`, "XGUARD_FEE_CAPTURE", [
        { account: "MERCHANT_PREPAID_LIABILITY", amount: fee },
        { account: "XGUARD_SERVICE_REVENUE", amount: -fee },
      ]);
    }
    if (
      input.downstreamCostMicroUsd !== null &&
      input.downstreamCostMicroUsd > 0n
    ) {
      this.database
        .prepare(
          `
        INSERT INTO operating_expenses (id, payment_key, category, amount_micro_usd, state, created_at)
        VALUES (?, ?, 'FACILITATOR', ?, 'ACCRUED', ?)
        ON CONFLICT(payment_key, category) DO NOTHING
      `,
        )
        .run(randomUUID(), input.paymentKey, input.downstreamCostMicroUsd, now);
      this.postLedger(
        `facilitator-cost:${input.paymentKey}`,
        "FACILITATOR_COST_ACCRUAL",
        [
          {
            account: "FACILITATOR_EXPENSE",
            amount: input.downstreamCostMicroUsd,
          },
          {
            account: "FACILITATOR_PAYABLE",
            amount: -input.downstreamCostMicroUsd,
          },
        ],
      );
    }
  }

  private releaseHold(paymentKey: string, now: string): void {
    const hold = this.bigIntStatement(
      "SELECT merchant_id, amount_micro_usd, state FROM balance_holds WHERE payment_key = ?",
    ).get(paymentKey) as Row | undefined;
    if (hold === undefined || hold.state !== "RESERVED") return;
    const amount = bigintFrom(hold.amount_micro_usd);
    this.database
      .prepare(
        "UPDATE balance_holds SET state = 'RELEASED', updated_at = ? WHERE payment_key = ? AND state = 'RESERVED'",
      )
      .run(now, paymentKey);
    this.database
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd = available_balance_micro_usd + ? WHERE id = ?",
      )
      .run(amount, String(hold.merchant_id));
  }

  private markOperatingExpensePaidInternal(
    expenseId: string,
    paymentReference: string,
    evidence: string,
  ): OperatingExpenseRecord {
    const expense = this.requireOperatingExpense(expenseId);
    const priorEvidence = this.readExpenseByEvidenceReference(paymentReference);
    if (priorEvidence !== null) {
      if (
        priorEvidence.expense.id !== expenseId ||
        priorEvidence.phase !== "PAYMENT"
      )
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          "Operating payment reference belongs to another expense",
          409,
        );
      return priorEvidence.expense;
    }
    if (expense.state !== "ACCRUED")
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `Cannot pay operating expense from ${expense.state}`,
        409,
      );
    const report = this.getFinancialReport();
    if (report.availableTreasuryMicroUsd < expense.amountMicroUsd)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Operating expense payment would consume customer liabilities",
        409,
      );
    const payableAccount =
      expense.category === "FACILITATOR"
        ? "FACILITATOR_PAYABLE"
        : "OPERATING_PAYABLE";
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE operating_expenses SET state='PAID' WHERE id=? AND state='ACCRUED'",
      )
      .run(expenseId);
    this.recordExpenseEvidence(
      expenseId,
      "PAYMENT",
      paymentReference,
      evidence,
      now,
    );
    this.postLedger(
      `operating-expense-payment:${expenseId}`,
      "OPERATING_EXPENSE_PAYMENT",
      [
        { account: payableAccount, amount: expense.amountMicroUsd },
        { account: "TREASURY_ASSET", amount: -expense.amountMicroUsd },
      ],
    );
    return this.requireOperatingExpense(expenseId);
  }

  private readExpenseByEvidenceReference(
    reference: string,
  ): { expense: OperatingExpenseRecord; phase: "ACCRUAL" | "PAYMENT" } | null {
    const row = this.bigIntStatement(
      `SELECT e.*,v.phase AS evidence_phase FROM operating_expense_evidence v
       JOIN operating_expenses e ON e.id=v.expense_id WHERE v.external_reference=?`,
    ).get(reference) as Row | undefined;
    return row === undefined
      ? null
      : {
          expense: this.operatingExpenseFromRow(row),
          phase: String(row.evidence_phase) as "ACCRUAL" | "PAYMENT",
        };
  }

  private requireOperatingExpense(id: string): OperatingExpenseRecord {
    const row = this.bigIntStatement(
      "SELECT * FROM operating_expenses WHERE id=?",
    ).get(id) as Row | undefined;
    if (row === undefined)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Operating expense was not found",
        404,
      );
    return this.operatingExpenseFromRow(row);
  }

  private operatingExpenseFromRow(row: Row): OperatingExpenseRecord {
    return {
      id: String(row.id),
      paymentKey: row.payment_key === null ? null : String(row.payment_key),
      category: String(row.category),
      amountMicroUsd: bigintFrom(row.amount_micro_usd),
      state: String(row.state) as OperatingExpenseRecord["state"],
      createdAt: String(row.created_at),
    };
  }

  private recordExpenseEvidence(
    expenseId: string,
    phase: "ACCRUAL" | "PAYMENT",
    externalReference: string,
    evidence: string,
    now: string,
  ): void {
    if (externalReference.length < 1 || externalReference.length > 256)
      throw new RangeError("Operating expense external reference is invalid");
    this.database
      .prepare(
        "INSERT INTO operating_expense_evidence(id,expense_id,phase,external_reference,evidence,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        expenseId,
        phase,
        externalReference,
        evidence.slice(0, 2_000),
        now,
      );
  }

  private claimPaymentIdentifier(input: PrepareSettlementInput): void {
    if (input.paymentIdentifier === null) return;
    this.database
      .prepare(
        `
      INSERT INTO payment_identifier_claims (merchant_id, payment_identifier, logical_payment_key, request_fingerprint, expires_at_seconds, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(merchant_id, payment_identifier) DO NOTHING
    `,
      )
      .run(
        input.merchantId,
        input.paymentIdentifier,
        input.logicalPaymentKey,
        input.requestFingerprint,
        input.paymentIdentifierExpiresAtSeconds,
        new Date().toISOString(),
      );
  }

  private getMerchantForUpdate(merchantId: string): MerchantRecord {
    const merchant = this.getMerchant(merchantId);
    if (merchant === null || !merchant.active)
      throw new XGuardError(
        "UNAUTHORIZED",
        "Merchant is missing or disabled",
        401,
      );
    return merchant;
  }

  private assertFinalityEvidence(
    evidence: DurableSettlementEvidence,
    payment: StoredPayment,
    response: SettleResponse,
  ): void {
    let amountMatches = false;
    try {
      amountMatches =
        parseUnsignedInteger(evidence.amount, "finality.amount") ===
        parseUnsignedInteger(payment.amountAtomic, "payment.amount");
    } catch {
      amountMatches = false;
    }
    if (
      evidence.finalized !== true ||
      !Number.isSafeInteger(evidence.confirmations) ||
      evidence.confirmations < 1 ||
      evidence.network !== payment.network ||
      evidence.transaction.toLowerCase() !==
        response.transaction.toLowerCase() ||
      evidence.payer.toLowerCase() !== payment.payer.toLowerCase() ||
      evidence.payTo.toLowerCase() !== payment.payTo.toLowerCase() ||
      evidence.asset.toLowerCase() !== payment.asset.toLowerCase() ||
      !amountMatches ||
      !Number.isFinite(Date.parse(evidence.observedAt)) ||
      evidence.evidenceReference.length < 1 ||
      evidence.evidenceReference.length > 512 ||
      (payment.testnet
        ? evidence.source !== "FACILITATOR_TESTNET"
        : evidence.source !== "INDEPENDENT_CHAIN")
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Typed finality evidence does not prove the stored settlement",
        409,
      );
  }

  private assertFailureEvidence(
    evidence: SettlementFailureEvidence,
    payment: StoredPayment,
  ): void {
    if (
      evidence.source !== "INDEPENDENT_CHAIN" ||
      evidence.authorizationUnused !== true ||
      evidence.paymentKey !== payment.logicalPaymentKey ||
      evidence.network !== payment.network ||
      !Number.isFinite(Date.parse(evidence.observedAt)) ||
      evidence.evidenceReference.length < 1 ||
      evidence.evidenceReference.length > 512
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Typed failure evidence does not prove the authorization remained unused",
        409,
      );
  }

  private readPaymentRow(paymentKey: string): StoredPayment | null {
    const statement = this.bigIntStatement(`
      SELECT logical_payment_key, merchant_id, request_fingerprint, state, network,
             payer,asset,pay_to,amount_atomic,testnet,
             fee_micro_usd, facilitator_id, response_json, created_at, updated_at
      FROM payments WHERE logical_payment_key = ?
    `);
    const row = statement.get(paymentKey) as Row | undefined;
    if (row === undefined) return null;
    return {
      logicalPaymentKey: String(row.logical_payment_key),
      merchantId: String(row.merchant_id),
      requestFingerprint: String(row.request_fingerprint),
      state: String(row.state) as PaymentState,
      network: String(row.network),
      payer: String(row.payer),
      asset: String(row.asset),
      payTo: String(row.pay_to),
      amountAtomic: String(row.amount_atomic),
      testnet: bigintFrom(row.testnet) === 1n,
      feeMicroUsd: bigintFrom(row.fee_micro_usd),
      facilitatorId:
        row.facilitator_id === null ? null : String(row.facilitator_id),
      response:
        row.response_json === null
          ? null
          : (JSON.parse(String(row.response_json)) as SettleResponse),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private creditMerchantInternal(
    merchantId: string,
    amount: bigint,
    externalReference: string,
  ): void {
    if (this.getMerchant(merchantId) === null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Cannot credit an unknown merchant",
        409,
      );
    const eventKey = `topup:${externalReference}`;
    const existing = this.database
      .prepare("SELECT id FROM ledger_transactions WHERE event_key = ?")
      .get(eventKey);
    if (existing !== undefined) return;
    this.database
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd = available_balance_micro_usd + ? WHERE id = ?",
      )
      .run(amount, merchantId);
    this.postLedger(eventKey, "MERCHANT_TOP_UP", [
      { account: "TREASURY_ASSET", amount },
      { account: "MERCHANT_PREPAID_LIABILITY", amount: -amount },
    ]);
  }

  private postPaidPayoutLedger(payout: PayoutRecord): void {
    const postings: { account: string; amount: bigint }[] = [
      { account: "OWNER_DISTRIBUTIONS", amount: payout.amountMicroUsd },
    ];
    if (payout.providerFeeMicroUsd > 0n)
      postings.push({
        account: "OFFRAMP_EXPENSE",
        amount: payout.providerFeeMicroUsd,
      });
    postings.push({
      account: "TREASURY_ASSET",
      amount: -payout.grossCashRequirementMicroUsd,
    });
    this.postLedger(
      `owner-payout:${payout.id}`,
      "OWNER_DISTRIBUTION_PAID",
      postings,
    );
  }

  private assertPayoutEvidence(
    payout: PayoutRecord,
    evidence: PayoutTransferEvidence,
    status: PayoutTransferEvidence["status"],
  ): void {
    if (
      evidence.status !== status ||
      evidence.provider !== payout.provider ||
      payout.providerReference === null ||
      evidence.providerReference !== payout.providerReference ||
      evidence.destinationAmountMicroUsd !== payout.amountMicroUsd ||
      evidence.providerFeeMicroUsd !== payout.providerFeeMicroUsd ||
      !Number.isFinite(Date.parse(evidence.observedAt)) ||
      evidence.evidenceReference.length < 1 ||
      evidence.evidenceReference.length > 512 ||
      hasAsciiControlCharacter(evidence.evidenceReference)
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `Payout evidence does not prove ${status.toLowerCase()}`,
        409,
      );
  }

  private assertPayoutEvidenceReplay(
    payout: PayoutRecord,
    evidence: PayoutTransferEvidence,
  ): void {
    const recorded = payout.transferEvidence;
    if (
      recorded === null ||
      recorded.provider !== evidence.provider ||
      recorded.providerReference !== evidence.providerReference ||
      recorded.status !== evidence.status ||
      recorded.destinationAmountMicroUsd !==
        evidence.destinationAmountMicroUsd ||
      recorded.providerFeeMicroUsd !== evidence.providerFeeMicroUsd ||
      recorded.observedAt !== evidence.observedAt ||
      recorded.evidenceReference !== evidence.evidenceReference
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Payout terminal evidence replay conflicts with the recorded proof",
        409,
      );
  }

  private transitionPayout(
    id: string,
    from: PayoutRecord["state"][],
    to: PayoutRecord["state"],
    providerReference: string | null,
    failureReason: string | null,
  ): PayoutRecord {
    return this.transaction(() => {
      const payout = this.requirePayout(id);
      if (payout.state === to) {
        if (
          providerReference !== null &&
          payout.providerReference !== providerReference
        )
          throw new XGuardError(
            "PAYMENT_CONFLICT",
            "Payout replay returned a conflicting provider reference",
            409,
          );
        return payout;
      }
      if (!from.includes(payout.state))
        throw new XGuardError(
          "PAYMENT_CONFLICT",
          `Invalid payout transition ${payout.state} -> ${to}`,
          409,
        );
      const now = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE payouts SET state=?,provider_reference=COALESCE(?,provider_reference),failure_reason=COALESCE(?,failure_reason),updated_at=? WHERE id=?`,
        )
        .run(
          to,
          providerReference,
          failureReason?.slice(0, 500) ?? null,
          now,
          id,
        );
      return this.requirePayout(id);
    });
  }

  private readPayoutByIdempotencyKey(key: string): PayoutRecord | null {
    const row = this.bigIntStatement(
      "SELECT * FROM payouts WHERE provider_idempotency_key=?",
    ).get(key) as Row | undefined;
    return row === undefined ? null : this.payoutFromRow(row);
  }

  private requirePayout(id: string): PayoutRecord {
    const row = this.bigIntStatement("SELECT * FROM payouts WHERE id=?").get(
      id,
    ) as Row | undefined;
    if (row === undefined)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Payout record was not found",
        404,
      );
    return this.payoutFromRow(row);
  }

  private payoutFromRow(row: Row): PayoutRecord {
    return {
      id: String(row.id),
      provider: String(row.provider),
      providerIdempotencyKey: String(row.provider_idempotency_key),
      providerReference:
        row.provider_reference === null ? null : String(row.provider_reference),
      amountMicroUsd: bigintFrom(row.amount_micro_usd),
      providerFeeMicroUsd: bigintFrom(row.provider_fee_micro_usd),
      grossCashRequirementMicroUsd: bigintFrom(
        row.gross_cash_requirement_micro_usd,
      ),
      safetySnapshot: payoutSafetySnapshotFromJson(row.safety_snapshot_json),
      policySnapshot: payoutPolicySnapshotFromJson(row.policy_snapshot_json),
      transferEvidence: payoutTransferEvidenceFromJson(row.evidence),
      state: String(row.state) as PayoutRecord["state"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private postLedger(
    eventKey: string,
    kind: string,
    postings: readonly { account: string; amount: bigint }[],
  ): void {
    const sum = postings.reduce((total, posting) => total + posting.amount, 0n);
    if (sum !== 0n)
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Unbalanced ledger transaction rejected",
        500,
      );
    const transactionId = randomUUID();
    const result = this.database
      .prepare(
        "INSERT INTO ledger_transactions (id, event_key, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_key) DO NOTHING",
      )
      .run(transactionId, eventKey, kind, new Date().toISOString());
    if (result.changes === 0) return;
    const statement = this.database.prepare(
      "INSERT INTO ledger_postings (id, transaction_id, account, amount_micro_usd) VALUES (?, ?, ?, ?)",
    );
    for (const posting of postings)
      statement.run(
        randomUUID(),
        transactionId,
        posting.account,
        posting.amount,
      );
  }

  private securityEvent(
    kind: string,
    merchantId: string,
    paymentKey: string,
  ): void {
    this.database
      .prepare(
        "INSERT INTO security_events (id, kind, merchant_id, payment_key_digest, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        kind,
        merchantId,
        createHash("sha256").update(paymentKey).digest("hex").slice(0, 24),
        new Date().toISOString(),
      );
  }

  private accountBalance(account: string): bigint {
    return this.scalarBigInt(
      "SELECT COALESCE(SUM(amount_micro_usd), 0) FROM ledger_postings WHERE account = ?",
      account,
    );
  }

  private scalarBigInt(sql: string, ...bindings: (string | bigint)[]): bigint {
    const statement = this.bigIntStatement(sql);
    const row = statement.get(...bindings) as Row | undefined;
    if (row === undefined) return 0n;
    const first = Object.values(row)[0];
    return bigintFrom(first);
  }

  private bigIntStatement(sql: string): StatementSync {
    const statement = this.database.prepare(sql);
    statement.setReadBigInts(true);
    return statement;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        available_balance_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (available_balance_micro_usd >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        logical_payment_key TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        request_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('RECEIVED','VALIDATING','VERIFIED','SETTLEMENT_IN_PROGRESS','SETTLED','FAILED_DEFINITIVE','AMBIGUOUS','QUARANTINED','EXPIRED')),
        network TEXT NOT NULL,
        scheme TEXT NOT NULL,
        payer TEXT NOT NULL,
        asset TEXT NOT NULL,
        pay_to TEXT NOT NULL,
        amount_atomic TEXT NOT NULL,
        testnet INTEGER NOT NULL CHECK (testnet IN (0, 1)),
        fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd >= 0),
        expires_at_seconds INTEGER NOT NULL,
        facilitator_id TEXT,
        response_json TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS top_ups (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        external_reference TEXT NOT NULL UNIQUE,
        amount_micro_usd INTEGER NOT NULL CHECK(amount_micro_usd>0),
        state TEXT NOT NULL CHECK(state IN ('FINAL','REVERSED')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_identifier_claims (
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        payment_identifier TEXT NOT NULL,
        logical_payment_key TEXT NOT NULL REFERENCES payments(logical_payment_key),
        request_fingerprint TEXT NOT NULL,
        expires_at_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (merchant_id, payment_identifier)
      );
      CREATE TABLE IF NOT EXISTS settlement_attempts (
        id TEXT PRIMARY KEY,
        payment_key TEXT NOT NULL REFERENCES payments(logical_payment_key),
        settlement_step_key TEXT NOT NULL,
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        state TEXT NOT NULL CHECK (state IN ('OUTBOUND_PREPARED','OUTBOUND_STARTED','RESPONSE_RECEIVED','FINALIZED','REJECTED_NO_COMMIT','PENDING','AMBIGUOUS','QUARANTINED')),
        facilitator_id TEXT,
        outbound_started_at TEXT,
        response_json TEXT,
        finality_evidence_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (payment_key, settlement_step_key),
        UNIQUE (payment_key, attempt_number)
      );
      CREATE TABLE IF NOT EXISTS balance_holds (
        payment_key TEXT PRIMARY KEY REFERENCES payments(logical_payment_key),
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
        state TEXT NOT NULL CHECK (state IN ('RESERVED','CAPTURED','RELEASED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        payment_key TEXT NOT NULL UNIQUE REFERENCES payments(logical_payment_key),
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        event_kind TEXT NOT NULL,
        fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd > 0),
        fee_policy_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verification_attempts (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        logical_payment_key TEXT NOT NULL,
        facilitator_id TEXT NOT NULL,
        is_valid INTEGER NOT NULL CHECK (is_valid IN (0, 1)),
        latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger_postings (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
        account TEXT NOT NULL CHECK (account IN ('TREASURY_ASSET','MERCHANT_PREPAID_LIABILITY','XGUARD_SERVICE_REVENUE','FACILITATOR_EXPENSE','FACILITATOR_PAYABLE','INFRASTRUCTURE_EXPENSE','OFFRAMP_EXPENSE','OPERATING_PAYABLE','OWNER_DISTRIBUTIONS')),
        amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd != 0)
      );
      CREATE INDEX IF NOT EXISTS ledger_postings_account_idx ON ledger_postings(account);
      CREATE TABLE IF NOT EXISTS operating_expenses (
        id TEXT PRIMARY KEY,
        payment_key TEXT REFERENCES payments(logical_payment_key),
        category TEXT NOT NULL,
        amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
        state TEXT NOT NULL CHECK (state IN ('ACCRUED','PAID','REVERSED')),
        created_at TEXT NOT NULL,
        UNIQUE(payment_key, category)
      );
      CREATE TABLE IF NOT EXISTS operating_expense_evidence (
        id TEXT PRIMARY KEY,
        expense_id TEXT NOT NULL REFERENCES operating_expenses(id),
        phase TEXT NOT NULL CHECK (phase IN ('ACCRUAL','PAYMENT')),
        external_reference TEXT NOT NULL UNIQUE,
        evidence TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_idempotency_key TEXT NOT NULL UNIQUE,
        provider_reference TEXT UNIQUE,
        amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
        provider_fee_micro_usd INTEGER NOT NULL CHECK (provider_fee_micro_usd >= 0),
        gross_cash_requirement_micro_usd INTEGER NOT NULL CHECK (gross_cash_requirement_micro_usd > 0),
        safety_snapshot_json TEXT NOT NULL,
        policy_snapshot_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PREPARED','PENDING','SUBMITTED','AMBIGUOUS','PAID','FAILED','RETURNED')),
        failure_reason TEXT,
        evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (gross_cash_requirement_micro_usd = amount_micro_usd + provider_fee_micro_usd)
      );
      CREATE TABLE IF NOT EXISTS reconciliation_cases (
        id TEXT PRIMARY KEY,
        payment_key TEXT NOT NULL UNIQUE REFERENCES payments(logical_payment_key),
        state TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT,
        opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        merchant_id TEXT,
        payment_key_digest TEXT,
        created_at TEXT NOT NULL
      );
    `);
    const identifierColumns = this.database
      .prepare("PRAGMA table_info(payment_identifier_claims)")
      .all() as Row[];
    if (
      !identifierColumns.some(
        (column) => String(column.name) === "expires_at_seconds",
      )
    )
      this.database.exec(
        "ALTER TABLE payment_identifier_claims ADD COLUMN expires_at_seconds INTEGER NOT NULL DEFAULT 0",
      );
    const paymentColumns = this.database
      .prepare("PRAGMA table_info(payments)")
      .all() as Row[];
    for (const column of ["payer", "asset", "pay_to", "amount_atomic"]) {
      if (!paymentColumns.some((entry) => String(entry.name) === column))
        this.database.exec(
          `ALTER TABLE payments ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`,
        );
    }
    const attemptColumns = this.database
      .prepare("PRAGMA table_info(settlement_attempts)")
      .all() as Row[];
    if (
      !attemptColumns.some(
        (column) => String(column.name) === "finality_evidence_json",
      )
    )
      this.database.exec(
        "ALTER TABLE settlement_attempts ADD COLUMN finality_evidence_json TEXT",
      );
    const migrationTime = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE payments SET state='QUARANTINED',failure_reason='Legacy record lacks settlement identity/finality evidence',updated_at=?
         WHERE payer='' OR asset='' OR pay_to='' OR amount_atomic=''`,
      )
      .run(migrationTime);
    this.database
      .prepare(
        `INSERT INTO reconciliation_cases(id,payment_key,state,reason,opened_at,updated_at)
         SELECT lower(hex(randomblob(16))),logical_payment_key,'QUARANTINED','Legacy record requires independent reconciliation',?,?
         FROM payments WHERE state='QUARANTINED'
         ON CONFLICT(payment_key) DO UPDATE SET state='QUARANTINED',updated_at=excluded.updated_at`,
      )
      .run(migrationTime, migrationTime);
    const payoutColumns = this.database
      .prepare("PRAGMA table_info(payouts)")
      .all() as Row[];
    if (
      !payoutColumns.some(
        (column) => String(column.name) === "provider_fee_micro_usd",
      )
    )
      this.database.exec(
        "ALTER TABLE payouts ADD COLUMN provider_fee_micro_usd INTEGER NOT NULL DEFAULT 0",
      );
    if (
      !payoutColumns.some(
        (column) => String(column.name) === "gross_cash_requirement_micro_usd",
      )
    ) {
      this.database.exec(
        "ALTER TABLE payouts ADD COLUMN gross_cash_requirement_micro_usd INTEGER NOT NULL DEFAULT 0",
      );
      this.database.exec(
        "UPDATE payouts SET gross_cash_requirement_micro_usd=amount_micro_usd+provider_fee_micro_usd WHERE gross_cash_requirement_micro_usd=0",
      );
    }
    if (
      !payoutColumns.some(
        (column) => String(column.name) === "safety_snapshot_json",
      )
    )
      this.database.exec(
        "ALTER TABLE payouts ADD COLUMN safety_snapshot_json TEXT NOT NULL DEFAULT '{}'",
      );
    if (
      !payoutColumns.some(
        (column) => String(column.name) === "policy_snapshot_json",
      )
    )
      this.database.exec(
        `ALTER TABLE payouts ADD COLUMN policy_snapshot_json TEXT NOT NULL DEFAULT '{"enabled":false,"minimumPayoutMicroUsd":"0","providerMinimumMicroUsd":"0","providerFeeMicroUsd":"0","reservePercent":20,"minimumReserveMicroUsd":"25000000"}'`,
      );
  }
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
