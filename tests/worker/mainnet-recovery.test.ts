import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimTopUp,
  createTopUpIntent,
  markSettlementFeeAmbiguous,
  merchantBalance,
  registerMerchant,
  reserveSettlementFee,
} from "../../apps/worker/src/mainnet-billing.js";
import {
  recordAmbiguousRecovery,
  recoverAmbiguousSettlements,
  recoveredSettlement,
  recoveryStats,
} from "../../apps/worker/src/mainnet-recovery.js";
import { BASE_USDC } from "../../apps/worker/src/mainnet-protocol.js";

const PAYER = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const TREASURY = "0x3333333333333333333333333333333333333333";
const NONCE = `0x${"44".repeat(32)}`;
const TRANSACTION = `0x${"55".repeat(32)}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AUTHORIZATION_USED_TOPIC =
  "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const AMOUNT = 1_000;

beforeEach(async () => {
  vi.unstubAllGlobals();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settlement_recovery_jobs"),
    env.DB.prepare("DELETE FROM settlement_finality_jobs"),
    env.DB.prepare("DELETE FROM reconciliation_cases"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM usage_events"),
    env.DB.prepare("DELETE FROM settlement_projection"),
    env.DB.prepare("DELETE FROM fee_reservations"),
    env.DB.prepare("DELETE FROM top_ups"),
    env.DB.prepare("DELETE FROM top_up_intents"),
    env.DB.prepare("DELETE FROM merchants"),
  ]);
});

describe("ambiguous mainnet settlement recovery", () => {
  it("confirms an exact finalized EIP-3009 settlement without resubmitting it", async () => {
    const merchant = await ambiguousMerchant("a".repeat(64));
    await env.DB.prepare(
      "UPDATE settlement_recovery_jobs SET from_block=4090 WHERE logical_payment_key=?",
    )
      .bind(merchant.logicalPaymentKey)
      .run();

    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: unknown[];
      };
      if (request.method === "eth_getLogs") {
        const filter = (request.params?.[0] ?? {}) as { topics?: string[] };
        if (filter.topics?.[0] === AUTHORIZATION_USED_TOPIC) {
          return rpcResponse([
            {
              transactionHash: TRANSACTION,
              blockNumber: "0x1000",
              logIndex: "0x1",
              removed: false,
            },
          ]);
        }
        return rpcResponse([]);
      }
      if (request.method === "eth_getTransactionReceipt") {
        return rpcResponse({
          status: "0x1",
          blockNumber: "0x1000",
          logs: [
            {
              address: BASE_USDC,
              topics: [TRANSFER_TOPIC, addressTopic(PAYER), addressTopic(PAY_TO)],
              data: `0x${AMOUNT.toString(16)}`,
              logIndex: "0x2",
              removed: false,
            },
          ],
        });
      }
      if (request.method === "eth_getBlockByNumber")
        return rpcResponse({ number: "0x1000", timestamp: "0x3e8" });
      throw new Error(`unexpected RPC method ${request.method ?? "missing"}`);
    }));

    await recoverAmbiguousSettlements(recoveryEnv());

    const recovered = await recoveredSettlement(env.DB, merchant.logicalPaymentKey);
    expect(recovered?.state).toBe("CONFIRMED");
    expect(recovered?.result).toMatchObject({
      success: true,
      transaction: TRANSACTION,
      network: "eip155:8453",
      payer: PAYER,
      amount: String(AMOUNT),
    });
    expect(await merchantBalance(env.DB, merchant.merchantId)).toMatchObject({
      heldMicroUsd: 0,
    });
    const usage = await env.DB.prepare(
      "SELECT COUNT(*) AS count,SUM(fee_micro_usd) AS total FROM usage_events WHERE logical_payment_key=?",
    )
      .bind(merchant.logicalPaymentKey)
      .first<{ count: number; total: number }>();
    expect(usage).toEqual({ count: 1, total: 2_000 });
    expect(await recoveryStats(env.DB)).toEqual({ pending: 0, failed: 0 });
  });

  it("releases the held fee after a finalized unused authorization expires", async () => {
    const merchant = await ambiguousMerchant("b".repeat(64), 100);
    await env.DB.prepare(
      "UPDATE settlement_recovery_jobs SET from_block=4090 WHERE logical_payment_key=?",
    )
      .bind(merchant.logicalPaymentKey)
      .run();

    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (request.method === "eth_getLogs") return rpcResponse([]);
      if (request.method === "eth_getBlockByNumber")
        return rpcResponse({ number: "0x1000", timestamp: "0xc8" });
      throw new Error(`unexpected RPC method ${request.method ?? "missing"}`);
    }));

    await recoverAmbiguousSettlements(recoveryEnv());

    const recovered = await recoveredSettlement(env.DB, merchant.logicalPaymentKey);
    expect(recovered?.state).toBe("EXPIRED");
    expect(recovered?.result).toMatchObject({
      success: false,
      errorReason: "xguard_authorization_expired_unused",
    });
    expect(await merchantBalance(env.DB, merchant.merchantId)).toMatchObject({
      availableMicroUsd: merchant.balanceBeforeHold,
      heldMicroUsd: 0,
    });
  });
});

async function ambiguousMerchant(logicalPaymentKey: string, validBeforeEpoch = 2_000) {
  const created = await registerMerchant(env.DB, `Recovery ${crypto.randomUUID()}`);
  const intent = await createTopUpIntent(
    env.DB,
    created.merchant.merchantId,
    20_000,
    1_000,
  );
  const funded = await claimTopUp(
    env.DB,
    {
      merchantId: created.merchant.merchantId,
      claimToken: intent.claimToken,
      deposit: {
        transactionHash: `0x${"66".repeat(32)}`,
        sender: PAYER,
        recipient: TREASURY,
        amountMicroUsd: intent.amountMicroUsd,
        blockNumber: 900,
        blockTimestampSeconds: 1_010,
        logIndex: 0,
      },
      network: "eip155:8453",
      asset: BASE_USDC,
    },
    1_020,
  );
  await reserveSettlementFee(
    env.DB,
    created.merchant.merchantId,
    logicalPaymentKey,
    2_000,
  );
  await markSettlementFeeAmbiguous(
    env.DB,
    created.merchant.merchantId,
    logicalPaymentKey,
  );
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settlement_projection(
        logical_payment_key,request_fingerprint,payment_identifier,network,
        facilitator_id,state,transaction_hash,testnet,fee_micro_usd,
        downstream_cost_micro_usd,recorded_at
      ) VALUES(?,?,NULL,'eip155:8453','xpay-mainnet','AMBIGUOUS',NULL,0,0,0,?)`,
    ).bind(logicalPaymentKey, `fingerprint-${logicalPaymentKey}`, now),
    env.DB.prepare(
      `INSERT INTO reconciliation_cases(
        case_id,logical_payment_key,reason_code,details_json,state,created_at
      ) VALUES(?,?,?,'{}','OPEN',?)`,
    ).bind(
      `mainnet:${logicalPaymentKey}`,
      logicalPaymentKey,
      "settlement_timeout",
      now,
    ),
  ]);
  await recordAmbiguousRecovery(env.DB, {
    logicalPaymentKey,
    merchantId: created.merchant.merchantId,
    expectedPayer: PAYER,
    expectedPayTo: PAY_TO,
    expectedAmountMicroUsd: AMOUNT,
    authorizationNonce: NONCE,
    validBeforeEpoch,
  });
  return {
    merchantId: created.merchant.merchantId,
    logicalPaymentKey,
    balanceBeforeHold: funded.availableMicroUsd,
  };
}

function recoveryEnv() {
  return {
    DB: env.DB,
    BASE_RPC_URL: "https://mainnet.base.org",
    XGUARD_FEE_MICRO_USD: "2000",
    XPAY_DOWNSTREAM_COST_MICRO_USD: "0",
  };
}

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}
