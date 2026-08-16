import {
  authenticateMerchant,
  merchantBalance,
  releaseSettlementFee,
  reserveSettlementFee,
  type FeeReservation,
} from "./mainnet-billing.js";
import { BASE_MAINNET, BASE_USDC } from "./mainnet-protocol.js";
import type { AmbiguousRecoveryInput } from "./mainnet-recovery.js";

const ALLOWED_SCOPES = new Set(["billing", "verify", "settle"] as const);
const VERIFY_HOLD_MAX_SECONDS = 10 * 60;
const SETTLE_MARKER_SECONDS = 2 * 24 * 60 * 60;
const TOPUP_SCAN_BACK_BLOCKS = 4_000;
const TOPUP_LOG_BLOCK_CHUNK = 500;
const TOPUP_MAX_CHUNKS_PER_RUN = 4;
const BLOCK_CLOCK_SKEW_SECONDS = 30;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type MerchantScope = "billing" | "verify" | "settle";

type HardeningEnv = {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  XGUARD_FEE_MICRO_USD: string;
  XPAY_DOWNSTREAM_COST_MICRO_USD?: string;
  PAYAI_DOWNSTREAM_COST_MICRO_USD?: string;
  XGUARD_MIN_GROSS_MARGIN_BPS?: string;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
};

export interface ScopedMerchant {
  merchantId: string;
  name: string;
  scopes: MerchantScope[];
}

export type ScopeAuthorization =
  { ok: true; merchant: ScopedMerchant } | { ok: false; response: Response };

export interface UnitEconomicsState {
  feeMicroUsd: number;
  downstreamCostMicroUsd: number;
  minGrossMarginBps: number;
  grossMarginBps: number;
  circuitOpen: boolean;
  source: "configured" | "runtime" | "observed";
}

interface RuntimeEconomicsRow {
  downstream_cost_micro_usd: number;
  min_gross_margin_bps: number;
}

interface ReservationRow {
  state: string;
  operation_id: string | null;
  amount_micro_usd: number;
}

interface TopUpIntentMatch {
  intent_id: string;
  merchant_id: string;
  expected_amount_micro_usd: number;
}

interface RpcEnvelope<T> {
  result?: T | null;
  error?: unknown;
}

interface RpcBlock {
  number?: unknown;
  timestamp?: unknown;
}

interface RpcLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  blockNumber?: unknown;
  transactionHash?: unknown;
  logIndex?: unknown;
  removed?: unknown;
}

export interface AutomaticTopUpDeposit {
  transactionHash: string;
  sender: string;
  recipient: string;
  amountMicroUsd: number;
  blockNumber: number;
  blockTimestampSeconds: number;
  logIndex: number;
}

export async function authorizeMerchantScope(
  request: Request,
  env: Pick<HardeningEnv, "DB">,
  requiredScope: MerchantScope,
): Promise<ScopeAuthorization> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return {
      ok: false,
      response: jsonResponse(
        {
          error: "unauthorized",
          message: "Bearer merchant API key is required",
        },
        401,
      ),
    };

  const merchant = await authenticateMerchant(
    env.DB,
    authorization.slice("Bearer ".length),
  ).catch(() => null);
  if (merchant === null)
    return {
      ok: false,
      response: jsonResponse(
        { error: "unauthorized", message: "Merchant API key is invalid" },
        401,
      ),
    };

  const row = await env.DB.prepare(
    "SELECT api_key_scopes FROM merchants WHERE merchant_id=? AND active=1",
  )
    .bind(merchant.merchantId)
    .first<{ api_key_scopes: string }>()
    .catch(() => null);
  if (row === null)
    return {
      ok: false,
      response: jsonResponse({ error: "credential_scope_unavailable" }, 503),
    };

  const scopes = parseStoredScopes(row.api_key_scopes);
  if (!scopes.includes(requiredScope))
    return {
      ok: false,
      response: jsonResponse(
        { error: "insufficient_api_key_scope", requiredScope },
        403,
      ),
    };

  return {
    ok: true,
    merchant: { merchantId: merchant.merchantId, name: merchant.name, scopes },
  };
}

export async function handleHardeningEndpoint(
  request: Request,
  env: HardeningEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/v1/api-key" && request.method === "GET") {
    const access = await authorizeMerchantScope(request, env, "billing");
    if (!access.ok) return access.response;
    return jsonResponse({
      merchantId: access.merchant.merchantId,
      name: access.merchant.name,
      scopes: access.merchant.scopes,
      singleActiveCredential: true,
    });
  }

  if (url.pathname === "/v1/api-key/rotate" && request.method === "POST") {
    const access = await authorizeMerchantScope(request, env, "billing");
    if (!access.ok) return access.response;
    let requestedScopes = access.merchant.scopes;
    try {
      const body = await optionalJsonBody(request);
      if (body !== null && body.scopes !== undefined)
        requestedScopes = parseRequestedScopes(body.scopes);
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
    if (!requestedScopes.includes("billing"))
      return jsonResponse(
        {
          error: "billing_scope_required",
          message:
            "The single active merchant credential must retain billing scope so it can be rotated again",
        },
        400,
      );
    const rotated = await rotateMerchantApiKey(
      env.DB,
      access.merchant.merchantId,
      requestedScopes,
    );
    return jsonResponse(
      {
        apiKey: rotated.apiKey,
        scopes: rotated.scopes,
        warning: "Store this API key now. The previous key is already invalid.",
      },
      201,
    );
  }

  if (url.pathname === "/v1/api-key/revoke" && request.method === "POST") {
    const access = await authorizeMerchantScope(request, env, "billing");
    if (!access.ok) return access.response;
    await revokeMerchantApiKey(env.DB, access.merchant.merchantId);
    return jsonResponse({ revoked: true });
  }

  if (url.pathname === "/v1/admin/financials") {
    const admin = await authorizeAdmin(request, env);
    if (admin !== null) return admin;
    if (request.method !== "GET")
      return jsonResponse({ error: "method_not_allowed" }, 405, {
        Allow: "GET",
      });
    return adminFinancials(env);
  }

  if (url.pathname === "/v1/admin/economics") {
    const admin = await authorizeAdmin(request, env);
    if (admin !== null) return admin;
    if (request.method === "GET")
      return jsonResponse(await currentUnitEconomics(env));
    if (request.method !== "POST")
      return jsonResponse({ error: "method_not_allowed" }, 405, {
        Allow: "GET, POST",
      });
    let body: Record<string, unknown>;
    try {
      body = (await optionalJsonBody(request)) ?? {};
    } catch (error) {
      return jsonResponse({ error: errorCode(error) }, 400);
    }
    const downstreamCostMicroUsd = integerField(
      body.downstreamCostMicroUsd,
      0,
      1_000_000,
      "downstreamCostMicroUsd",
    );
    const minGrossMarginBps = integerField(
      body.minGrossMarginBps,
      0,
      10_000,
      "minGrossMarginBps",
    );
    await env.DB.prepare(
      `INSERT INTO runtime_economics(singleton_id,downstream_cost_micro_usd,min_gross_margin_bps,updated_at)
         VALUES(1,?,?,?)
         ON CONFLICT(singleton_id) DO UPDATE SET
           downstream_cost_micro_usd=excluded.downstream_cost_micro_usd,
           min_gross_margin_bps=excluded.min_gross_margin_bps,
           updated_at=excluded.updated_at`,
    )
      .bind(downstreamCostMicroUsd, minGrossMarginBps, new Date().toISOString())
      .run();
    return jsonResponse(await currentUnitEconomics(env));
  }

  return null;
}

export async function guardUnitEconomics(
  env: HardeningEnv,
): Promise<Response | null> {
  let state: UnitEconomicsState;
  try {
    state = await currentUnitEconomics(env);
  } catch {
    return jsonResponse({ error: "unit_economics_unavailable" }, 503);
  }
  if (!state.circuitOpen) return null;
  return jsonResponse(
    {
      error: "unit_economics_circuit_open",
      message:
        "XGuard paused paid downstream execution because the protected gross-margin floor is not currently satisfied",
    },
    503,
    { "Retry-After": "60" },
  );
}

export async function currentUnitEconomics(
  env: Pick<
    HardeningEnv,
    | "DB"
    | "XGUARD_FEE_MICRO_USD"
    | "PAYAI_DOWNSTREAM_COST_MICRO_USD"
    | "XPAY_DOWNSTREAM_COST_MICRO_USD"
    | "XGUARD_MIN_GROSS_MARGIN_BPS"
  >,
): Promise<UnitEconomicsState> {
  const feeMicroUsd = integerString(
    env.XGUARD_FEE_MICRO_USD,
    1,
    1_000_000,
    "XGUARD_FEE_MICRO_USD",
  );
  const configuredCost = integerString(
    env.PAYAI_DOWNSTREAM_COST_MICRO_USD ??
      env.XPAY_DOWNSTREAM_COST_MICRO_USD ??
      "0",
    0,
    1_000_000,
    "PAYAI_DOWNSTREAM_COST_MICRO_USD",
  );
  const configuredMargin = integerString(
    env.XGUARD_MIN_GROSS_MARGIN_BPS ?? "2500",
    0,
    10_000,
    "XGUARD_MIN_GROSS_MARGIN_BPS",
  );

  const runtime = await env.DB.prepare(
    "SELECT downstream_cost_micro_usd,min_gross_margin_bps FROM runtime_economics WHERE singleton_id=1",
  ).first<RuntimeEconomicsRow>();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const observed = await env.DB.prepare(
    "SELECT COALESCE(MAX(downstream_cost_micro_usd),0) AS max_cost FROM settlement_projection WHERE testnet=0 AND recorded_at>=?",
  )
    .bind(cutoff)
    .first<{ max_cost: number }>();
  const observedCost = safeNonNegativeInteger(observed?.max_cost ?? 0);
  const runtimeCost = safeNonNegativeInteger(
    runtime?.downstream_cost_micro_usd ?? 0,
  );
  const downstreamCostMicroUsd = Math.max(
    configuredCost,
    runtimeCost,
    observedCost,
  );
  const minGrossMarginBps = runtime?.min_gross_margin_bps ?? configuredMargin;
  if (
    !Number.isInteger(minGrossMarginBps) ||
    minGrossMarginBps < 0 ||
    minGrossMarginBps > 10_000
  )
    throw new Error("invalid_runtime_margin");
  const grossMarginBps =
    downstreamCostMicroUsd >= feeMicroUsd
      ? 0
      : Math.floor(
          ((feeMicroUsd - downstreamCostMicroUsd) * 10_000) / feeMicroUsd,
        );
  const source: UnitEconomicsState["source"] =
    observedCost >= configuredCost &&
    observedCost >= runtimeCost &&
    observedCost > 0
      ? "observed"
      : runtimeCost >= configuredCost && runtimeCost > 0
        ? "runtime"
        : "configured";
  return {
    feeMicroUsd,
    downstreamCostMicroUsd,
    minGrossMarginBps,
    grossMarginBps,
    circuitOpen:
      downstreamCostMicroUsd >= feeMicroUsd ||
      grossMarginBps < minGrossMarginBps,
    source,
  };
}

export async function preparePrepaidFee(
  env: Pick<HardeningEnv, "DB" | "XGUARD_FEE_MICRO_USD">,
  recovery: AmbiguousRecoveryInput,
  operation: "/verify" | "/settle",
): Promise<Response | null> {
  const feeMicroUsd = integerString(
    env.XGUARD_FEE_MICRO_USD,
    1,
    1_000_000,
    "XGUARD_FEE_MICRO_USD",
  );
  if (operation === "/settle")
    await markSettleClaim(
      env.DB,
      recovery.logicalPaymentKey,
      recovery.merchantId,
    );

  let reservation: FeeReservation;
  try {
    reservation = await ensureFeeHeld(
      env.DB,
      recovery.merchantId,
      recovery.logicalPaymentKey,
      feeMicroUsd,
    );
  } catch (error) {
    if (errorCode(error) === "insufficient_service_balance") {
      const balance = await merchantBalance(env.DB, recovery.merchantId).catch(
        () => null,
      );
      return jsonResponse(
        {
          error: "xguard_service_balance_required",
          message: "Merchant must prepay XGuard before paid downstream service",
          requiredFeeMicroUsd: feeMicroUsd,
          availableMicroUsd: balance?.availableMicroUsd ?? 0,
          topUpEndpoint: "/v1/topups/intents",
        },
        402,
      );
    }
    return jsonResponse({ error: "fee_reservation_unavailable" }, 503);
  }

  if (reservation.amountMicroUsd < feeMicroUsd)
    return jsonResponse({ error: "fee_reservation_underfunded" }, 409);
  if (reservation.state === "CREATED")
    return jsonResponse({ error: "fee_reservation_not_held" }, 503);

  if (operation === "/verify" && reservation.state === "HELD") {
    const nowEpoch = Math.floor(Date.now() / 1_000);
    const expiresAtEpoch = Math.max(
      nowEpoch + 1,
      Math.min(recovery.validBeforeEpoch, nowEpoch + VERIFY_HOLD_MAX_SECONDS),
    );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO verify_fee_holds(logical_payment_key,merchant_id,state,expires_at_epoch,created_at,updated_at)
         VALUES(?,?,'VERIFY_HELD',?,?,?)
         ON CONFLICT(logical_payment_key) DO UPDATE SET
           expires_at_epoch=CASE WHEN verify_fee_holds.expires_at_epoch>excluded.expires_at_epoch THEN verify_fee_holds.expires_at_epoch ELSE excluded.expires_at_epoch END,
           updated_at=excluded.updated_at
         WHERE verify_fee_holds.state='VERIFY_HELD'`,
    )
      .bind(
        recovery.logicalPaymentKey,
        recovery.merchantId,
        expiresAtEpoch,
        now,
        now,
      )
      .run();
  }

  return null;
}

export async function releaseExpiredVerifyHolds(
  env: Pick<HardeningEnv, "DB">,
  nowEpoch = Math.floor(Date.now() / 1_000),
): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT logical_payment_key,merchant_id FROM verify_fee_holds WHERE state='VERIFY_HELD' AND expires_at_epoch<? ORDER BY expires_at_epoch LIMIT 100",
  )
    .bind(nowEpoch)
    .all<{ logical_payment_key: string; merchant_id: string }>();
  let released = 0;
  for (const row of rows.results) {
    const deletion = await env.DB.prepare(
      "DELETE FROM verify_fee_holds WHERE logical_payment_key=? AND merchant_id=? AND state='VERIFY_HELD' AND expires_at_epoch<?",
    )
      .bind(row.logical_payment_key, row.merchant_id, nowEpoch)
      .run();
    if ((deletion.meta.changes ?? 0) !== 1) continue;
    await releaseSettlementFee(
      env.DB,
      row.merchant_id,
      row.logical_payment_key,
    ).catch(() => undefined);
    released += 1;
  }
  const cutoff = new Date(
    Date.now() - SETTLE_MARKER_SECONDS * 1_000,
  ).toISOString();
  await env.DB.prepare(
    "DELETE FROM verify_fee_holds WHERE state='SETTLE_CLAIMED' AND updated_at<?",
  )
    .bind(cutoff)
    .run();
  return released;
}

export async function rotateMerchantApiKey(
  db: D1Database,
  merchantId: string,
  scopes: MerchantScope[],
): Promise<{ apiKey: string; scopes: MerchantScope[] }> {
  const normalized = normalizeScopes(scopes);
  if (!normalized.includes("billing"))
    throw new Error("billing_scope_required");
  const apiKey = `xg_live_${randomToken(32)}`;
  const apiKeyHash = await sha256Hex(apiKey);
  const result = await db
    .prepare(
      "UPDATE merchants SET api_key_hash=?,api_key_scopes=?,api_key_rotated_at=? WHERE merchant_id=? AND active=1",
    )
    .bind(
      apiKeyHash,
      normalized.join(","),
      new Date().toISOString(),
      merchantId,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("merchant_not_found");
  return { apiKey, scopes: normalized };
}

export async function revokeMerchantApiKey(
  db: D1Database,
  merchantId: string,
): Promise<void> {
  const revokedHash = await sha256Hex(
    `revoked:${crypto.randomUUID()}:${randomToken(32)}`,
  );
  const result = await db
    .prepare(
      "UPDATE merchants SET api_key_hash=?,api_key_scopes='',api_key_rotated_at=? WHERE merchant_id=? AND active=1",
    )
    .bind(revokedHash, new Date().toISOString(), merchantId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("merchant_not_found");
}

export async function scanAutomaticTopUps(env: HardeningEnv): Promise<{
  scannedThroughBlock: number;
  credited: number;
}> {
  assertEvmAddress(env.XGUARD_TREASURY_USDC_ADDRESS, "treasury");
  const rpcUrl = new URL(env.BASE_RPC_URL);
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password)
    throw new Error("invalid_base_rpc_url");
  const finalized = await rpc<RpcBlock>(
    rpcUrl.toString(),
    "eth_getBlockByNumber",
    ["finalized", false],
  );
  if (finalized === null) throw new Error("finalized_block_unavailable");
  const finalizedNumber = parseRpcInteger(finalized.number, "finalized_block");
  const cursor = await env.DB.prepare(
    "SELECT last_scanned_block FROM treasury_scan_state WHERE scanner_id='base-usdc'",
  ).first<{ last_scanned_block: number }>();
  let fromBlock =
    cursor === null
      ? Math.max(0, finalizedNumber - TOPUP_SCAN_BACK_BLOCKS)
      : cursor.last_scanned_block + 1;
  let scannedThroughBlock =
    cursor?.last_scanned_block ?? Math.max(0, fromBlock - 1);
  let credited = 0;
  const blockTimestampCache = new Map<number, number>();

  for (
    let chunk = 0;
    chunk < TOPUP_MAX_CHUNKS_PER_RUN && fromBlock <= finalizedNumber;
    chunk += 1
  ) {
    const toBlock = Math.min(
      finalizedNumber,
      fromBlock + TOPUP_LOG_BLOCK_CHUNK - 1,
    );
    const logs =
      (await rpc<RpcLog[]>(rpcUrl.toString(), "eth_getLogs", [
        {
          fromBlock: rpcHex(fromBlock),
          toBlock: rpcHex(toBlock),
          address: BASE_USDC,
          topics: [
            TRANSFER_TOPIC,
            null,
            addressTopic(env.XGUARD_TREASURY_USDC_ADDRESS),
          ],
        },
      ])) ?? [];
    if (!Array.isArray(logs)) throw new Error("malformed_transfer_logs");

    for (const log of logs) {
      if (log.removed === true) continue;
      if (
        typeof log.transactionHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash) ||
        !Array.isArray(log.topics) ||
        log.topics.length < 3 ||
        typeof log.topics[1] !== "string"
      )
        throw new Error("malformed_transfer_log");
      const blockNumber = parseRpcInteger(log.blockNumber, "transfer_block");
      let blockTimestampSeconds = blockTimestampCache.get(blockNumber);
      if (blockTimestampSeconds === undefined) {
        const block = await rpc<RpcBlock>(
          rpcUrl.toString(),
          "eth_getBlockByNumber",
          [rpcHex(blockNumber), false],
        );
        if (block === null) throw new Error("transfer_block_unavailable");
        blockTimestampSeconds = parseRpcInteger(
          block.timestamp,
          "transfer_block_timestamp",
        );
        blockTimestampCache.set(blockNumber, blockTimestampSeconds);
      }
      const deposit: AutomaticTopUpDeposit = {
        transactionHash: log.transactionHash.toLowerCase(),
        sender: topicAddress(log.topics[1]),
        recipient: env.XGUARD_TREASURY_USDC_ADDRESS.toLowerCase(),
        amountMicroUsd: parseRpcInteger(log.data, "transfer_amount"),
        blockNumber,
        blockTimestampSeconds,
        logIndex: parseRpcInteger(log.logIndex, "transfer_log_index"),
      };
      if (deposit.amountMicroUsd <= 0) continue;
      if (await creditAutomaticTopUpDeposit(env.DB, deposit)) credited += 1;
    }

    scannedThroughBlock = toBlock;
    await env.DB.prepare(
      `INSERT INTO treasury_scan_state(scanner_id,last_scanned_block,updated_at)
         VALUES('base-usdc',?,?)
         ON CONFLICT(scanner_id) DO UPDATE SET
           last_scanned_block=excluded.last_scanned_block,
           updated_at=excluded.updated_at`,
    )
      .bind(toBlock, new Date().toISOString())
      .run();
    fromBlock = toBlock + 1;
  }

  return { scannedThroughBlock, credited };
}

export async function creditAutomaticTopUpDeposit(
  db: D1Database,
  deposit: AutomaticTopUpDeposit,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(deposit.transactionHash))
    throw new Error("invalid_transaction_hash");
  assertEvmAddress(deposit.sender, "sender");
  assertEvmAddress(deposit.recipient, "recipient");
  if (
    !Number.isSafeInteger(deposit.amountMicroUsd) ||
    deposit.amountMicroUsd <= 0
  )
    throw new Error("invalid_top_up_amount");

  const externalReference = `${BASE_MAINNET}:${deposit.transactionHash.toLowerCase()}:${deposit.logIndex}`;
  const existing = await db
    .prepare("SELECT top_up_id FROM top_ups WHERE external_reference=?")
    .bind(externalReference)
    .first<{ top_up_id: string }>();
  if (existing !== null) return false;

  const candidates = await db
    .prepare(
      `SELECT intent_id,merchant_id,expected_amount_micro_usd
       FROM top_up_intents
       WHERE expected_amount_micro_usd=?
         AND state IN ('OPEN','EXPIRED')
         AND created_at_epoch<=?
         AND expires_at_epoch>=?
       ORDER BY created_at_epoch DESC
       LIMIT 2`,
    )
    .bind(
      deposit.amountMicroUsd,
      deposit.blockTimestampSeconds + BLOCK_CLOCK_SKEW_SECONDS,
      deposit.blockTimestampSeconds - BLOCK_CLOCK_SKEW_SECONDS,
    )
    .all<TopUpIntentMatch>();
  if (candidates.results.length === 0) return false;
  if (candidates.results.length !== 1)
    throw new Error("ambiguous_top_up_intent_match");
  const intent = candidates.results[0]!;

  const operationId = crypto.randomUUID();
  const topUpId = crypto.randomUUID();
  const now = new Date().toISOString();
  const eventId = `topup:${topUpId}`;
  await db.batch([
    db
      .prepare(
        "UPDATE top_up_intents SET state='CLAIMED',claimed_at=?,claim_operation_id=? WHERE intent_id=? AND merchant_id=? AND state IN ('OPEN','EXPIRED') AND expected_amount_micro_usd=? AND created_at_epoch<=? AND expires_at_epoch>=?",
      )
      .bind(
        now,
        operationId,
        intent.intent_id,
        intent.merchant_id,
        deposit.amountMicroUsd,
        deposit.blockTimestampSeconds + BLOCK_CLOCK_SKEW_SECONDS,
        deposit.blockTimestampSeconds - BLOCK_CLOCK_SKEW_SECONDS,
      ),
    db
      .prepare(
        "INSERT INTO top_ups(top_up_id,intent_id,merchant_id,external_reference,network,asset,transaction_hash,transfer_log_index,payer,treasury_address,amount_micro_usd,finalized_block,created_at) SELECT ?,intent_id,merchant_id,?,?,?,?,?,?,?,?,?,? FROM top_up_intents WHERE intent_id=? AND merchant_id=? AND state='CLAIMED' AND claim_operation_id=?",
      )
      .bind(
        topUpId,
        externalReference,
        BASE_MAINNET,
        BASE_USDC.toLowerCase(),
        deposit.transactionHash.toLowerCase(),
        deposit.logIndex,
        deposit.sender.toLowerCase(),
        deposit.recipient.toLowerCase(),
        deposit.amountMicroUsd,
        deposit.blockNumber,
        now,
        intent.intent_id,
        intent.merchant_id,
        operationId,
      ),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd+? WHERE merchant_id=? AND active=1 AND EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=? AND merchant_id=?)",
      )
      .bind(
        deposit.amountMicroUsd,
        intent.merchant_id,
        topUpId,
        intent.merchant_id,
      ),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'CUSTOMER_BALANCES','DEBIT',?,? WHERE EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=?)",
      )
      .bind(`${eventId}:debit`, eventId, deposit.amountMicroUsd, now, topUpId),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'UNEARNED_LIABILITY','CREDIT',?,? WHERE EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=?)",
      )
      .bind(`${eventId}:credit`, eventId, deposit.amountMicroUsd, now, topUpId),
  ]);

  const credited = await db
    .prepare(
      "SELECT top_up_id FROM top_ups WHERE top_up_id=? AND merchant_id=?",
    )
    .bind(topUpId, intent.merchant_id)
    .first<{ top_up_id: string }>();
  return credited !== null;
}

async function ensureFeeHeld(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
  feeMicroUsd: number,
): Promise<FeeReservation> {
  let reservation = await reserveSettlementFee(
    db,
    merchantId,
    logicalPaymentKey,
    feeMicroUsd,
  );
  if (reservation.state !== "RELEASED") return reservation;
  if (reservation.amountMicroUsd < feeMicroUsd)
    throw new Error("fee_reservation_underfunded");

  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE fee_reservations
         SET state='HELD',updated_at=?,operation_id=?
         WHERE logical_payment_key=? AND merchant_id=? AND state='RELEASED'
           AND EXISTS(
             SELECT 1 FROM merchants
             WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=?
           )`,
      )
      .bind(
        now,
        operationId,
        logicalPaymentKey,
        merchantId,
        merchantId,
        reservation.amountMicroUsd,
      ),
    db
      .prepare(
        `UPDATE merchants
         SET available_balance_micro_usd=available_balance_micro_usd-?,
             held_balance_micro_usd=held_balance_micro_usd+?
         WHERE merchant_id=? AND active=1
           AND EXISTS(
             SELECT 1 FROM fee_reservations
             WHERE logical_payment_key=? AND merchant_id=?
               AND state='HELD' AND operation_id=?
           )`,
      )
      .bind(
        reservation.amountMicroUsd,
        reservation.amountMicroUsd,
        merchantId,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
  ]);
  const row = await db
    .prepare(
      "SELECT state,operation_id,amount_micro_usd FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=?",
    )
    .bind(logicalPaymentKey, merchantId)
    .first<ReservationRow>();
  if (row === null) throw new Error("fee_reservation_not_found");
  if (row.state === "RELEASED") throw new Error("insufficient_service_balance");
  reservation = {
    logicalPaymentKey,
    merchantId,
    amountMicroUsd: row.amount_micro_usd,
    state: row.state as FeeReservation["state"],
  };
  return reservation;
}

async function markSettleClaim(
  db: D1Database,
  logicalPaymentKey: string,
  merchantId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1_000) + SETTLE_MARKER_SECONDS;
  await db
    .prepare(
      `INSERT INTO verify_fee_holds(logical_payment_key,merchant_id,state,expires_at_epoch,created_at,updated_at)
       VALUES(?,?,'SETTLE_CLAIMED',?,?,?)
       ON CONFLICT(logical_payment_key) DO UPDATE SET
         state='SETTLE_CLAIMED',
         expires_at_epoch=excluded.expires_at_epoch,
         updated_at=excluded.updated_at`,
    )
    .bind(logicalPaymentKey, merchantId, expiresAtEpoch, now, now)
    .run();
}

async function adminFinancials(env: HardeningEnv): Promise<Response> {
  const [usage, balances, topUps, holds, economics] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count,COALESCE(SUM(fee_micro_usd),0) AS total FROM usage_events",
    ).first<{ count: number; total: number }>(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(available_balance_micro_usd),0) AS available,COALESCE(SUM(held_balance_micro_usd),0) AS held FROM merchants WHERE active=1",
    ).first<{ available: number; held: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count,COALESCE(SUM(amount_micro_usd),0) AS total FROM top_ups",
    ).first<{ count: number; total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM verify_fee_holds WHERE state='VERIFY_HELD'",
    ).first<{ count: number }>(),
    currentUnitEconomics(env),
  ]);
  return jsonResponse({
    successfulBillableSettlements: usage?.count ?? 0,
    earnedMicroUsd: usage?.total ?? 0,
    customerAvailableMicroUsd: balances?.available ?? 0,
    customerHeldMicroUsd: balances?.held ?? 0,
    creditedTopUps: topUps?.count ?? 0,
    creditedTopUpMicroUsd: topUps?.total ?? 0,
    pendingVerifyFeeHolds: holds?.count ?? 0,
    unitEconomics: economics,
    measuredAt: new Date().toISOString(),
  });
}

async function authorizeAdmin(
  request: Request,
  env: Pick<HardeningEnv, "XGUARD_ADMIN_TOKEN_SHA256">,
): Promise<Response | null> {
  const expected = env.XGUARD_ADMIN_TOKEN_SHA256;
  if (expected === undefined || !/^[0-9a-f]{64}$/.test(expected))
    return jsonResponse({ error: "not_found" }, 404);
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return jsonResponse({ error: "unauthorized" }, 401);
  const actual = await sha256Hex(authorization.slice("Bearer ".length));
  if (!constantTimeHexEqual(actual, expected))
    return jsonResponse({ error: "unauthorized" }, 401);
  return null;
}

async function optionalJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-length") === "0") return null;
  const contentType = request.headers.get("content-type");
  if (contentType === null) return null;
  if (contentType.split(";", 1)[0]?.toLowerCase() !== "application/json")
    throw new Error("application_json_required");
  const text = await request.text();
  if (text.length === 0) return null;
  if (text.length > 8 * 1024) throw new Error("request_body_too_large");
  const value = JSON.parse(text) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("json_object_required");
  return value as Record<string, unknown>;
}

function parseRequestedScopes(value: unknown): MerchantScope[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("invalid_api_key_scopes");
  const scopes: MerchantScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ALLOWED_SCOPES.has(item as MerchantScope))
      throw new Error("invalid_api_key_scopes");
    if (!scopes.includes(item as MerchantScope))
      scopes.push(item as MerchantScope);
  }
  return normalizeScopes(scopes);
}

function parseStoredScopes(value: string): MerchantScope[] {
  return normalizeScopes(
    value
      .split(",")
      .filter((scope): scope is MerchantScope =>
        ALLOWED_SCOPES.has(scope as MerchantScope),
      ),
  );
}

function normalizeScopes(scopes: MerchantScope[]): MerchantScope[] {
  return [...new Set(scopes)].sort() as MerchantScope[];
}

function integerField(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    throw new Error(`invalid_${field}`);
  return value as number;
}

function integerString(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${field}_invalid`);
  return parsed;
}

function safeNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid_observed_cost");
  return value;
}

function randomToken(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function assertEvmAddress(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`invalid_${field}`);
}

function addressTopic(address: string): string {
  assertEvmAddress(address, "address");
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function topicAddress(topic: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic))
    throw new Error("malformed_transfer_topic");
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function rpcHex(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid_rpc_integer");
  return `0x${value.toString(16)}`;
}

function parseRpcInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value))
    throw new Error(`invalid_${field}`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${field}_too_large`);
  return Number(parsed);
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`rpc_http_${response.status}`);
    const text = await response.text();
    if (text.length > 512 * 1024) throw new Error("rpc_response_too_large");
    const parsed = JSON.parse(text) as RpcEnvelope<T>;
    if (parsed.error !== undefined) throw new Error("rpc_error");
    if (!("result" in parsed)) throw new Error("malformed_rpc_response");
    return parsed.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}
