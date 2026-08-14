import { afterEach, describe, expect, it } from "vitest";
import {
  RoutingEngine,
  SettlementCoordinator,
  SqliteFinancialStore,
  evaluateOwnerPayout,
  type PayoutRecord,
  type PayoutTransferEvidence,
} from "@xguard/core";
import {
  ASSET,
  fixturePayment,
  MockFacilitator,
  PAYER,
  PAY_TO,
} from "./fixtures.js";

const stores: SqliteFinancialStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
});

async function earnedStore(): Promise<SqliteFinancialStore> {
  const store = new SqliteFinancialStore();
  stores.push(store);
  store.createMerchant({
    id: "merchant",
    name: "Merchant",
    apiKeyHash: "hash",
    openingBalanceMicroUsd: 200_000_000n,
  });
  const mock = new MockFacilitator(["eip155:8453"]);
  const router = new RoutingEngine(
    [
      {
        id: "mock",
        url: "https://mock.invalid",
        client: mock,
        downstreamCostMicroUsd: 0n,
      },
    ],
    150_000_000n,
    0n,
  );
  const coordinator = new SettlementCoordinator(store, router, {
    mainnetEnabled: true,
    feeMicroUsd: 150_000_000n,
    supportedNetworks: new Set(["eip155:8453"]),
    finalityAdapter: {
      validate: async ({ facilitatorResponse, paymentRequirements }) => ({
        finalized: facilitatorResponse.success,
        confirmations: 1,
        network: paymentRequirements.network,
        transaction: facilitatorResponse.transaction,
        payer: PAYER,
        payTo: PAY_TO,
        asset: ASSET,
        amount: paymentRequirements.amount,
        observedAt: new Date().toISOString(),
        evidenceReference: `test-finality:${facilitatorResponse.transaction}`,
      }),
    },
  });
  await coordinator.initialize();
  await coordinator.settle(
    "merchant",
    fixturePayment({ network: "eip155:8453" }).payload,
    fixturePayment({ network: "eip155:8453" }).requirements,
  );
  return store;
}

const safeSignals = {
  destinationVerified: true,
  kycComplete: true,
  providerAuthorized: true,
  availableBalanceCertain: true,
  reconciliationConsistent: true,
  providerOperational: true,
  previousPayoutUnambiguous: true,
  fundsFinal: true,
};

const defaultPayoutPolicy = {
  enabled: true,
  minimumPayoutMicroUsd: 100_000_000n,
  providerMinimumMicroUsd: 1n,
  providerFeeMicroUsd: 0n,
};

function preparePayout(
  store: SqliteFinancialStore,
  providerIdempotencyKey: string,
  options: {
    safety?: typeof safeSignals;
    policy?: typeof defaultPayoutPolicy;
  } = {},
) {
  return store.prepareOwnerPayout({
    provider: "sandbox",
    providerIdempotencyKey,
    policy: options.policy ?? defaultPayoutPolicy,
    safety: options.safety ?? safeSignals,
  });
}

function payoutEvidence(
  payout: PayoutRecord,
  status: PayoutTransferEvidence["status"],
): PayoutTransferEvidence {
  if (payout.providerReference === null)
    throw new Error(
      "provider reference must be assigned before final evidence",
    );
  return {
    provider: payout.provider,
    providerReference: payout.providerReference,
    status,
    destinationAmountMicroUsd: payout.amountMicroUsd,
    providerFeeMicroUsd: payout.providerFeeMicroUsd,
    observedAt: new Date().toISOString(),
    evidenceReference: `test-provider-evidence:${status}:${payout.id}`,
  };
}

describe("fail-closed owner payout policy", () => {
  it("distinguishes disabled, below-threshold, and invalid policies", async () => {
    const store = await earnedStore();
    expect(
      evaluateOwnerPayout(store.getFinancialReport(), safeSignals, {
        enabled: false,
        minimumPayoutMicroUsd: 100_000_000n,
        providerMinimumMicroUsd: 0n,
        providerFeeMicroUsd: 0n,
      }).state,
    ).toBe("DISABLED");
    expect(
      evaluateOwnerPayout(store.getFinancialReport(), safeSignals, {
        enabled: true,
        minimumPayoutMicroUsd: 200_000_000n,
        providerMinimumMicroUsd: 0n,
        providerFeeMicroUsd: 1_000n,
      }).state,
    ).toBe("BELOW_THRESHOLD");
    expect(() =>
      evaluateOwnerPayout(store.getFinancialReport(), safeSignals, {
        enabled: true,
        minimumPayoutMicroUsd: 0n,
        providerMinimumMicroUsd: 0n,
        providerFeeMicroUsd: 0n,
      }),
    ).toThrow(/invalid/);
  });

  it("blocks when identity, destination, or reconciliation prerequisites are missing", async () => {
    const store = await earnedStore();
    const decision = evaluateOwnerPayout(
      store.getFinancialReport(),
      { ...safeSignals, kycComplete: false, destinationVerified: false },
      {
        enabled: true,
        minimumPayoutMicroUsd: 100_000_000n,
        providerMinimumMicroUsd: 1n,
        providerFeeMicroUsd: 0n,
      },
    );
    expect(decision).toMatchObject({ state: "BLOCKED", amountMicroUsd: 0n });
    expect(decision.reasons).toContain("kyc_incomplete");
  });

  it("reserves an idempotent payout and prevents a second use of distributable funds", async () => {
    const store = await earnedStore();
    const prepared = preparePayout(store, "daily-2026-08-14");
    const replay = preparePayout(store, "daily-2026-08-14");
    expect(replay.id).toBe(prepared.id);
    expect(prepared.safetySnapshot).toEqual(safeSignals);
    expect(prepared.policySnapshot).toMatchObject({
      ...defaultPayoutPolicy,
      reservePercent: 20,
      minimumReserveMicroUsd: 25_000_000n,
    });
    expect(prepared.grossCashRequirementMicroUsd).toBe(
      prepared.amountMicroUsd + prepared.providerFeeMicroUsd,
    );
    expect(store.getFinancialReport().ownerDistributableMicroUsd).toBe(0n);
    expect(() =>
      preparePayout(store, "daily-2026-08-14", {
        policy: {
          ...defaultPayoutPolicy,
          minimumPayoutMicroUsd: 1n,
        },
      }),
    ).toThrow(/different terms/);
  });

  it("atomically reserves the provider fee so it cannot fund another payout", async () => {
    const store = await earnedStore();
    const prepared = preparePayout(store, "payout-with-provider-fee", {
      policy: {
        ...defaultPayoutPolicy,
        providerFeeMicroUsd: 10_000_000n,
      },
    });
    expect(prepared).toMatchObject({
      amountMicroUsd: 110_000_000n,
      providerFeeMicroUsd: 10_000_000n,
      grossCashRequirementMicroUsd: 120_000_000n,
    });
    expect(store.getFinancialReport()).toMatchObject({
      pendingOwnerPayoutMicroUsd: 120_000_000n,
      ownerDistributableMicroUsd: 0n,
    });
    expect(() =>
      preparePayout(store, "second-payout-using-fee", {
        policy: {
          ...defaultPayoutPolicy,
          minimumPayoutMicroUsd: 1n,
          providerMinimumMicroUsd: 0n,
        },
      }),
    ).toThrow(/not eligible/);
  });

  it("cannot bypass safety, open reconciliation, or a prior ambiguous payout", async () => {
    const unsafeStore = await earnedStore();
    expect(() =>
      preparePayout(unsafeStore, "unsafe-payout", {
        safety: {
          ...safeSignals,
          destinationVerified: false,
          kycComplete: false,
        },
      }),
    ).toThrow(/destination_unverified.*kyc_incomplete/);
    expect(unsafeStore.getFinancialReport().pendingOwnerPayoutMicroUsd).toBe(
      0n,
    );

    unsafeStore.prepareSettlement({
      logicalPaymentKey: "unresolved-payment",
      settlementStepKey: "unresolved-payment-step",
      requestFingerprint: "unresolved-payment-fingerprint",
      paymentIdentifier: null,
      paymentIdentifierExpiresAtSeconds: 9_999_999_999n,
      merchantId: "merchant",
      network: "eip155:8453",
      scheme: "exact",
      payer: PAYER,
      asset: ASSET,
      payTo: PAY_TO,
      amountAtomic: "1",
      expiresAtSeconds: 9_999_999_999n,
      testnet: false,
      feeMicroUsd: 1n,
    });
    unsafeStore.markOutboundStarted("unresolved-payment", "mock");
    unsafeStore.markAmbiguous("unresolved-payment", "timeout after submit");
    expect(() =>
      preparePayout(unsafeStore, "open-reconciliation-payout"),
    ).toThrow(/open_reconciliation_cases/);

    const ambiguousPayoutStore = await earnedStore();
    const first = preparePayout(ambiguousPayoutStore, "first-ambiguous-payout");
    ambiguousPayoutStore.markPayoutSubmitted(first.id, "provider-reference");
    ambiguousPayoutStore.markPayoutAmbiguous(first.id, "provider timeout");
    expect(() =>
      preparePayout(ambiguousPayoutStore, "payout-after-ambiguity", {
        policy: {
          ...defaultPayoutPolicy,
          minimumPayoutMicroUsd: 1n,
          providerMinimumMicroUsd: 0n,
        },
      }),
    ).toThrow(/previous_payout_ambiguous/);
  });

  it("never resubmits an ambiguous payout and only posts cash movement after evidence", async () => {
    const store = await earnedStore();
    const prepared = preparePayout(store, "payout-ambiguous");
    store.markPayoutSubmitted(prepared.id, "provider-reference");
    const ambiguous = store.markPayoutAmbiguous(
      prepared.id,
      "provider timeout after submission",
    );
    expect(() =>
      store.markPayoutSubmitted(prepared.id, "second-reference"),
    ).toThrow();
    const paid = store.reconcileAmbiguousPayoutPaid(
      prepared.id,
      payoutEvidence(ambiguous, "FINAL_CREDIT"),
    );
    expect(paid.state).toBe("PAID");
    expect(store.getFinancialReport().paidOwnerProfitMicroUsd).toBe(
      prepared.amountMicroUsd,
    );
    expect(store.verifyLedgerBalance().balanced).toBe(true);
  });

  it("reverses paid-profit accounting only after a returned payout is proven", async () => {
    const store = await earnedStore();
    const payout = preparePayout(store, "payout-returned", {
      policy: {
        ...defaultPayoutPolicy,
        providerFeeMicroUsd: 10_000_000n,
      },
    });
    const treasuryBefore = store.getFinancialReport().treasuryAssetMicroUsd;
    store.markPayoutSubmitted(payout.id, "provider-return-reference");
    const pending = store.markPayoutPending(payout.id);
    const paidRecord = store.markPayoutPaid(
      payout.id,
      payoutEvidence(pending, "FINAL_CREDIT"),
    );
    expect(store.getFinancialReport()).toMatchObject({
      treasuryAssetMicroUsd:
        treasuryBefore - payout.grossCashRequirementMicroUsd,
      operatingCostsMicroUsd: payout.providerFeeMicroUsd,
      paidOwnerProfitMicroUsd: payout.amountMicroUsd,
    });
    const returned = store.markPayoutReturned(
      payout.id,
      payoutEvidence(paidRecord, "FINAL_RETURN"),
    );
    expect(returned.state).toBe("RETURNED");
    expect(store.getFinancialReport()).toMatchObject({
      treasuryAssetMicroUsd: treasuryBefore - payout.providerFeeMicroUsd,
      operatingCostsMicroUsd: payout.providerFeeMicroUsd,
      paidOwnerProfitMicroUsd: 0n,
    });
    expect(store.verifyLedgerBalance().balanced).toBe(true);
  });

  it("releases a submitted payout returned before credit and records only the provider fee", async () => {
    const store = await earnedStore();
    const payout = preparePayout(store, "payout-direct-return", {
      policy: {
        ...defaultPayoutPolicy,
        providerFeeMicroUsd: 10_000_000n,
      },
    });
    const treasuryBefore = store.getFinancialReport().treasuryAssetMicroUsd;
    const submitted = store.markPayoutSubmitted(
      payout.id,
      "provider-direct-return-reference",
    );
    const evidence = payoutEvidence(submitted, "FINAL_RETURN");
    const returned = store.markPayoutReturned(payout.id, evidence);
    expect(returned.state).toBe("RETURNED");
    expect(returned.transferEvidence).toEqual(evidence);
    expect(store.getFinancialReport()).toMatchObject({
      treasuryAssetMicroUsd: treasuryBefore - payout.providerFeeMicroUsd,
      operatingCostsMicroUsd: payout.providerFeeMicroUsd,
      pendingOwnerPayoutMicroUsd: 0n,
      paidOwnerProfitMicroUsd: 0n,
    });
    expect(store.markPayoutReturned(payout.id, evidence).state).toBe(
      "RETURNED",
    );
    expect(() =>
      store.markPayoutReturned(payout.id, {
        ...evidence,
        evidenceReference: "conflicting-final-return-proof",
      }),
    ).toThrow(/conflicts with the recorded proof/);
    expect(store.verifyLedgerBalance().balanced).toBe(true);
  });

  it("records and pays operating costs idempotently without using customer liabilities", async () => {
    const store = await earnedStore();
    const expense = store.accrueOperatingExpense({
      category: "COMPUTE",
      amountMicroUsd: 10_000_000n,
      externalReference: "cloud-invoice-2026-08",
      evidence: "verified provider invoice",
    });
    const replay = store.accrueOperatingExpense({
      category: "COMPUTE",
      amountMicroUsd: 10_000_000n,
      externalReference: "cloud-invoice-2026-08",
      evidence: "verified provider invoice",
    });
    expect(replay.id).toBe(expense.id);
    expect(store.getFinancialReport()).toMatchObject({
      operatingCostsMicroUsd: 10_000_000n,
      unpaidOperatingLiabilitiesMicroUsd: 10_000_000n,
    });
    const paid = store.markOperatingExpensePaid({
      expenseId: expense.id,
      paymentReference: "cloud-payment-2026-08",
      evidence: "provider payment final",
    });
    expect(paid.state).toBe("PAID");
    expect(store.getFinancialReport().unpaidOperatingLiabilitiesMicroUsd).toBe(
      0n,
    );
    expect(store.getFinancialReport().operatingCostsMicroUsd).toBe(10_000_000n);
    expect(store.verifyLedgerBalance().balanced).toBe(true);

    const liabilitiesOnly = new SqliteFinancialStore();
    stores.push(liabilitiesOnly);
    liabilitiesOnly.createMerchant({
      id: "liability-merchant",
      name: "Liability merchant",
      apiKeyHash: "liability-hash",
      openingBalanceMicroUsd: 1_000_000n,
    });
    const blocked = liabilitiesOnly.accrueOperatingExpense({
      category: "DATABASE",
      amountMicroUsd: 1n,
      externalReference: "database-invoice",
      evidence: "provider invoice",
    });
    expect(() =>
      liabilitiesOnly.markOperatingExpensePaid({
        expenseId: blocked.id,
        paymentReference: "unauthorized-liability-spend",
        evidence: "none",
      }),
    ).toThrow(/customer liabilities/);
  });
});
