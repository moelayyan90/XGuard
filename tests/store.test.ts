import { afterEach, describe, expect, it } from "vitest";
import { SqliteFinancialStore } from "@xguard/core";

const stores: SqliteFinancialStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
});

describe("immutable double-entry financial store", () => {
  it("separates merchant liabilities from earned treasury", () => {
    const store = new SqliteFinancialStore();
    stores.push(store);
    store.createMerchant({
      id: "m",
      name: "M",
      apiKeyHash: "h",
      openingBalanceMicroUsd: 1_000_000n,
    });
    const report = store.getFinancialReport();
    expect(report.treasuryAssetMicroUsd).toBe(1_000_000n);
    expect(report.customerLiabilitiesMicroUsd).toBe(1_000_000n);
    expect(report.availableTreasuryMicroUsd).toBe(0n);
    expect(report.ownerDistributableMicroUsd).toBe(0n);
    expect(store.verifyLedgerBalance()).toEqual({
      balanced: true,
      imbalancedTransactionIds: [],
    });
  });

  it("deduplicates top-up references", () => {
    const store = new SqliteFinancialStore();
    stores.push(store);
    store.createMerchant({ id: "m", name: "M", apiKeyHash: "h" });
    store.creditMerchant("m", 100n, "provider-event-1");
    store.creditMerchant("m", 100n, "provider-event-1");
    expect(store.getMerchant("m")?.availableBalanceMicroUsd).toBe(100n);
  });
});
