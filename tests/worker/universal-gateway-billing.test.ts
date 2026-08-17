import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  earnGatewayFee,
  releaseGatewayFee,
  reserveGatewayFee,
} from "../../apps/worker/src/universal-gateway-billing.js";

const FEE = 50;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gateway_usage_events"),
    env.DB.prepare("DELETE FROM gateway_fee_reservations"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM merchants"),
  ]);
});

describe("universal gateway held-balance invariants", () => {
  it("does not earn a gateway fee when the held balance no longer backs the reservation", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserveGatewayFee(env.DB, {
      merchantId,
      requestId: "gateway-earn-drift",
      kind: "ANALYSIS",
      provider: "xguard",
      operation: "analysis/test",
      amountMicroUsd: FEE,
    });

    await env.DB.prepare(
      "UPDATE merchants SET held_balance_micro_usd=0 WHERE merchant_id=?",
    )
      .bind(merchantId)
      .run();

    await expect(
      earnGatewayFee(env.DB, {
        merchantId,
        eventKey: reservation.eventKey,
        upstreamStatus: 200,
        latencyMs: 1,
      }),
    ).rejects.toThrow("gateway_fee_transition_race_lost");

    await expectReservationState(reservation.eventKey, "HELD");
    expect(await usageCount(reservation.eventKey)).toBe(0);
    expect(await ledgerCount(`gateway:${reservation.eventKey}`)).toBe(0);
  });

  it("does not release a gateway fee when the held balance no longer backs the reservation", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserveGatewayFee(env.DB, {
      merchantId,
      requestId: "gateway-release-drift",
      kind: "SOURCE",
      provider: "xguard",
      operation: "source/test",
      amountMicroUsd: FEE,
    });

    await env.DB.prepare(
      "UPDATE merchants SET held_balance_micro_usd=0 WHERE merchant_id=?",
    )
      .bind(merchantId)
      .run();

    await expect(
      releaseGatewayFee(env.DB, merchantId, reservation.eventKey),
    ).rejects.toThrow("gateway_fee_transition_race_lost");

    await expectReservationState(reservation.eventKey, "HELD");
    const balance = await env.DB.prepare(
      "SELECT available_balance_micro_usd,held_balance_micro_usd FROM merchants WHERE merchant_id=?",
    )
      .bind(merchantId)
      .first<{
        available_balance_micro_usd: number;
        held_balance_micro_usd: number;
      }>();
    expect(balance).toEqual({
      available_balance_micro_usd: 1_000 - FEE,
      held_balance_micro_usd: 0,
    });
  });
});

async function fundedMerchant(amountMicroUsd: number): Promise<string> {
  const merchantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO merchants(
       merchant_id,name,api_key_hash,available_balance_micro_usd,
       held_balance_micro_usd,active,created_at
     ) VALUES(?,?,?, ?,0,1,?)`,
  )
    .bind(
      merchantId,
      `Gateway ${merchantId}`,
      `hash:${merchantId}`,
      amountMicroUsd,
      new Date().toISOString(),
    )
    .run();
  return merchantId;
}

async function expectReservationState(
  eventKey: string,
  expected: "HELD" | "EARNED" | "RELEASED",
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT state FROM gateway_fee_reservations WHERE event_key=?",
  )
    .bind(eventKey)
    .first<{ state: string }>();
  expect(row?.state).toBe(expected);
}

async function usageCount(eventKey: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM gateway_usage_events WHERE event_key=?",
  )
    .bind(eventKey)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function ledgerCount(eventId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM ledger_entries WHERE event_id=?",
  )
    .bind(eventId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
