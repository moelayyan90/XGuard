import { afterEach, describe, expect, it } from "vitest";
import {
  AmbiguousSettlementError,
  RoutingEngine,
  SettlementCoordinator,
  SqliteFinancialStore,
  XGuardError,
  type SettlementFinalityContext,
} from "@xguard/core";
import {
  ASSET,
  PAY_TO,
  PAYER,
  fixturePayment,
  MockFacilitator,
} from "./fixtures.js";

const stores: SqliteFinancialStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
});

async function setup(
  options: {
    network?: `${string}:${string}`;
    balance?: bigint;
    cost?: bigint | null;
    finalityMode?: "valid" | "mismatch" | "missing";
  } = {},
) {
  const network = options.network ?? "eip155:84532";
  const store = new SqliteFinancialStore();
  stores.push(store);
  store.createMerchant({
    id: "merchant",
    name: "Merchant",
    apiKeyHash: "hash",
    openingBalanceMicroUsd: options.balance ?? 0n,
  });
  const mock = new MockFacilitator([network]);
  const router = new RoutingEngine(
    [
      {
        id: "mock",
        url: "https://facilitator.example",
        client: mock,
        downstreamCostMicroUsd: options.cost ?? 0n,
      },
    ],
    2_000n,
    0n,
  );
  const coordinator = new SettlementCoordinator(store, router, {
    mainnetEnabled: network !== "eip155:84532",
    feeMicroUsd: 2_000n,
    supportedNetworks: new Set([network]),
    ...(network === "eip155:84532" || options.finalityMode === "missing"
      ? {}
      : {
          finalityAdapter: {
            validate: async (context: SettlementFinalityContext) => ({
              finalized: true,
              confirmations: 1,
              network: context.facilitatorResponse.network,
              transaction: context.facilitatorResponse.transaction,
              payer: context.expectedPayer,
              payTo: context.paymentRequirements.payTo,
              asset: context.paymentRequirements.asset,
              amount:
                options.finalityMode === "mismatch"
                  ? "999999"
                  : context.paymentRequirements.amount,
              observedAt: new Date().toISOString(),
              evidenceReference: `test-finality:${context.paymentKey}`,
            }),
          },
        }),
  });
  await coordinator.initialize();
  return { store, mock, coordinator };
}

describe("single-submission coordinator", () => {
  it.each([10, 100, 1_000])(
    "suppresses %i simultaneous duplicate settlements",
    async (concurrency) => {
      const { store, mock, coordinator } = await setup();
      mock.delayMs = 20;
      const payment = fixturePayment();
      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () =>
          coordinator.settle("merchant", payment.payload, payment.requirements),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(mock.settleCalls).toBe(1);
      expect(store.getFinancialReport().transactionCount).toBe(1n);
      expect(store.getFinancialReport().billableSettlementCount).toBe(0n);
      expect(store.verifyLedgerBalance().balanced).toBe(true);
    },
  );

  it("returns the stored result after completion without a second settlement or bill", async () => {
    const { store, mock, coordinator } = await setup({
      network: "eip155:8453",
      balance: 1_000_000n,
      cost: 500n,
    });
    const payment = fixturePayment({ network: "eip155:8453" });
    const first = await coordinator.settle(
      "merchant",
      payment.payload,
      payment.requirements,
    );
    const replay = await coordinator.settle(
      "merchant",
      payment.payload,
      payment.requirements,
    );
    expect(first.result.success).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(mock.settleCalls).toBe(1);
    const report = store.getFinancialReport();
    expect(report.billableSettlementCount).toBe(1n);
    expect(report.grossRevenueMicroUsd).toBe(2_000n);
    expect(report.operatingCostsMicroUsd).toBe(500n);
    expect(report.contributionMicroUsd).toBe(1_500n);
    expect(store.getMerchant("merchant")?.availableBalanceMicroUsd).toBe(
      998_000n,
    );
    expect(store.verifyLedgerBalance().balanced).toBe(true);
  });

  it("keeps mainnet disabled without independent finality and quarantines mismatched evidence", async () => {
    const missing = await setup({
      network: "eip155:8453",
      balance: 10_000n,
      finalityMode: "missing",
    });
    const first = fixturePayment({ network: "eip155:8453" });
    await expect(
      missing.coordinator.settle("merchant", first.payload, first.requirements),
    ).rejects.toMatchObject<XGuardError>({ code: "MAINNET_DISABLED" });
    expect(missing.mock.settleCalls).toBe(0);
    expect(missing.store.getFinancialReport().grossRevenueMicroUsd).toBe(0n);

    const mismatch = await setup({
      network: "eip155:8453",
      balance: 10_000n,
      finalityMode: "mismatch",
    });
    const second = fixturePayment({
      network: "eip155:8453",
      nonce: `0x${"65".repeat(32)}`,
    });
    await expect(
      mismatch.coordinator.settle(
        "merchant",
        second.payload,
        second.requirements,
      ),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    expect(mismatch.mock.settleCalls).toBe(1);
    expect(mismatch.store.getFinancialReport()).toMatchObject({
      grossRevenueMicroUsd: 0n,
      ambiguousSettlementCount: 1n,
    });
  });

  it("never bills testnet and requires chain proof for a mainnet rejection", async () => {
    const testnet = await setup();
    const testPayment = fixturePayment();
    await testnet.coordinator.settle(
      "merchant",
      testPayment.payload,
      testPayment.requirements,
    );
    expect(testnet.store.getFinancialReport().grossRevenueMicroUsd).toBe(0n);

    const mainnet = await setup({ network: "eip155:8453", balance: 10_000n });
    mainnet.mock.settleMode = "failure";
    const failedPayment = fixturePayment({
      network: "eip155:8453",
      nonce: `0x${"34".repeat(32)}`,
    });
    await expect(
      mainnet.coordinator.settle(
        "merchant",
        failedPayment.payload,
        failedPayment.requirements,
      ),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    expect(mainnet.store.getFinancialReport().grossRevenueMicroUsd).toBe(0n);
    expect(
      mainnet.store.getMerchant("merchant")?.availableBalanceMicroUsd,
    ).toBe(8_000n);
    expect(mainnet.store.getFinancialReport().ambiguousSettlementCount).toBe(
      1n,
    );
  });

  it("holds ambiguous settlements and forbids automatic retry", async () => {
    const { store, mock, coordinator } = await setup({
      network: "eip155:8453",
      balance: 10_000n,
    });
    mock.settleMode = "ambiguous";
    const payment = fixturePayment({ network: "eip155:8453" });
    await expect(
      coordinator.settle("merchant", payment.payload, payment.requirements),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    await expect(
      coordinator.settle("merchant", payment.payload, payment.requirements),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    expect(mock.settleCalls).toBe(1);
    expect(store.getFinancialReport().grossRevenueMicroUsd).toBe(0n);
    expect(store.getFinancialReport().ambiguousSettlementCount).toBe(1n);
    expect(store.getMerchant("merchant")?.availableBalanceMicroUsd).toBe(
      8_000n,
    );
  });

  it("resolves ambiguity as failed without billing and releases the hold", async () => {
    const { store, mock, coordinator } = await setup({
      network: "eip155:8453",
      balance: 10_000n,
    });
    mock.settleMode = "ambiguous";
    const payment = fixturePayment({
      network: "eip155:8453",
      nonce: `0x${"78".repeat(32)}`,
    });
    const identity = coordinator.deriveIdentities(
      payment.payload,
      payment.requirements,
    );
    await expect(
      coordinator.settle("merchant", payment.payload, payment.requirements),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    store.reconcileAsFailed({
      paymentKey: identity.logicalPaymentKey,
      reason: "independent chain query proved nonce unused",
      failureEvidence: {
        source: "INDEPENDENT_CHAIN",
        network: "eip155:8453",
        paymentKey: identity.logicalPaymentKey,
        authorizationUnused: true,
        observedAt: new Date().toISOString(),
        evidenceReference: "chain-query:eip155:8453:block-finalized",
      },
    });
    const replay = await coordinator.settle(
      "merchant",
      payment.payload,
      payment.requirements,
    );
    expect(replay.result.success).toBe(false);
    expect(mock.settleCalls).toBe(1);
    expect(store.getMerchant("merchant")?.availableBalanceMicroUsd).toBe(
      10_000n,
    );
    expect(store.getFinancialReport().grossRevenueMicroUsd).toBe(0n);
    expect(store.getFinancialReport().ambiguousSettlementCount).toBe(0n);
  });

  it("resolves ambiguity as settled once and captures one fee", async () => {
    const { store, mock, coordinator } = await setup({
      network: "eip155:8453",
      balance: 10_000n,
    });
    mock.settleMode = "ambiguous";
    const payment = fixturePayment({
      network: "eip155:8453",
      nonce: `0x${"90".repeat(32)}`,
    });
    const identity = coordinator.deriveIdentities(
      payment.payload,
      payment.requirements,
    );
    await expect(
      coordinator.settle("merchant", payment.payload, payment.requirements),
    ).rejects.toBeInstanceOf(AmbiguousSettlementError);
    store.reconcileAsSettled({
      paymentKey: identity.logicalPaymentKey,
      response: {
        success: true,
        transaction: `0x${"cd".repeat(32)}`,
        network: "eip155:8453",
        amount: payment.requirements.amount,
      },
      facilitatorId: "mock",
      downstreamCostMicroUsd: 500n,
      finalityEvidence: {
        source: "INDEPENDENT_CHAIN",
        finalized: true,
        confirmations: 1,
        network: "eip155:8453",
        transaction: `0x${"cd".repeat(32)}`,
        payer: PAYER,
        payTo: PAY_TO,
        asset: ASSET,
        amount: payment.requirements.amount,
        observedAt: new Date().toISOString(),
        evidenceReference: "finalized-chain-receipt",
      },
    });
    const report = store.getFinancialReport();
    expect(report.billableSettlementCount).toBe(1n);
    expect(report.grossRevenueMicroUsd).toBe(2_000n);
    expect(report.operatingCostsMicroUsd).toBe(500n);
    expect(store.verifyLedgerBalance().balanced).toBe(true);
  });

  it("rejects Payment Identifier and binding conflicts", async () => {
    const { coordinator } = await setup();
    const first = fixturePayment({
      paymentId: "pay_same_identifier_1234567890abcdef",
    });
    await coordinator.settle("merchant", first.payload, first.requirements);
    const conflict = fixturePayment({
      nonce: `0x${"56".repeat(32)}`,
      paymentId: "pay_same_identifier_1234567890abcdef",
    });
    await expect(
      coordinator.settle("merchant", conflict.payload, conflict.requirements),
    ).rejects.toMatchObject<XGuardError>({ code: "PAYMENT_CONFLICT" });
  });
});
