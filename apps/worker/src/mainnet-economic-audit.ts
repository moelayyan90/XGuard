import type { MainnetEconomicShadowBinding } from "./mainnet-economic-shadow.js";

export type MainnetEconomicAuditMode = "off" | "audit";
export type MainnetEconomicAuditVerdict = "PASS" | "REVIEW";
export type MainnetEconomicAuditReason =
  | "CORRELATED_AUTHORIZATION"
  | "VERIFY_NOT_OBSERVED"
  | "AUTHORIZATION_MISMATCH";

export interface MainnetEconomicAuditDecision {
  verdict: MainnetEconomicAuditVerdict;
  reason: MainnetEconomicAuditReason;
}

export interface MainnetEconomicAuditStats {
  evaluatedSettles: number;
  pass: number;
  review: number;
  correlatedAuthorization: number;
  verifyNotObserved: number;
  authorizationMismatch: number;
}

export function parseMainnetEconomicAuditMode(
  value: string | undefined,
): MainnetEconomicAuditMode {
  return value?.trim().toLowerCase() === "audit" ? "audit" : "off";
}

export async function evaluateMainnetEconomicSettlementAudit(
  db: D1Database,
  merchantId: string,
  shadow: MainnetEconomicShadowBinding,
): Promise<MainnetEconomicAuditDecision> {
  const row = await db
    .prepare(
      `SELECT verify_count,last_authorization_hash
       FROM economic_firewall_shadow_observations
       WHERE merchant_id=? AND intent_id=?`,
    )
    .bind(merchantId, shadow.intent.intentId)
    .first<{ verify_count: number; last_authorization_hash: string }>();

  if (row === null || safeCount(row.verify_count) === 0)
    return { verdict: "REVIEW", reason: "VERIFY_NOT_OBSERVED" };

  if (row.last_authorization_hash !== shadow.authorizationHash)
    return { verdict: "REVIEW", reason: "AUTHORIZATION_MISMATCH" };

  return { verdict: "PASS", reason: "CORRELATED_AUTHORIZATION" };
}

export async function recordMainnetEconomicAuditDecision(
  db: D1Database,
  decision: MainnetEconomicAuditDecision,
  now = new Date(),
): Promise<void> {
  const seenAt = now.toISOString();
  await db
    .prepare(
      `INSERT INTO economic_firewall_audit_summary(
        verdict,reason,event_count,first_seen_at,last_seen_at
      ) VALUES(?,?,1,?,?)
      ON CONFLICT(verdict,reason) DO UPDATE SET
        event_count=economic_firewall_audit_summary.event_count+1,
        last_seen_at=excluded.last_seen_at`,
    )
    .bind(decision.verdict, decision.reason, seenAt, seenAt)
    .run();
}

export async function mainnetEconomicAuditStats(
  db: D1Database,
): Promise<MainnetEconomicAuditStats> {
  const rows = await db
    .prepare(
      `SELECT verdict,reason,event_count
       FROM economic_firewall_audit_summary`,
    )
    .all<{
      verdict: MainnetEconomicAuditVerdict;
      reason: MainnetEconomicAuditReason;
      event_count: number;
    }>();

  const stats: MainnetEconomicAuditStats = {
    evaluatedSettles: 0,
    pass: 0,
    review: 0,
    correlatedAuthorization: 0,
    verifyNotObserved: 0,
    authorizationMismatch: 0,
  };

  for (const row of rows.results) {
    const count = safeCount(row.event_count);
    stats.evaluatedSettles += count;
    if (row.verdict === "PASS") stats.pass += count;
    else if (row.verdict === "REVIEW") stats.review += count;

    if (row.reason === "CORRELATED_AUTHORIZATION")
      stats.correlatedAuthorization += count;
    else if (row.reason === "VERIFY_NOT_OBSERVED")
      stats.verifyNotObserved += count;
    else if (row.reason === "AUTHORIZATION_MISMATCH")
      stats.authorizationMismatch += count;
  }

  return stats;
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
