import fs from "node:fs";

const path = "apps/worker/src/mainnet.ts";
let source = fs.readFileSync(path, "utf8");

const oldPostSubmit = `    const now = new Date().toISOString();
    await context.env.DB.prepare(
      \`INSERT INTO settlement_finality_jobs(logical_payment_key,merchant_id,transaction_hash,network,asset,expected_payer,expected_pay_to,expected_amount_micro_usd,settle_result_json,state,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?)
       ON CONFLICT(logical_payment_key) DO NOTHING\`,
    )
      .bind(
        identities.logicalPaymentKey,
        merchant.merchantId,
        result.transaction.toLowerCase(),
        BASE_MAINNET,
        BASE_USDC.toLowerCase(),
        body.payer.toLowerCase(),
        body.payTo.toLowerCase(),
        body.amountMicroUsd,
        JSON.stringify(result),
        now,
        now,
      )
      .run();
    await stub.finalize(result);
    await stub.flushOutbox();
    return context.json(result, 200, {
      "X-XGuard-Replayed": "false",
      "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      "X-XGuard-Fee-State": "HELD_PENDING_FINALITY",
    });`;

const newPostSubmit = `    const now = new Date().toISOString();
    try {
      await context.env.DB.prepare(
        \`INSERT INTO settlement_finality_jobs(logical_payment_key,merchant_id,transaction_hash,network,asset,expected_payer,expected_pay_to,expected_amount_micro_usd,settle_result_json,state,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?)
         ON CONFLICT(logical_payment_key) DO NOTHING\`,
      )
        .bind(
          identities.logicalPaymentKey,
          merchant.merchantId,
          result.transaction.toLowerCase(),
          BASE_MAINNET,
          BASE_USDC.toLowerCase(),
          body.payer.toLowerCase(),
          body.payTo.toLowerCase(),
          body.amountMicroUsd,
          JSON.stringify(result),
          now,
          now,
        )
        .run();
    } catch (error) {
      await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement was submitted but finality tracking could not be persisted; automatic retry is disabled",
        ),
        503,
      );
    }
    try {
      await stub.finalize(result);
    } catch (error) {
      await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement was submitted but durable completion could not be recorded; automatic retry is disabled",
        ),
        503,
      );
    }
    context.executionCtx.waitUntil(stub.flushOutbox());
    return context.json(result, 200, {
      "X-XGuard-Replayed": "false",
      "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      "X-XGuard-Fee-State": "HELD_PENDING_FINALITY",
    });`;

if (!source.includes(oldPostSubmit)) {
  throw new Error("post-submit block not found");
}
source = source.replace(oldPostSubmit, newPostSubmit);

const oldFinalityCatch = `      if (
        code === "transaction_not_found" ||
        code === "transaction_not_finalized" ||
        code.startsWith("rpc_") ||
        code.includes("unavailable") ||
        code === "AbortError"
      ) {
        await env.DB.prepare(
          "UPDATE settlement_finality_jobs SET attempts=attempts+1,last_error_code=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
        )
          .bind(code, now, job.logical_payment_key)
          .run();
        continue;
      }
      await releaseSettlementFee(`;

const newFinalityCatch = `      const permanentFinalityFailure =
        code === "transaction_failed_finalized" ||
        code === "expected_usdc_transfer_not_found" ||
        code === "ambiguous_expected_usdc_transfer";
      if (!permanentFinalityFailure) {
        await env.DB.prepare(
          "UPDATE settlement_finality_jobs SET attempts=attempts+1,last_error_code=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
        )
          .bind(code, now, job.logical_payment_key)
          .run();
        continue;
      }
      await releaseSettlementFee(`;

if (!source.includes(oldFinalityCatch)) {
  throw new Error("finality catch block not found");
}
source = source.replace(oldFinalityCatch, newFinalityCatch);

fs.writeFileSync(path, source);
