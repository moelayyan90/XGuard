import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  earnGatewayFee,
  releaseStaleGatewayHolds,
  reserveGatewayFee,
} from "../../apps/worker/src/universal-gateway-billing.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-17T07:00:00.000Z");
const FEE = 25;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gateway_usage_events"),
    env.DB.prepare("DELETE FROM gateway_fee_reservations"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM gateway_provider_credentials"),
    env.DB.prepare("DELETE FROM merchants"),
  ]);
});

describe("stale gateway held recovery", () => {
  it("returns an old unearned hold to the merchant", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "stale-release");
    await ageReservation(reservation.eventKey, NOW - 2 * HOUR);

    const result = await releaseStaleGatewayHolds(env.DB, {
      nowMs: NOW,
      staleAfterMs: HOUR,
      limit: 50,
    });

    expect(result).toEqual({ scanned: 1, released: 1, failed: 0 });
    expect(await state(reservation.eventKey)).toBe("RELEASED");
    expect(await balance(merchantId)).toEqual({ available: 1_000, held: 0 });
  });

  it("does not touch a recent hold", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "recent-hold");
    await ageReservation(reservation.eventKey, NOW - 30 * 60 * 1000);

    const result = await releaseStaleGatewayHolds(env.DB, {
      nowMs: NOW,
      staleAfterMs: HOUR,
      limit: 50,
    });

    expect(result).toEqual({ scanned: 0, released: 0, failed: 0 });
    expect(await state(reservation.eventKey)).toBe("HELD");
    expect(await balance(merchantId)).toEqual({
      available: 1_000 - FEE,
      held: FEE,
    });
  });

  it("never releases an earned event", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "earned-event");
    await earnGatewayFee(env.DB, {
      merchantId,
      eventKey: reservation.eventKey,
      upstreamStatus: 200,
      latencyMs: 1,
    });
    await ageReservation(reservation.eventKey, NOW - 2 * HOUR);

    const result = await releaseStaleGatewayHolds(env.DB, {
      nowMs: NOW,
      staleAfterMs: HOUR,
      limit: 50,
    });

    expect(result).toEqual({ scanned: 0, released: 0, failed: 0 });
    expect(await state(reservation.eventKey)).toBe("EARNED");
  });

  it("does not release a HELD reservation that already has usage evidence", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "usage-evidence");
    await ageReservation(reservation.eventKey, NOW - 2 * HOUR);
    await env.DB.prepare(
      `INSERT INTO gateway_usage_events(
         event_id,event_key,merchant_id,request_id,kind,provider,operation,
         fee_micro_usd,upstream_status,latency_ms,request_bytes,response_bytes,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        `synthetic:${reservation.eventKey}`,
        reservation.eventKey,
        merchantId,
        "usage-evidence",
        "MODEL",
        "openai",
        "POST:/v1/responses",
        FEE,
        200,
        1,
        0,
        0,
        new Date(NOW - 2 * HOUR).toISOString(),
      )
      .run();

    const result = await releaseStaleGatewayHolds(env.DB, {
      nowMs: NOW,
      staleAfterMs: HOUR,
      limit: 50,
    });

    expect(result).toEqual({ scanned: 0, released: 0, failed: 0 });
    expect(await state(reservation.eventKey)).toBe("HELD");
  });

  it("leaves an unbacked hold in place and reports a failed recovery", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "drifted-hold");
    await ageReservation(reservation.eventKey, NOW - 2 * HOUR);
    await env.DB.prepare(
      "UPDATE merchants SET held_balance_micro_usd=0 WHERE merchant_id=?",
    )
      .bind(merchantId)
      .run();

    const result = await releaseStaleGatewayHolds(env.DB, {
      nowMs: NOW,
      staleAfterMs: HOUR,
      limit: 50,
    });

    expect(result).toEqual({ scanned: 1, released: 0, failed: 1 });
    expect(await state(reservation.eventKey)).toBe("HELD");
  });
});

async function reserve(merchantId: string, requestId: string) {
  return reserveGatewayFee(env.DB, {
    merchantId,
    requestId,
    kind: "MODEL",
    provider: "openai",
    operation: "POST:/v1/responses",
    amountMicroUsd: FEE,
  });
}

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
      `Recovery ${merchantId}`,
      `hash:${merchantId}`,
      amountMicroUsd,
      new Date(NOW).toISOString(),
    )
    .run();
  return merchantId;
}

async function ageReservation(eventKey: string, atMs: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE gateway_fee_reservations SET updated_at=? WHERE event_key=?",
  )
    .bind(new Date(atMs).toISOString(), eventKey)
    .run();
}

async function state(eventKey: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT state FROM gateway_fee_reservations WHERE event_key=?",
  )
    .bind(eventKey)
    .first<{ state: string }>();
  return row?.state ?? null;
}

async function balance(
  merchantId: string,
): Promise<{ available: number; held: number } | null> {
  const row = await env.DB.prepare(
    "SELECT available_balance_micro_usd,held_balance_micro_usd FROM merchants WHERE merchant_id=?",
  )
    .bind(merchantId)
    .first<{
      available_balance_micro_usd: number;
      held_balance_micro_usd: number;
    }>();
  return row === null
    ? null
    : {
        available: row.available_balance_micro_usd,
        held: row.held_balance_micro_usd,
      };
}
