import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateMerchant,
  claimTopUp,
  createTopUpIntent,
  merchantBalance,
  registerMerchant,
} from "../../apps/worker/src/mainnet-billing.js";
import {
  creditAutomaticTopUpDeposit,
  currentUnitEconomics,
  preparePrepaidFee,
  releaseExpiredVerifyHolds,
  revokeMerchantApiKey,
  rotateMerchantApiKey,
} from "../../apps/worker/src/mainnet-revenue-hardening.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TREASURY = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";
const PAY_TO = "0x3333333333333333333333333333333333333333";
const NOW = 2_000_000_000;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM verify_fee_holds"),
    env.DB.prepare("DELETE FROM runtime_economics"),
    env.DB.prepare("DELETE FROM treasury_scan_state"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM usage_events"),
    env.DB.prepare("DELETE FROM settlement_projection"),
    env.DB.prepare("DELETE FROM fee_reservations"),
    env.DB.prepare("DELETE FROM top_ups"),
    env.DB.prepare("DELETE FROM top_up_intents"),
    env.DB.prepare("DELETE FROM merchants")
  ]);
});

describe("mainnet revenue hardening", () => {
  it("rotates and revokes the single merchant credential with explicit scopes", async () => {
    const created = await registerMerchant(env.DB, "Scoped Merchant");
    const rotated = await rotateMerchantApiKey(
      env.DB,
      created.merchant.merchantId,
      ["billing", "verify"],
    );
    await expect(authenticateMerchant(env.DB, created.apiKey)).resolves.toBeNull();
    await expect(authenticateMerchant(env.DB, rotated.apiKey)).resolves.toMatchObject({
      merchantId: created.merchant.merchantId,
    });
    const scopes = await env.DB
      .prepare("SELECT api_key_scopes FROM merchants WHERE merchant_id=?")
      .bind(created.merchant.merchantId)
      .first<{ api_key_scopes: string }>();
    expect(scopes?.api_key_scopes).toBe("billing,verify");

    await revokeMerchantApiKey(env.DB, created.merchant.merchantId);
    await expect(authenticateMerchant(env.DB, rotated.apiKey)).resolves.toBeNull();
  });

  it("reserves the fee at verify and reuses the same hold at settle", async () => {
    const funded = await fundedMerchant(20_000);
    const recovery = recoveryFor(funded.merchantId, "verify-held-payment");
    const hardeningEnv = { DB: env.DB, XGUARD_FEE_MICRO_USD: "2000" };

    await expect(
      preparePrepaidFee(hardeningEnv, recovery, "/verify"),
    ).resolves.toBeNull();
    const afterVerify = await merchantBalance(env.DB, funded.merchantId);
    expect(afterVerify.availableMicroUsd).toBe(funded.balance.availableMicroUsd - 2_000);
    expect(afterVerify.heldMicroUsd).toBe(2_000);

    await expect(
      preparePrepaidFee(hardeningEnv, recovery, "/verify"),
    ).resolves.toBeNull();
    const afterDuplicateVerify = await merchantBalance(env.DB, funded.merchantId);
    expect(afterDuplicateVerify).toMatchObject(afterVerify);

    await expect(
      preparePrepaidFee(hardeningEnv, recovery, "/settle"),
    ).resolves.toBeNull();
    const afterSettle = await merchantBalance(env.DB, funded.merchantId);
    expect(afterSettle).toMatchObject(afterVerify);
    const hold = await env.DB
      .prepare("SELECT state FROM verify_fee_holds WHERE logical_payment_key=?")
      .bind(recovery.logicalPaymentKey)
      .first<{ state: string }>();
    expect(hold?.state).toBe("SETTLE_CLAIMED");
  });

  it("releases an abandoned verify hold after expiry", async () => {
    const funded = await fundedMerchant(20_000);
    const recovery = recoveryFor(funded.merchantId, "verify-expired-payment");
    await preparePrepaidFee(
      { DB: env.DB, XGUARD_FEE_MICRO_USD: "2000" },
      recovery,
      "/verify",
    );
    await env.DB
      .prepare("UPDATE verify_fee_holds SET expires_at_epoch=? WHERE logical_payment_key=?")
      .bind(NOW - 1, recovery.logicalPaymentKey)
      .run();

    await expect(releaseExpiredVerifyHolds({ DB: env.DB }, NOW)).resolves.toBe(1);
    const balance = await merchantBalance(env.DB, funded.merchantId);
    expect(balance.availableMicroUsd).toBe(funded.balance.availableMicroUsd);
    expect(balance.heldMicroUsd).toBe(0);
  });

  it("credits a matching finalized automatic top-up exactly once", async () => {
    const created = await registerMerchant(env.DB, "Automatic Topup Merchant");
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
      logIndex: 2,
    };
    await expect(creditAutomaticTopUpDeposit(env.DB, deposit)).resolves.toBe(true);
    await expect(creditAutomaticTopUpDeposit(env.DB, deposit)).resolves.toBe(false);
    const balance = await merchantBalance(env.DB, created.merchant.merchantId);
    expect(balance.availableMicroUsd).toBe(intent.amountMicroUsd);
    const topUps = await env.DB.prepare("SELECT COUNT(*) AS count FROM top_ups").first<{ count: number }>();
    expect(topUps?.count).toBe(1);
  });

  it("opens the dynamic economics circuit before margin becomes unsafe", async () => {
    const base = await currentUnitEconomics({
      DB: env.DB,
      XGUARD_FEE_MICRO_USD: "2000",
      PAYAI_DOWNSTREAM_COST_MICRO_USD: "0",
      XGUARD_MIN_GROSS_MARGIN_BPS: "2500",
    });
    expect(base.circuitOpen).toBe(false);
    expect(base.grossMarginBps).toBe(10_000);

    await env.DB
      .prepare(
        "INSERT INTO runtime_economics(singleton_id,downstream_cost_micro_usd,min_gross_margin_bps,updated_at) VALUES(1,1600,2500,?)",
      )
      .bind(new Date().toISOString())
      .run();
    const unsafe = await currentUnitEconomics({
      DB: env.DB,
      XGUARD_FEE_MICRO_USD: "2000",
      PAYAI_DOWNSTREAM_COST_MICRO_USD: "0",
      XGUARD_MIN_GROSS_MARGIN_BPS: "2500",
    });
    expect(unsafe.grossMarginBps).toBe(2_000);
    expect(unsafe.circuitOpen).toBe(true);
    expect(unsafe.source).toBe("runtime");
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

function recoveryFor(merchantId: string, logicalPaymentKey: string) {
  return {
    logicalPaymentKey,
    merchantId,
    expectedPayer: SENDER,
    expectedPayTo: PAY_TO,
    expectedAmountMicroUsd: 1_000_000,
    authorizationNonce: `0x${"b".repeat(64)}`,
    validBeforeEpoch: NOW + 600,
  };
}
