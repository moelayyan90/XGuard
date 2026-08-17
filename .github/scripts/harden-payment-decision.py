from pathlib import Path
import re

path = Path("apps/worker/src/payment-decision.ts")
text = path.read_text()

marker = """export interface DecisionEvaluation {
  decision: PaymentDecision;
  riskScore: number;
  reasonCodes: string[];
  checks: PaymentCheck[];
}
"""
receipt = marker + """

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
"""
if "export interface PaymentDecisionReceipt {" not in text:
    if marker not in text:
        raise SystemExit("PaymentDecisionReceipt insertion point not found")
    text = text.replace(marker, receipt, 1)

text = text.replace(
    "): Promise<Record<string, unknown>> {\n  const principal = await authorizePrincipal(request, env);\n  const intent = normalizePaymentDecisionInput({ ...raw, channel: \"agent\" });\n  return completePaymentDecision(env, principal, intent);\n}",
    "): Promise<PaymentDecisionReceipt> {\n  const principal = await authorizePrincipal(request, env);\n  const intent = normalizePaymentDecisionInput({ ...raw, channel: \"agent\" });\n  return completePaymentDecision(env, principal, intent);\n}",
    1,
)
text = text.replace("): Promise<any> {", "): Promise<PaymentDecisionReceipt> {")

raw_captures = text.count("recordMatch[1]")
if raw_captures == 2:
    text = text.replace("recordMatch[1]", '(recordMatch[1] ?? "")')
elif text.count('(recordMatch[1] ?? "")') != 2:
    raise SystemExit(f"unexpected recordMatch capture state: {raw_captures}")

text = text.replace(
    'const [wholeRaw, fractionRaw = ""] = value.split(".");',
    'const [wholeRaw = "0", fractionRaw = ""] = value.split(".");',
    1,
)

finalize_pattern = re.compile(
    r"async function finalizeDecisionFee\([\s\S]*?\n}\n\nasync function releaseIncompleteDecision",
    re.M,
)
finalize_replacement = """async function finalizeDecisionFee(
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

async function releaseIncompleteDecision"""
text, count = finalize_pattern.subn(finalize_replacement, text, count=1)
if count != 1:
    raise SystemExit("finalizeDecisionFee replacement point not found")

parse_pattern = re.compile(
    r"function parseStoredReceipt\(value: string\): Record<string, any> \{[\s\S]*?\n}\n\nasync function decisionIdFor",
    re.M,
)
if parse_pattern.search(text):
    parse_replacement = """function parseStoredReceipt(value: string): PaymentDecisionReceipt {
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

async function decisionIdFor"""
    text, count = parse_pattern.subn(parse_replacement, text, count=1)
    if count != 1:
        raise SystemExit("parseStoredReceipt replacement failed")
elif "function parseStoredReceipt(value: string): PaymentDecisionReceipt" not in text:
    raise SystemExit("parseStoredReceipt state unknown")

path.write_text(text)

worker = Path("browser-extension/service-worker.js")
worker_text = worker.read_text().replace(
    "/* global chrome, crypto, fetch */",
    "/* global chrome, crypto */",
    1,
)
worker.write_text(worker_text)

privacy = Path("tests/browser-payment-surface-source.test.ts")
privacy_text = privacy.read_text().replace(r"['\"]?", r'''['"]?''', 1)
privacy.write_text(privacy_text)
