import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";
import {
  earnGatewayFee,
  releaseGatewayFee,
  reserveGatewayFee,
} from "./universal-gateway-billing.js";

const OFFER_PATH = "/v1/payment/offer";
const DECISION_PATH = "/v1/payment/decision";
const DISCOVERY_PATH = "/.well-known/xguard-payment.json";
const SECURITY_EVIDENCE_PATH = "/.well-known/xguard-security-evidence.json";
const RECORD_PATH =
  /^\/v1\/payment\/records\/(pd_[0-9a-f]{32})(\/settlement)?$/;
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_METADATA_KEYS = 20;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,96}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CURRENCY = /^[A-Z0-9][A-Z0-9._-]{1,11}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/;
const SENSITIVE_KEYS =
  /(card.?number|pan|cvv|cvc|security.?code|track.?data|pin|private.?key|seed.?phrase|mnemonic)/i;
const KNOWN_RAILS = new Set([
  "card",
  "stripe",
  "paypal",
  "x402",
  "crypto_wallet",
  "coinbase",
  "bank_transfer",
  "generic_http",
]);

export interface PaymentDecisionEnv {
  DB: D1Database;
  XGUARD_PAYMENT_DECISION_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
}

export type PaymentDecision = "ALLOW" | "REVIEW" | "BLOCK";
export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface PaymentCheck {
  id: string;
  status: CheckStatus;
  reasonCode: string;
  evidence: string;
}

export interface NormalizedPaymentIntent {
  requestId: string;
  offerId: string | null;
  channel: "browser" | "agent" | "api";
  rail: string;
  provider: string;
  amount: string;
  currency: string;
  payee: string;
  merchantOrigin: string | null;
  network: string | null;
  asset: string | null;
  expectedAmount: string | null;
  expectedPayee: string | null;
  expiresAt: string | null;
  paymentReference: string | null;
  metadata: Record<string, string | number | boolean>;
}

export interface DecisionEvaluation {
  decision: PaymentDecision;
  riskScore: number;
  reasonCodes: string[];
  checks: PaymentCheck[];
}

export interface PaymentDecisionReceipt {
  schemaVersion: string;
  documentType: string;
  decisionId: string;
  requestId: string;
  createdAt: string;
  principal: Record<string, unknown>;
  payment: Record<string, unknown>;
  decision: PaymentDecision;
  riskScore: number;
  reasonCodes: string[];
  checks: PaymentCheck[];
  xguard: {
    service: string;
    decisionScope: string;
    serviceFee: {
      amountMicroUsd: number;
      amountUsd: string;
      trigger: string;
      offerOnly: boolean;
      underlyingPaymentRequired: boolean;
    };
  };
  evidence: {
    algorithm: string;
    decisionEvidenceHash: string;
    settlementEvidenceHash?: string;
  };
  paymentOutcome?: Record<string, unknown>;
  replayed?: boolean;
  accounting?: Record<string, unknown>;
}

interface DecisionRecordRow {
  decision_id: string;
  event_key: string;
  principal_id: string;
  request_id: string;
  payment_reference: string | null;
  decision: PaymentDecision;
  fee_micro_usd: number;
  decision_evidence_hash: string;
  receipt_json: string;
  billing_state: "HELD" | "EARNED";
  settlement_status: string;
  settlement_evidence_hash: string | null;
}

class PaymentDecisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function paymentDecisionResponse(
  request: Request,
  env: PaymentDecisionEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const recordMatch = RECORD_PATH.exec(url.pathname);

  if (
    request.method === "OPTIONS" &&
    (url.pathname === OFFER_PATH ||
      url.pathname === DECISION_PATH ||
      url.pathname.startsWith("/v1/payment/records/"))
  )
    return corsResponse(new Response(null, { status: 204 }));

  if (
    request.method === "GET" &&
    (url.pathname === DISCOVERY_PATH || url.pathname === SECURITY_EVIDENCE_PATH)
  ) {
    return publicJson(
      url.pathname === DISCOVERY_PATH
        ? paymentDiscovery(url.origin, env)
        : securityEvidence(url.origin),
    );
  }

  if (url.pathname === OFFER_PATH && request.method === "POST") {
    try {
      await readOptionalJsonObject(request);
      return publicJson(paymentDecisionOffer(env));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (url.pathname === DECISION_PATH && request.method === "POST") {
    try {
      const principal = await authorizePrincipal(request, env);
      const raw = await readJsonObject(request);
      const intent = normalizePaymentDecisionInput(raw);
      const result = await completePaymentDecision(env, principal, intent);
      return privateJson(result, 200, {
        "X-XGuard-Decision": result.decision,
        "X-XGuard-Decision-ID": result.decisionId,
        "X-XGuard-Fee-Micro-USD": String(
          result.xguard.serviceFee.amountMicroUsd,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (
    recordMatch !== null &&
    recordMatch[2] === undefined &&
    request.method === "GET"
  ) {
    try {
      const principal = await authorizePrincipal(request, env);
      return privateJson(
        await getDecisionRecord(
          env.DB,
          principal.principalId,
          recordMatch[1] ?? "",
        ),
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (
    recordMatch !== null &&
    recordMatch[2] !== undefined &&
    request.method === "POST"
  ) {
    try {
      const principal = await authorizePrincipal(request, env);
      const raw = await readJsonObject(request);
      const record = await updateSettlementRecord(
        env.DB,
        principal.principalId,
        recordMatch[1] ?? "",
        raw,
      );
      return privateJson(record, 200, { "X-XGuard-Fee-Micro-USD": "0" });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return null;
}

export function paymentDecisionOffer(env: PaymentDecisionEnv) {
  const feeMicroUsd = decisionFee(env);
  return {
    product: "XGuard Payment Decision",
    version: "1.0",
    billable: false,
    feeMicroUsd,
    feeUsd: microUsdToUsd(feeMicroUsd),
    message: "Verify and document this payment with XGuard before paying?",
    actions: [
      {
        id: "use_xguard",
        label: "Use XGuard",
        billableWhen: "decision_and_evidence_completed",
      },
      {
        id: "continue_without_xguard",
        label: "Continue without XGuard",
        billable: false,
      },
    ],
    guarantees: {
      showingOfferChargesFee: false,
      skippingChargesFee: false,
      failedXGuardServiceChargesFee: false,
      completedAllowReviewOrBlockChargesFee: true,
    },
  };
}

export async function paymentDecisionForMcp(
  request: Request,
  env: PaymentDecisionEnv,
  raw: Record<string, unknown>,
): Promise<PaymentDecisionReceipt> {
  const principal = await authorizePrincipal(request, env);
  const intent = normalizePaymentDecisionInput({ ...raw, channel: "agent" });
  return completePaymentDecision(env, principal, intent);
}

export function normalizePaymentDecisionInput(
  raw: Record<string, unknown>,
): NormalizedPaymentIntent {
  assertNoSensitiveKeys(raw, 0);
  assertOnlyKeys(raw, [
    "requestId",
    "offerId",
    "channel",
    "rail",
    "provider",
    "amount",
    "currency",
    "payee",
    "merchantOrigin",
    "network",
    "asset",
    "expectedAmount",
    "expectedPayee",
    "expiresAt",
    "paymentReference",
    "metadata",
  ]);

  const requestId = requiredString(raw.requestId, "requestId", 96);
  if (!REQUEST_ID.test(requestId))
    throw new PaymentDecisionError("invalid_request_id", 400);

  const channelRaw = optionalString(raw.channel, "channel", 16) ?? "api";
  if (
    channelRaw !== "browser" &&
    channelRaw !== "agent" &&
    channelRaw !== "api"
  )
    throw new PaymentDecisionError("invalid_channel", 400);

  const rail = requiredString(raw.rail, "rail", 64).toLowerCase();
  if (!SAFE_ID.test(rail)) throw new PaymentDecisionError("invalid_rail", 400);
  const provider = requiredString(raw.provider, "provider", 64).toLowerCase();
  if (!SAFE_ID.test(provider))
    throw new PaymentDecisionError("invalid_provider", 400);

  const amount = canonicalDecimal(requiredString(raw.amount, "amount", 64));
  if (!decimalIsPositive(amount))
    throw new PaymentDecisionError("amount_must_be_positive", 400);
  const currency = requiredString(raw.currency, "currency", 12).toUpperCase();
  if (!CURRENCY.test(currency))
    throw new PaymentDecisionError("invalid_currency", 400);
  const payee = requiredString(raw.payee, "payee", 256);

  const merchantOrigin = optionalString(
    raw.merchantOrigin,
    "merchantOrigin",
    512,
  );
  if (merchantOrigin !== null) validateOriginSyntax(merchantOrigin);

  const expectedAmountRaw = optionalString(
    raw.expectedAmount,
    "expectedAmount",
    64,
  );
  const expectedAmount =
    expectedAmountRaw === null ? null : canonicalDecimal(expectedAmountRaw);
  const expectedPayee = optionalString(raw.expectedPayee, "expectedPayee", 256);
  const expiresAt = optionalString(raw.expiresAt, "expiresAt", 64);
  if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt)))
    throw new PaymentDecisionError("invalid_expires_at", 400);

  return {
    requestId,
    offerId: optionalString(raw.offerId, "offerId", 96),
    channel: channelRaw,
    rail,
    provider,
    amount,
    currency,
    payee,
    merchantOrigin,
    network: optionalString(raw.network, "network", 96),
    asset: optionalString(raw.asset, "asset", 96),
    expectedAmount,
    expectedPayee,
    expiresAt,
    paymentReference: optionalString(
      raw.paymentReference,
      "paymentReference",
      160,
    ),
    metadata: metadataObject(raw.metadata),
  };
}

export function evaluatePaymentIntent(
  input: NormalizedPaymentIntent,
  duplicateSettledReference = false,
  nowMs = Date.now(),
): DecisionEvaluation {
  const checks: PaymentCheck[] = [];
  checks.push(
    check(
      "amount_positive",
      "PASS",
      "amount_positive",
      `Observed ${input.amount} ${input.currency}`,
    ),
  );
  checks.push(
    check(
      "payee_present",
      "PASS",
      "payee_present",
      `Observed payee ${input.payee}`,
    ),
  );

  if (input.expectedAmount !== null) {
    checks.push(
      input.expectedAmount === input.amount
        ? check(
            "amount_integrity",
            "PASS",
            "expected_amount_matches",
            `Expected and observed amount are ${input.amount}`,
          )
        : check(
            "amount_integrity",
            "FAIL",
            "expected_amount_mismatch",
            `Expected ${input.expectedAmount}; observed ${input.amount}`,
          ),
    );
  }

  if (input.expectedPayee !== null) {
    checks.push(
      normalizedIdentity(input.expectedPayee) ===
        normalizedIdentity(input.payee)
        ? check(
            "destination_integrity",
            "PASS",
            "expected_payee_matches",
            "Expected and observed payee match",
          )
        : check(
            "destination_integrity",
            "FAIL",
            "expected_payee_mismatch",
            `Expected ${input.expectedPayee}; observed ${input.payee}`,
          ),
    );
  }

  if (input.merchantOrigin !== null) {
    const origin = new URL(input.merchantOrigin);
    checks.push(
      origin.protocol === "https:"
        ? check("transport_security", "PASS", "https_origin", origin.origin)
        : check(
            "transport_security",
            "FAIL",
            "insecure_payment_origin",
            origin.origin,
          ),
    );
  }

  if (input.expiresAt !== null) {
    checks.push(
      Date.parse(input.expiresAt) > nowMs
        ? check(
            "intent_freshness",
            "PASS",
            "intent_not_expired",
            input.expiresAt,
          )
        : check(
            "intent_freshness",
            "FAIL",
            "payment_intent_expired",
            input.expiresAt,
          ),
    );
  }

  if (!KNOWN_RAILS.has(input.rail))
    checks.push(
      check(
        "rail_coverage",
        "WARN",
        "unrecognized_payment_rail",
        `Rail ${input.rail} is analyzed generically; no rail-specific guarantee is claimed`,
      ),
    );
  else
    checks.push(
      check("rail_coverage", "PASS", "known_payment_rail", input.rail),
    );

  if (
    (input.rail === "x402" ||
      input.rail === "crypto_wallet" ||
      input.rail === "coinbase") &&
    input.network === null
  )
    checks.push(
      check(
        "network_binding",
        "WARN",
        "network_not_declared",
        "A crypto payment should declare the target network before execution",
      ),
    );

  if (duplicateSettledReference)
    checks.push(
      check(
        "duplicate_reference",
        "FAIL",
        "previously_settled_reference_reused",
        "The supplied payment reference already belongs to a settled XGuard record",
      ),
    );
  else if (input.paymentReference !== null)
    checks.push(
      check(
        "duplicate_reference",
        "PASS",
        "no_settled_duplicate_found",
        "No settled XGuard record reused this payment reference for this principal",
      ),
    );

  const fails = checks.filter((item) => item.status === "FAIL").length;
  const warnings = checks.filter((item) => item.status === "WARN").length;
  const decision: PaymentDecision =
    fails > 0 ? "BLOCK" : warnings > 0 ? "REVIEW" : "ALLOW";
  const riskScore = Math.min(100, fails * 40 + warnings * 15);
  return {
    decision,
    riskScore,
    reasonCodes: checks
      .filter((item) => item.status !== "PASS")
      .map((item) => item.reasonCode),
    checks,
  };
}

async function completePaymentDecision(
  env: PaymentDecisionEnv,
  principal: { principalId: string; principalName: string },
  intent: NormalizedPaymentIntent,
): Promise<PaymentDecisionReceipt> {
  const existing = await decisionRecordByRequest(
    env.DB,
    principal.principalId,
    intent.requestId,
  );
  if (existing !== null)
    return replayDecisionRecord(env.DB, principal.principalId, existing);

  const feeMicroUsd = decisionFee(env);
  let reservation;
  try {
    reservation = await reserveGatewayFee(env.DB, {
      merchantId: principal.principalId,
      requestId: intent.requestId,
      kind: "SECURITY",
      provider: "payment-decision",
      operation: `payment-decision:${intent.rail}`,
      amountMicroUsd: feeMicroUsd,
    });
  } catch (error) {
    throw mapBillingError(error);
  }

  try {
    const duplicateSettledReference = await hasSettledDuplicate(
      env.DB,
      principal.principalId,
      intent.paymentReference,
    );
    const evaluation = evaluatePaymentIntent(intent, duplicateSettledReference);
    const decisionId = await decisionIdFor(
      principal.principalId,
      intent.requestId,
    );
    const createdAt = new Date().toISOString();
    const receiptBase = {
      schemaVersion: "1.0",
      documentType: "XGUARD_INDEPENDENT_TRANSACTION_RECORD",
      decisionId,
      requestId: intent.requestId,
      createdAt,
      principal: {
        id: principal.principalId,
        name: principal.principalName,
        channel: intent.channel,
      },
      payment: {
        status: "NOT_EXECUTED",
        rail: intent.rail,
        provider: intent.provider,
        amount: intent.amount,
        currency: intent.currency,
        payee: intent.payee,
        merchantOrigin: intent.merchantOrigin,
        network: intent.network,
        asset: intent.asset,
        paymentReference: intent.paymentReference,
        metadata: intent.metadata,
      },
      decision: evaluation.decision,
      riskScore: evaluation.riskScore,
      reasonCodes: evaluation.reasonCodes,
      checks: evaluation.checks,
      xguard: {
        service: "pre-payment verification, decision and transaction evidence",
        decisionScope:
          "Evidence-grounded structural and declared-intent checks. ALLOW does not claim merchant reputation, solvency, card-network authorization, or fraud impossibility unless separately evidenced.",
        serviceFee: {
          amountMicroUsd: feeMicroUsd,
          amountUsd: microUsdToUsd(feeMicroUsd),
          trigger: "decision_and_evidence_completed",
          offerOnly: false,
          underlyingPaymentRequired: false,
        },
      },
    };
    const decisionEvidenceHash = await sha256Hex(stableStringify(receiptBase));
    const receipt = {
      ...receiptBase,
      evidence: {
        algorithm: "SHA-256",
        decisionEvidenceHash,
      },
    };

    await env.DB.prepare(
      `INSERT INTO payment_decision_records(
         decision_id,event_key,principal_id,request_id,offer_id,channel,rail,provider,
         amount,currency,payee,merchant_origin,network,asset,payment_reference,
         decision,risk_score,reason_codes_json,checks_json,fee_micro_usd,
         decision_evidence_hash,receipt_json,billing_state,settlement_status,created_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'HELD','NOT_EXECUTED',?,?)`,
    )
      .bind(
        decisionId,
        reservation.eventKey,
        principal.principalId,
        intent.requestId,
        intent.offerId,
        intent.channel,
        intent.rail,
        intent.provider,
        intent.amount,
        intent.currency,
        intent.payee,
        intent.merchantOrigin,
        intent.network,
        intent.asset,
        intent.paymentReference,
        evaluation.decision,
        evaluation.riskScore,
        JSON.stringify(evaluation.reasonCodes),
        JSON.stringify(evaluation.checks),
        feeMicroUsd,
        decisionEvidenceHash,
        JSON.stringify(receipt),
        createdAt,
        createdAt,
      )
      .run();

    await finalizeDecisionFee(
      env.DB,
      principal.principalId,
      reservation.eventKey,
      decisionId,
    );
    return { ...receipt, replayed: false };
  } catch (error) {
    await releaseIncompleteDecision(
      env.DB,
      principal.principalId,
      reservation.eventKey,
      intent.requestId,
    );
    if (error instanceof PaymentDecisionError) throw error;
    throw new PaymentDecisionError(errorMessage(error), 503);
  }
}

async function replayDecisionRecord(
  db: D1Database,
  principalId: string,
  row: DecisionRecordRow,
): Promise<PaymentDecisionReceipt> {
  if (row.billing_state !== "EARNED")
    await finalizeDecisionFee(db, principalId, row.event_key, row.decision_id);
  const receipt = parseStoredReceipt(row.receipt_json);
  return { ...receipt, replayed: true };
}

async function finalizeDecisionFee(
  db: D1Database,
  principalId: string,
  eventKey: string,
  decisionId: string,
): Promise<void> {
  try {
    await earnGatewayFee(db, {
      merchantId: principalId,
      eventKey,
      upstreamStatus: 200,
      latencyMs: 0,
    });
  } catch (error) {
    throw new PaymentDecisionError(
      `decision_fee_finalize_failed:${errorMessage(error)}`,
      503,
    );
  }

  // The gateway ledger is the financial source of truth. Once a completed
  // XGuard service fee is EARNED, projection repair cannot turn that service
  // into a false 503 or attempt to release an already-earned charge. A replay
  // calls earnGatewayFee idempotently and can repair this projection.
  await db
    .prepare(
      "UPDATE payment_decision_records SET billing_state='EARNED',updated_at=? WHERE decision_id=? AND principal_id=?",
    )
    .bind(new Date().toISOString(), decisionId, principalId)
    .run()
    .catch(() => undefined);
}

async function releaseIncompleteDecision(
  db: D1Database,
  principalId: string,
  eventKey: string,
  requestId: string,
): Promise<void> {
  try {
    await releaseGatewayFee(db, principalId, eventKey);
    await db
      .prepare(
        "DELETE FROM payment_decision_records WHERE principal_id=? AND request_id=? AND billing_state='HELD'",
      )
      .bind(principalId, requestId)
      .run();
  } catch (error) {
    if (errorMessage(error) === "earned_gateway_fee_cannot_be_released") {
      await db
        .prepare(
          "UPDATE payment_decision_records SET billing_state='EARNED',updated_at=? WHERE principal_id=? AND request_id=?",
        )
        .bind(new Date().toISOString(), principalId, requestId)
        .run()
        .catch(() => undefined);
    }
  }
}

async function getDecisionRecord(
  db: D1Database,
  principalId: string,
  decisionId: string,
): Promise<Record<string, unknown>> {
  const row = await db
    .prepare(
      `SELECT decision_id,event_key,principal_id,request_id,payment_reference,decision,
              fee_micro_usd,decision_evidence_hash,receipt_json,billing_state,
              settlement_status,settlement_evidence_hash
       FROM payment_decision_records WHERE decision_id=? AND principal_id=?`,
    )
    .bind(decisionId, principalId)
    .first<DecisionRecordRow>();
  if (row === null)
    throw new PaymentDecisionError("payment_record_not_found", 404);
  return {
    ...parseStoredReceipt(row.receipt_json),
    accounting: { feeState: row.billing_state },
  };
}

async function updateSettlementRecord(
  db: D1Database,
  principalId: string,
  decisionId: string,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertNoSensitiveKeys(raw, 0);
  assertOnlyKeys(raw, [
    "status",
    "providerTransactionId",
    "settledAmount",
    "settledAt",
  ]);
  const status = requiredString(raw.status, "status", 16).toUpperCase();
  if (!new Set(["SETTLED", "FAILED", "CANCELLED", "UNKNOWN"]).has(status))
    throw new PaymentDecisionError("invalid_settlement_status", 400);
  const providerTransactionId = optionalString(
    raw.providerTransactionId,
    "providerTransactionId",
    160,
  );
  if (status === "SETTLED" && providerTransactionId === null)
    throw new PaymentDecisionError("provider_transaction_id_required", 400);
  const settledAmountRaw = optionalString(
    raw.settledAmount,
    "settledAmount",
    64,
  );
  const settledAmount =
    settledAmountRaw === null ? null : canonicalDecimal(settledAmountRaw);
  const settledAt =
    optionalString(raw.settledAt, "settledAt", 64) ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(settledAt)))
    throw new PaymentDecisionError("invalid_settled_at", 400);

  const row = await db
    .prepare(
      `SELECT decision_id,event_key,principal_id,request_id,payment_reference,decision,
              fee_micro_usd,decision_evidence_hash,receipt_json,billing_state,
              settlement_status,settlement_evidence_hash
       FROM payment_decision_records WHERE decision_id=? AND principal_id=?`,
    )
    .bind(decisionId, principalId)
    .first<DecisionRecordRow>();
  if (row === null)
    throw new PaymentDecisionError("payment_record_not_found", 404);
  if (row.billing_state !== "EARNED")
    throw new PaymentDecisionError("payment_record_not_finalized", 409);

  const original = parseStoredReceipt(row.receipt_json);
  const outcome = {
    status,
    providerTransactionId,
    settledAmount,
    settledAt,
  };
  const settlementEvidenceHash = await sha256Hex(
    stableStringify({
      decisionEvidenceHash: row.decision_evidence_hash,
      outcome,
    }),
  );
  const updated = {
    ...original,
    payment: {
      ...(isRecord(original.payment) ? original.payment : {}),
      status,
    },
    paymentOutcome: outcome,
    evidence: {
      ...(isRecord(original.evidence) ? original.evidence : {}),
      settlementEvidenceHash,
    },
  };
  await db
    .prepare(
      `UPDATE payment_decision_records
       SET settlement_status=?,provider_transaction_id=?,settled_amount=?,settled_at=?,
           settlement_evidence_hash=?,receipt_json=?,updated_at=?
       WHERE decision_id=? AND principal_id=?`,
    )
    .bind(
      status,
      providerTransactionId,
      settledAmount,
      settledAt,
      settlementEvidenceHash,
      JSON.stringify(updated),
      new Date().toISOString(),
      decisionId,
      principalId,
    )
    .run();
  return {
    ...updated,
    accounting: { feeState: "EARNED", additionalFeeMicroUsd: 0 },
  };
}

async function decisionRecordByRequest(
  db: D1Database,
  principalId: string,
  requestId: string,
): Promise<DecisionRecordRow | null> {
  return db
    .prepare(
      `SELECT decision_id,event_key,principal_id,request_id,payment_reference,decision,
              fee_micro_usd,decision_evidence_hash,receipt_json,billing_state,
              settlement_status,settlement_evidence_hash
       FROM payment_decision_records WHERE principal_id=? AND request_id=?`,
    )
    .bind(principalId, requestId)
    .first<DecisionRecordRow>();
}

async function hasSettledDuplicate(
  db: D1Database,
  principalId: string,
  paymentReference: string | null,
): Promise<boolean> {
  if (paymentReference === null) return false;
  const row = await db
    .prepare(
      `SELECT decision_id FROM payment_decision_records
       WHERE principal_id=? AND payment_reference=? AND settlement_status='SETTLED'
       LIMIT 1`,
    )
    .bind(principalId, paymentReference)
    .first<{ decision_id: string }>();
  return row !== null;
}

async function authorizePrincipal(
  request: Request,
  env: PaymentDecisionEnv,
): Promise<{ principalId: string; principalName: string }> {
  const access = await authorizeMerchantScope(request, env, "billing");
  if (!access.ok) {
    if (access.response.status === 401)
      throw new PaymentDecisionError("xguard_access_key_required", 401);
    if (access.response.status === 403)
      throw new PaymentDecisionError("xguard_billing_scope_required", 403);
    throw new PaymentDecisionError(
      "xguard_identity_unavailable",
      access.response.status,
    );
  }
  return {
    principalId: access.merchant.merchantId,
    principalName: access.merchant.name,
  };
}

function paymentDiscovery(origin: string, env: PaymentDecisionEnv) {
  const offer = paymentDecisionOffer(env);
  return {
    name: "XGuard Payment Decision",
    version: "1.0",
    role: "optional buyer-and-agent pre-payment decision and evidence layer",
    universalIntent: true,
    x402Role: "adapter",
    surfaces: ["browser", "agent", "api"],
    endpoints: {
      offer: `${origin}${OFFER_PATH}`,
      decision: `${origin}${DECISION_PATH}`,
      record: `${origin}/v1/payment/records/{decisionId}`,
      settlementUpdate: `${origin}/v1/payment/records/{decisionId}/settlement`,
      securityEvidence: `${origin}${SECURITY_EVIDENCE_PATH}`,
      mcp: `${origin}/mcp`,
    },
    feePolicy: offer.guarantees,
    currentDecisionFeeMicroUsd: offer.feeMicroUsd,
    acceptedRailMode:
      "Known rails receive rail-aware checks; unknown rails remain analyzable with explicit reduced-coverage evidence instead of being rejected.",
  };
}

function securityEvidence(origin: string) {
  return {
    evidenceVersion: "1.0",
    policy:
      "No security PASS claim is published without a commit-bound machine-generated test result.",
    publicSources: {
      workflow:
        "https://github.com/moelayyan90/XGuard/actions/workflows/payment-security-evidence.yml",
      source: "https://github.com/moelayyan90/XGuard",
      threatModel:
        "https://github.com/moelayyan90/XGuard/blob/main/THREAT_MODEL.md",
    },
    measurableGates: [
      "TypeScript typecheck",
      "ESLint",
      "secret scan",
      "npm high-severity dependency audit",
      "payment-decision unit tests",
      "replay/idempotency assertions",
      "sensitive-payment-credential rejection assertions",
      "browser surface privacy assertions",
    ],
    runtimeProperties: {
      offerIsFree: true,
      skipIsFree: true,
      feeTrigger: "completed decision + durable evidence record",
      settlementUpdateAddsFee: false,
      rawCardCredentialsAccepted: false,
    },
    evidenceEndpoint: `${origin}${SECURITY_EVIDENCE_PATH}`,
  };
}

function decisionFee(env: PaymentDecisionEnv): number {
  const raw =
    env.XGUARD_PAYMENT_DECISION_FEE_MICRO_USD ??
    env.XGUARD_SECURITY_FEE_MICRO_USD ??
    "1000";
  if (!/^[1-9][0-9]{0,12}$/.test(raw))
    throw new PaymentDecisionError("invalid_payment_decision_fee_config", 503);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new PaymentDecisionError("invalid_payment_decision_fee_config", 503);
  return value;
}

function mapBillingError(error: unknown): PaymentDecisionError {
  const code = errorMessage(error);
  if (code === "insufficient_service_balance")
    return new PaymentDecisionError("insufficient_xguard_balance", 402);
  if (code === "gateway_event_in_progress")
    return new PaymentDecisionError("payment_decision_in_progress", 409);
  if (code === "gateway_event_already_earned")
    return new PaymentDecisionError("payment_decision_already_completed", 409);
  return new PaymentDecisionError(code, 400);
}

function check(
  id: string,
  status: CheckStatus,
  reasonCode: string,
  evidence: string,
): PaymentCheck {
  return { id, status, reasonCode, evidence };
}

function canonicalDecimal(value: string): string {
  if (!DECIMAL.test(value))
    throw new PaymentDecisionError("invalid_amount", 400);
  const [wholeRaw = "0", fractionRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function decimalIsPositive(value: string): boolean {
  return /[1-9]/.test(value);
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function validateOriginSyntax(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentDecisionError("invalid_merchant_origin", 400);
  }
  if (url.username !== "" || url.password !== "")
    throw new PaymentDecisionError("invalid_merchant_origin", 400);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new PaymentDecisionError("invalid_merchant_origin", 400);
}

function metadataObject(
  value: unknown,
): Record<string, string | number | boolean> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value))
    throw new PaymentDecisionError("metadata_must_be_object", 400);
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS)
    throw new PaymentDecisionError("metadata_too_large", 400);
  const out: Record<string, string | number | boolean> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9._-]{1,48}$/.test(key) || SENSITIVE_KEYS.test(key))
      throw new PaymentDecisionError("invalid_metadata_key", 400);
    if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    )
      throw new PaymentDecisionError("invalid_metadata_value", 400);
    if (typeof item === "string" && item.length > 256)
      throw new PaymentDecisionError("metadata_value_too_long", 400);
    if (typeof item === "number" && !Number.isFinite(item))
      throw new PaymentDecisionError("invalid_metadata_value", 400);
    out[key] = item;
  }
  return out;
}

function assertNoSensitiveKeys(value: unknown, depth: number): void {
  if (depth > 8) throw new PaymentDecisionError("payload_too_deep", 400);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveKeys(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key))
      throw new PaymentDecisionError("raw_payment_credentials_forbidden", 400);
    assertNoSensitiveKeys(item, depth + 1);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value))
    if (!set.has(key))
      throw new PaymentDecisionError(`unexpected_field:${key}`, 400);
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string")
    throw new PaymentDecisionError(`${field}_required`, 400);
  const result = value.trim();
  if (result === "" || result.length > max)
    throw new PaymentDecisionError(`invalid_${field}`, 400);
  return result;
}

function optionalString(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new PaymentDecisionError(`invalid_${field}`, 400);
  const result = value.trim();
  if (result === "" || result.length > max)
    throw new PaymentDecisionError(`invalid_${field}`, 400);
  return result;
}

async function readOptionalJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length === null || Number(length) === 0) return {};
  return readJsonObject(request);
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_JSON_BODY_BYTES)
    throw new PaymentDecisionError("request_body_too_large", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES)
    throw new PaymentDecisionError("request_body_too_large", 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PaymentDecisionError("invalid_json", 400);
  }
  if (!isRecord(parsed))
    throw new PaymentDecisionError("json_object_required", 400);
  return parsed;
}

function parseStoredReceipt(value: string): PaymentDecisionReceipt {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.decisionId !== "string" ||
      typeof parsed.requestId !== "string" ||
      (parsed.decision !== "ALLOW" &&
        parsed.decision !== "REVIEW" &&
        parsed.decision !== "BLOCK") ||
      !isRecord(parsed.principal) ||
      !isRecord(parsed.payment) ||
      !isRecord(parsed.xguard) ||
      !isRecord(parsed.evidence) ||
      !Array.isArray(parsed.reasonCodes) ||
      !Array.isArray(parsed.checks)
    )
      throw new Error("invalid");
    return parsed as unknown as PaymentDecisionReceipt;
  } catch {
    throw new PaymentDecisionError("stored_payment_record_corrupt", 503);
  }
}

async function decisionIdFor(
  principalId: string,
  requestId: string,
): Promise<string> {
  const digest = await sha256Hex(`${principalId}:${requestId}`);
  return `pd_${digest.slice(0, 32)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function microUsdToUsd(value: number): string {
  const whole = Math.trunc(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`;
}

function errorResponse(error: unknown): Response {
  const normalized =
    error instanceof PaymentDecisionError
      ? error
      : new PaymentDecisionError(errorMessage(error), 500);
  return privateJson({ error: normalized.message }, normalized.status);
}

function publicJson(value: unknown, status = 200): Response {
  return corsResponse(
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      },
    }),
  );
}

function privateJson(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return corsResponse(
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    }),
  );
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-XGuard-Request-ID",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "X-XGuard-Decision, X-XGuard-Decision-ID, X-XGuard-Fee-Micro-USD",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "payment_decision_failed";
}
