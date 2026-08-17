import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  finalizeGatewayExecutionSuccess,
  releaseGatewayExecutionReservation,
} from "../../apps/worker/src/universal-gateway.js";
import { reserveGatewayFee } from "../../apps/worker/src/universal-gateway-billing.js";

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

describe("universal gateway execution accounting", () => {
  it("earns after a successful execution when accounting succeeds", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "gateway-earned");

    expect(
      await finalizeGatewayExecutionSuccess(env.DB, {
        merchantId,
        eventKey: reservation.eventKey,
        upstreamStatus: 200,
        latencyMs: 1,
        requestBytes: 4,
        responseBytes: 8,
      }),
    ).toBe("earned");
    expect(await reservationState(reservation.eventKey)).toBe("EARNED");
  });

  it("releases instead of converting a successful execution into a client retry when earn fails before transition", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "gateway-release-fallback");

    expect(
      await finalizeGatewayExecutionSuccess(env.DB, {
        merchantId,
        eventKey: reservation.eventKey,
        upstreamStatus: 200,
        latencyMs: 1,
        responseBytes: -1,
      }),
    ).toBe("released");
    expect(await reservationState(reservation.eventKey)).toBe("RELEASED");
    expect(await merchantBalance(merchantId)).toEqual({
      available: 1_000,
      held: 0,
    });
  });

  it("marks the fee pending-release if both earn and immediate release fail", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "gateway-pending-release");
    await env.DB.prepare(
      "UPDATE merchants SET held_balance_micro_usd=0 WHERE merchant_id=?",
    )
      .bind(merchantId)
      .run();

    expect(
      await finalizeGatewayExecutionSuccess(env.DB, {
        merchantId,
        eventKey: reservation.eventKey,
        upstreamStatus: 200,
        latencyMs: 1,
      }),
    ).toBe("pending-release");
    expect(await reservationState(reservation.eventKey)).toBe("HELD");
  });

  it("reports released when a failed execution returns its reservation", async () => {
    const merchantId = await fundedMerchant(1_000);
    const reservation = await reserve(merchantId, "gateway-upstream-failed");

    expect(
      await releaseGatewayExecutionReservation(
        env.DB,
        merchantId,
        reservation.eventKey,
      ),
    ).toBe("released");
    expect(await reservationState(reservation.eventKey)).toBe("RELEASED");
  });
});

async function reserve(merchantId: string, requestId: string) {
  return reserveGatewayFee(env.DB, {
    merchantId,
    requestId,
    kind: "SOURCE",
    provider: "github",
    operation: "POST:/example",
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
      `Universal ${merchantId}`,
      `hash:${merchantId}`,
      amountMicroUsd,
      new Date().toISOString(),
    )
    .run();
  return merchantId;
}

async function reservationState(eventKey: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT state FROM gateway_fee_reservations WHERE event_key=?",
  )
    .bind(eventKey)
    .first<{ state: string }>();
  return row?.state ?? null;
}

async function merchantBalance(
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
