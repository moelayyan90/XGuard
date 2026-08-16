import { DurableObject } from "cloudflare:workers";
import {
  XGuardError,
  assertEconomicIntentTransition,
  bindEconomicAuthorization,
  bindEconomicFulfillment,
  bindEconomicSettlement,
  buildXGuardProof,
  economicIntentIsExpired,
  type EconomicAuthorizationBinding,
  type EconomicFulfillmentBinding,
  type EconomicIntentBinding,
  type EconomicIntentState,
  type EconomicSettlementBinding,
  type XGuardProof,
} from "@xguard/core/edge";

export interface EconomicIntentCoordinatorEnv {}

interface IntentRow extends Record<string, SqlStorageValue> {
  intent_id: string;
  merchant_id: string;
  terms_hash: string;
  terms_json: string;
  state: EconomicIntentState;
  authorization_json: string | null;
  execution_id: string | null;
  fulfillment_json: string | null;
  settlement_json: string | null;
  proof_json: string | null;
  quarantine_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EconomicIntentSnapshot {
  intentId: string;
  merchantId: string;
  termsHash: string;
  terms: EconomicIntentBinding["terms"];
  state: EconomicIntentState;
  authorizationHash: string | null;
  authorizedAmountMicroUsd: number | null;
  executionId: string | null;
  fulfillmentHash: string | null;
  settlementHash: string | null;
  proof: XGuardProof | null;
  quarantineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EconomicIntentCreateResult =
  | { kind: "CREATED"; snapshot: EconomicIntentSnapshot }
  | { kind: "EXISTS"; snapshot: EconomicIntentSnapshot }
  | { kind: "CONFLICT" };

export interface EconomicIntentAuthorizationInput {
  merchantId: string;
  authorization: unknown;
  authorizedAmountMicroUsd: number;
}

export interface EconomicIntentExecutionInput {
  merchantId: string;
  authorizationHash: string;
  executionId: string;
}

export interface EconomicIntentFulfillmentInput {
  merchantId: string;
  executionId: string;
  fulfillment: unknown;
}

export interface EconomicIntentSettlementInput {
  merchantId: string;
  executionId: string;
  protocol: string;
  settlement: unknown;
  chargedAmountMicroUsd: number;
}

export class EconomicIntentCoordinator extends DurableObject<EconomicIntentCoordinatorEnv> {
  private readonly sql: SqlStorage;

  public constructor(
    ctx: DurableObjectState,
    env: EconomicIntentCoordinatorEnv,
  ) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS economic_intent (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        intent_id TEXT NOT NULL UNIQUE,
        merchant_id TEXT NOT NULL,
        terms_hash TEXT NOT NULL,
        terms_json TEXT NOT NULL,
        state TEXT NOT NULL,
        authorization_json TEXT,
        execution_id TEXT,
        fulfillment_json TEXT,
        settlement_json TEXT,
        proof_json TEXT,
        quarantine_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
    });
  }

  public create(
    merchantId: string,
    binding: EconomicIntentBinding,
  ): EconomicIntentCreateResult {
    if (binding.terms.merchantId !== merchantId)
      throw conflict("Intent merchant does not match authenticated merchant");
    const existing = this.row();
    if (existing !== null) {
      if (
        existing.intent_id !== binding.intentId ||
        existing.terms_hash !== binding.termsHash ||
        existing.merchant_id !== merchantId
      )
        return { kind: "CONFLICT" };
      return { kind: "EXISTS", snapshot: this.snapshot(existing) };
    }
    if (economicIntentIsExpired(binding))
      throw new XGuardError("BAD_REQUEST", "Economic intent is expired", 409);

    assertEconomicIntentTransition("CREATED", "BOUND");
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO economic_intent(
        singleton,intent_id,merchant_id,terms_hash,terms_json,state,created_at,updated_at
      ) VALUES(1,?,?,?,?,'BOUND',?,?)`,
      binding.intentId,
      merchantId,
      binding.termsHash,
      JSON.stringify(binding.terms),
      now,
      now,
    );
    return { kind: "CREATED", snapshot: this.snapshot(this.requireRow()) };
  }

  public getSnapshot(merchantId: string): EconomicIntentSnapshot | null {
    const row = this.row();
    if (row === null) return null;
    this.assertMerchant(row, merchantId);
    this.expireIfEligible(row);
    return this.snapshot(this.requireRow());
  }

  public recordAuthorization(
    input: EconomicIntentAuthorizationInput,
  ): EconomicIntentSnapshot {
    let row = this.requireRow();
    this.assertMerchant(row, input.merchantId);
    this.expireIfEligible(row);
    row = this.requireRow();
    if (row.state === "EXPIRED")
      throw conflict("Economic intent expired before authorization");

    const intent = this.binding(row);
    const authorization = bindEconomicAuthorization({
      intent,
      authorization: input.authorization,
      authorizedAmountMicroUsd: input.authorizedAmountMicroUsd,
    });
    if (row.authorization_json !== null) {
      const existing = JSON.parse(
        row.authorization_json,
      ) as EconomicAuthorizationBinding;
      if (
        existing.authorizationHash !== authorization.authorizationHash ||
        existing.authorizedAmountMicroUsd !==
          authorization.authorizedAmountMicroUsd
      )
        throw conflict("Intent is already bound to another authorization");
      return this.snapshot(row);
    }
    if (row.state !== "BOUND")
      throw conflict(`Cannot authorize intent from state ${row.state}`);

    assertEconomicIntentTransition("BOUND", "AUTHORIZED");
    this.sql.exec(
      "UPDATE economic_intent SET state='AUTHORIZED',authorization_json=?,updated_at=? WHERE singleton=1 AND state='BOUND'",
      JSON.stringify(authorization),
      new Date().toISOString(),
    );
    return this.snapshot(this.requireRow());
  }

  public beginExecution(
    input: EconomicIntentExecutionInput,
  ): EconomicIntentSnapshot {
    let row = this.requireRow();
    this.assertMerchant(row, input.merchantId);
    this.expireIfEligible(row);
    row = this.requireRow();
    if (row.state === "EXPIRED")
      throw conflict("Economic intent expired before execution");
    if (row.authorization_json === null)
      throw conflict("Economic intent is not authorized");
    const authorization = JSON.parse(
      row.authorization_json,
    ) as EconomicAuthorizationBinding;
    if (authorization.authorizationHash !== input.authorizationHash)
      throw conflict("Execution authorization hash does not match intent");
    if (input.executionId.trim().length === 0)
      throw new XGuardError("BAD_REQUEST", "executionId is required", 400);

    if (row.execution_id !== null) {
      if (row.execution_id !== input.executionId)
        throw conflict("Economic intent is already owned by another execution");
      return this.snapshot(row);
    }
    if (row.state !== "AUTHORIZED")
      throw conflict(`Cannot execute intent from state ${row.state}`);

    assertEconomicIntentTransition("AUTHORIZED", "LOCKED");
    assertEconomicIntentTransition("LOCKED", "EXECUTING");
    this.sql.exec(
      "UPDATE economic_intent SET state='EXECUTING',execution_id=?,updated_at=? WHERE singleton=1 AND state='AUTHORIZED' AND execution_id IS NULL",
      input.executionId,
      new Date().toISOString(),
    );
    return this.snapshot(this.requireRow());
  }

  public recordFulfillment(
    input: EconomicIntentFulfillmentInput,
  ): EconomicIntentSnapshot {
    const row = this.requireExecutionOwner(input.merchantId, input.executionId);
    const fulfillment = bindEconomicFulfillment({
      intent: this.binding(row),
      fulfillment: input.fulfillment,
    });
    if (row.fulfillment_json !== null) {
      const existing = JSON.parse(
        row.fulfillment_json,
      ) as EconomicFulfillmentBinding;
      if (existing.fulfillmentHash !== fulfillment.fulfillmentHash)
        throw conflict("Intent is already bound to another fulfillment");
      return this.snapshot(row);
    }
    if (row.state !== "EXECUTING")
      throw conflict(`Cannot fulfill intent from state ${row.state}`);

    assertEconomicIntentTransition("EXECUTING", "FULFILLED");
    this.sql.exec(
      "UPDATE economic_intent SET state='FULFILLED',fulfillment_json=?,updated_at=? WHERE singleton=1 AND state='EXECUTING' AND execution_id=?",
      JSON.stringify(fulfillment),
      new Date().toISOString(),
      input.executionId,
    );
    return this.snapshot(this.requireRow());
  }

  public recordSettlement(
    input: EconomicIntentSettlementInput,
  ): EconomicIntentSnapshot {
    const row = this.requireExecutionOwner(input.merchantId, input.executionId);
    if (row.authorization_json === null || row.fulfillment_json === null)
      throw conflict(
        "Authorization and fulfillment are required before settlement",
      );
    const intent = this.binding(row);
    const settlement = bindEconomicSettlement({
      intent,
      protocol: input.protocol,
      settlement: input.settlement,
      chargedAmountMicroUsd: input.chargedAmountMicroUsd,
    });
    if (row.settlement_json !== null) {
      const existing = JSON.parse(
        row.settlement_json,
      ) as EconomicSettlementBinding;
      if (
        existing.settlementHash !== settlement.settlementHash ||
        existing.chargedAmountMicroUsd !== settlement.chargedAmountMicroUsd
      )
        throw conflict("Intent is already bound to another settlement");
      return this.snapshot(row);
    }
    if (row.state !== "FULFILLED")
      throw conflict(`Cannot settle intent from state ${row.state}`);

    const authorization = JSON.parse(
      row.authorization_json,
    ) as EconomicAuthorizationBinding;
    const fulfillment = JSON.parse(
      row.fulfillment_json,
    ) as EconomicFulfillmentBinding;
    const proof = buildXGuardProof({
      intent,
      authorization,
      fulfillment,
      settlement,
    });

    assertEconomicIntentTransition("FULFILLED", "SETTLED");
    assertEconomicIntentTransition("SETTLED", "FINAL");
    this.sql.exec(
      "UPDATE economic_intent SET state='FINAL',settlement_json=?,proof_json=?,updated_at=? WHERE singleton=1 AND state='FULFILLED' AND execution_id=?",
      JSON.stringify(settlement),
      JSON.stringify(proof),
      new Date().toISOString(),
      input.executionId,
    );
    return this.snapshot(this.requireRow());
  }

  public quarantine(
    merchantId: string,
    reason: string,
  ): EconomicIntentSnapshot {
    const row = this.requireRow();
    this.assertMerchant(row, merchantId);
    if (row.state === "FINAL" || row.state === "QUARANTINED")
      return this.snapshot(row);
    if (reason.trim().length === 0)
      throw new XGuardError(
        "BAD_REQUEST",
        "quarantine reason is required",
        400,
      );
    assertEconomicIntentTransition(row.state, "QUARANTINED");
    this.sql.exec(
      "UPDATE economic_intent SET state='QUARANTINED',quarantine_reason=?,updated_at=? WHERE singleton=1",
      reason.trim(),
      new Date().toISOString(),
    );
    return this.snapshot(this.requireRow());
  }

  private row(): IntentRow | null {
    return (
      [
        ...this.sql.exec<IntentRow>(
          "SELECT * FROM economic_intent WHERE singleton=1",
        ),
      ][0] ?? null
    );
  }

  private requireRow(): IntentRow {
    const row = this.row();
    if (row === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    return row;
  }

  private requireExecutionOwner(
    merchantId: string,
    executionId: string,
  ): IntentRow {
    const row = this.requireRow();
    this.assertMerchant(row, merchantId);
    if (row.execution_id === null || row.execution_id !== executionId)
      throw conflict("Execution does not own this economic intent");
    return row;
  }

  private assertMerchant(row: IntentRow, merchantId: string): void {
    if (row.merchant_id !== merchantId)
      throw new XGuardError("UNAUTHORIZED", "Intent merchant mismatch", 403);
  }

  private expireIfEligible(row: IntentRow): void {
    if (row.state !== "BOUND" && row.state !== "AUTHORIZED") return;
    const binding = this.binding(row);
    if (!economicIntentIsExpired(binding)) return;
    assertEconomicIntentTransition(row.state, "EXPIRED");
    this.sql.exec(
      "UPDATE economic_intent SET state='EXPIRED',updated_at=? WHERE singleton=1 AND state=?",
      new Date().toISOString(),
      row.state,
    );
  }

  private binding(row: IntentRow): EconomicIntentBinding {
    return {
      intentId: row.intent_id,
      termsHash: row.terms_hash,
      terms: JSON.parse(row.terms_json) as EconomicIntentBinding["terms"],
    };
  }

  private snapshot(row: IntentRow): EconomicIntentSnapshot {
    const authorization =
      row.authorization_json === null
        ? null
        : (JSON.parse(row.authorization_json) as EconomicAuthorizationBinding);
    const fulfillment =
      row.fulfillment_json === null
        ? null
        : (JSON.parse(row.fulfillment_json) as EconomicFulfillmentBinding);
    const settlement =
      row.settlement_json === null
        ? null
        : (JSON.parse(row.settlement_json) as EconomicSettlementBinding);
    return {
      intentId: row.intent_id,
      merchantId: row.merchant_id,
      termsHash: row.terms_hash,
      terms: JSON.parse(row.terms_json) as EconomicIntentBinding["terms"],
      state: row.state,
      authorizationHash: authorization?.authorizationHash ?? null,
      authorizedAmountMicroUsd: authorization?.authorizedAmountMicroUsd ?? null,
      executionId: row.execution_id,
      fulfillmentHash: fulfillment?.fulfillmentHash ?? null,
      settlementHash: settlement?.settlementHash ?? null,
      proof:
        row.proof_json === null
          ? null
          : (JSON.parse(row.proof_json) as XGuardProof),
      quarantineReason: row.quarantine_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function conflict(message: string): XGuardError {
  return new XGuardError("BAD_REQUEST", message, 409);
}
