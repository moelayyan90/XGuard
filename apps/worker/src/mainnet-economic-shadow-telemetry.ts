import type { MainnetEconomicShadowBinding } from "./mainnet-economic-shadow.js";

const SHADOW_RETENTION_MS = 48 * 60 * 60 * 1000;

export type MainnetEconomicShadowOperation = "verify" | "settle";

export interface MainnetEconomicShadowStats {
  intents: number;
  verifyEvents: number;
  settleEvents: number;
  correlatedIntents: number;
  settleWithoutVerifyIntents: number;
  authorizationMismatchEvents: number;
}

export async function recordMainnetEconomicShadowObservation(
  db: D1Database,
  merchantId: string,
  shadow: MainnetEconomicShadowBinding,
  operation: MainnetEconomicShadowOperation,
  now = new Date(),
): Promise<void> {
  const seenAt = now.toISOString();
  const verifyCount = operation === "verify" ? 1 : 0;
  const settleCount = operation === "settle" ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO economic_firewall_shadow_observations (
        merchant_id,
        intent_id,
        terms_hash,
        first_authorization_hash,
        last_authorization_hash,
        amount_micro_usd,
        expires_at,
        verify_count,
        settle_count,
        authorization_mismatch_count,
        first_seen_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(merchant_id, intent_id) DO UPDATE SET
        last_authorization_hash = excluded.last_authorization_hash,
        expires_at = excluded.expires_at,
        verify_count = economic_firewall_shadow_observations.verify_count + excluded.verify_count,
        settle_count = economic_firewall_shadow_observations.settle_count + excluded.settle_count,
        authorization_mismatch_count = economic_firewall_shadow_observations.authorization_mismatch_count +
          CASE
            WHEN economic_firewall_shadow_observations.last_authorization_hash <> excluded.last_authorization_hash THEN 1
            ELSE 0
          END,
        last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      merchantId,
      shadow.intent.intentId,
      shadow.intent.termsHash,
      shadow.authorizationHash,
      shadow.authorizationHash,
      shadow.amountMicroUsd,
      shadow.expiresAt,
      verifyCount,
      settleCount,
      seenAt,
      seenAt,
    )
    .run();
}

export async function mainnetEconomicShadowStats(
  db: D1Database,
): Promise<MainnetEconomicShadowStats> {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) AS intents,
        COALESCE(SUM(verify_count), 0) AS verify_events,
        COALESCE(SUM(settle_count), 0) AS settle_events,
        COALESCE(SUM(CASE WHEN verify_count > 0 AND settle_count > 0 THEN 1 ELSE 0 END), 0) AS correlated_intents,
        COALESCE(SUM(CASE WHEN verify_count = 0 AND settle_count > 0 THEN 1 ELSE 0 END), 0) AS settle_without_verify_intents,
        COALESCE(SUM(authorization_mismatch_count), 0) AS authorization_mismatch_events
      FROM economic_firewall_shadow_observations`,
    )
    .first<{
      intents: number;
      verify_events: number;
      settle_events: number;
      correlated_intents: number;
      settle_without_verify_intents: number;
      authorization_mismatch_events: number;
    }>();

  return {
    intents: safeCount(row?.intents),
    verifyEvents: safeCount(row?.verify_events),
    settleEvents: safeCount(row?.settle_events),
    correlatedIntents: safeCount(row?.correlated_intents),
    settleWithoutVerifyIntents: safeCount(row?.settle_without_verify_intents),
    authorizationMismatchEvents: safeCount(row?.authorization_mismatch_events),
  };
}

export async function pruneMainnetEconomicShadowTelemetry(
  db: D1Database,
  nowMs = Date.now(),
): Promise<void> {
  const cutoff = new Date(nowMs - SHADOW_RETENTION_MS).toISOString();
  await db
    .prepare(
      "DELETE FROM economic_firewall_shadow_observations WHERE last_seen_at < ?",
    )
    .bind(cutoff)
    .run();
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
