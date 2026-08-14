import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateMerchant,
  claimTopUp,
  createTopUpIntent,
  earnSettlementFee,
  markSettlementFeeAmbiguous,
  merchantBalance,
  registerMerchant,
  releaseSettlementFee,
  reserveSettlementFee,
} from "../../apps/worker/src/mainnet-billing.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TREASURY = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";
const NOW = 2_000_000_000;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM usage_events"),
    env.DB.prepare("DELETE FROM settlement_projection"),
    env.DB.prepare("DELETE FROM fee_reservations"),
    env.DB.prepare("DELETE FROM top_ups"),
    env.DB.prepare("DELETE FROM top_up_intents"),
    env.DB.prepare("DELETE FROM merchants"),
  ]);
});

describe("mainnet merchant prepaid billing", () => {
  it("registers and authenticates a high-entropy merchant API key", async () => {
    const created = await registerMerchant(env.DB, "Acme Merchant");
    expect(created.apiKey).toMatch(/^xg_live_[A-Za-z0-9_-]{40,}$/);
    await expect(authenticateMerchant(env.DB, created.apiKey)).resolves.toEqual(
      {
        merchantId: created.merchant.merchantId,
        name: "Acme Merchant",
      },
    );
    await expect(authenticateMerchant(env.DB, "wrong")).resolves.toBeNull();
  });

  it("credits one finalized post-intent USDC top-up exactly once", async () => {
    const created = await registerMerchant(env.DB, "Topup Merchant");
    const intent = await createTopUpIntent(
      env.DB,
      created.merchant.merchantId,
      5_000_000,
      NOW,
    );
    const deposit = {
      transactionHash: `0x${"a".repeat(64)}`,
      sender: SENDER,
      recipient: TREASURY,
      amountMicroUsd: intent.amountMicroUsd,
      blockNumber: 100,
      blockTimestampSeconds: NOW + 10,
      logIndex: 1,
    };

    const credited = await claimTopUp(
      env.DB,
      {
        merchantId: created.merchant.merchantId,
        claimToken: intent.claimToken,
        deposit,
        network: "eip155:8453",
        asset: USDC,
      },
      NOW + 20,
    );
    expect(credited.availableMicroUsd).toBe(intent.amountMicroUsd);
    expect(credited.heldMicroUsd).toBe(0);

    await expect(
      claimTopUp(
        env.DB,
        {
          merchantId: created.merchant.merchantId,
          claimToken: intent.claimToken,
          deposit,
          network: "eip155:8453",
          asset: USDC,
        },
        NOW + 30,
      ),
    ).rejects.toThrow("top_up_intent_unavailable");

    const topUps = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM top_ups",
    ).first<{ count: number }>();
    expect(topUps?.count).toBe(1);
    const ledger = await env.DB.prepare(
      "SELECT account,side,amount_micro_usd FROM ledger_entries ORDER BY account",
    ).all();
    expect(ledger.results).toHaveLength(2);
    expect(ledger.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: "CUSTOMER_BALANCES",
          side: "DEBIT",
          amount_micro_usd: intent.amountMicroUsd,
        }),
        expect.objectContaining({
          account: "UNEARNED_LIABILITY",
          side: "CREDIT",
          amount_micro_usd: intent.amountMicroUsd,
        }),
      ]),
    );
  });

  it("rejects a deposit that predates its one-time intent", async () => {
    const created = await registerMerchant(env.DB, "Clock Merchant");
    const intent = await createTopUpIntent(
      env.DB,
      created.merchant.merchantId,
      1_000_000,
      NOW,
    );
    await expect(
      claimTopUp(
        env.DB,
        {
          merchantId: created.merchant.merchantId,
          claimToken: intent.claimToken,
          deposit: {
            transactionHash: `0x${"b".repeat(64)}`,
            sender: SENDER,
            recipient: TREASURY,
            amountMicroUsd: intent.amountMicroUsd,
            blockNumber: 90,
            blockTimestampSeconds: NOW - 31,
            logIndex: 0,
          },
          network: "eip155:8453",
          asset: USDC,
        },
        NOW + 5,
      ),
    ).rejects.toThrow("top_up_predates_intent");
  });

  it("reserves once, releases definitive failures, and never double-debits", async () => {
    const created = await fundedMerchant(20_000);
    const key = "payment-release";
    const [first, second] = await Promise.all([
      reserveSettlementFee(env.DB, created.merchantId, key, 2_000),
      reserveSettlementFee(env.DB, created.merchantId, key, 2_000),
    ]);
    expect(first.state).toBe("HELD");
    expect(second.state).toBe("HELD");
    expect(await merchantBalance(env.DB, created.merchantId)).toMatchObject({
      availableMicroUsd: created.balance.availableMicroUsd - 2_000,
      heldMicroUsd: 2_000,
    });

    await releaseSettlementFee(env.DB, created.merchantId, key);
    expect(await merchantBalance(env.DB, created.merchantId)).toMatchObject({
      availableMicroUsd: created.balance.availableMicroUsd,
      heldMicroUsd: 0,
    });
  });

  it("keeps ambiguous fees held until independent finality earns them once", async () => {
    const created = await fundedMerchant(20_000);
    const key = "payment-finality";
    await reserveSettlementFee(env.DB, created.merchantId, key, 2_000);
    await markSettlementFeeAmbiguous(env.DB, created.merchantId, key);
    expect(await merchantBalance(env.DB, created.merchantId)).toMatchObject({
      availableMicroUsd: created.balance.availableMicroUsd - 2_000,
      heldMicroUsd: 2_000,
    });

    await insertSettledProjection(key);
    await earnSettlementFee(env.DB, created.merchantId, key);
    await earnSettlementFee(env.DB, created.merchantId, key);

    expect(await merchantBalance(env.DB, created.merchantId)).toMatchObject({
      availableMicroUsd: created.balance.availableMicroUsd - 2_000,
      heldMicroUsd: 0,
    });
    const usage = await env.DB.prepare(
      "SELECT COUNT(*) AS count,SUM(fee_micro_usd) AS total FROM usage_events WHERE logical_payment_key=?",
    )
      .bind(key)
      .first<{ count: number; total: number }>();
    expect(usage).toEqual({ count: 1, total: 2_000 });
    const feeLedger = await env.DB.prepare(
      "SELECT account,side,amount_micro_usd FROM ledger_entries WHERE event_id=? ORDER BY account",
    )
      .bind(`fee:${key}`)
      .all();
    expect(feeLedger.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: "UNEARNED_LIABILITY",
          side: "DEBIT",
          amount_micro_usd: 2_000,
        }),
        expect.objectContaining({
          account: "EARNED_REVENUE",
          side: "CREDIT",
          amount_micro_usd: 2_000,
        }),
      ]),
    );
  });

  it("fails closed when the merchant cannot cover the service fee", async () => {
    const created = await registerMerchant(env.DB, "Empty Merchant");
    await expect(
      reserveSettlementFee(
        env.DB,
        created.merchant.merchantId,
        "payment-empty",
        2_000,
      ),
    ).rejects.toThrow("insufficient_service_balance");
    expect(
      await merchantBalance(env.DB, created.merchant.merchantId),
    ).toMatchObject({
      availableMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });
});

async function fundedMerchant(amountMicroUsd: number) {
  const created = await registerMerchant(
    env.DB,
    `Merchant ${crypto.randomUUID()}`,
  );
  const intent = await createTopUpIntent(
    env.DB,
    created.merchant.merchantId,
    amountMicroUsd,
    NOW,
  );
  const balance = await claimTopUp(
    env.DB,
    {
      merchantId: created.merchant.merchantId,
      claimToken: intent.claimToken,
      deposit: {
        transactionHash: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
        sender: SENDER,
        recipient: TREASURY,
        amountMicroUsd: intent.amountMicroUsd,
        blockNumber: 101,
        blockTimestampSeconds: NOW + 5,
        logIndex: 0,
      },
      network: "eip155:8453",
      asset: USDC,
    },
    NOW + 10,
  );
  return { merchantId: created.merchant.merchantId, balance };
}

async function insertSettledProjection(logicalPaymentKey: string) {
  await env.DB.prepare(
    "INSERT INTO settlement_projection(logical_payment_key,request_fingerprint,payment_identifier,network,facilitator_id,state,transaction_hash,testnet,fee_micro_usd,downstream_cost_micro_usd,recorded_at) VALUES(?,?,?,?,?,'SETTLED',?,0,0,0,?)",
  )
    .bind(
      logicalPaymentKey,
      `fingerprint-${logicalPaymentKey}`,
      null,
      "eip155:8453",
      "payai-mainnet",
      `0x${"c".repeat(64)}`,
      new Date().toISOString(),
    )
    .run();
}
