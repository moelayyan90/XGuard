import { describe, expect, it } from "vitest";
import {
  evaluateOpportunity,
  evaluateShariahPolicy,
  type HunterCandidateInput,
} from "../apps/worker/src/global-opportunity-hunter.js";

function candidate(
  overrides: Partial<HunterCandidateInput> = {},
): HunterCandidateInput {
  const base: HunterCandidateInput = {
    source: "rfq-feed",
    externalId: "rfq-1",
    observedAt: "2026-08-21T13:30:00.000Z",
    title: "Siemens industrial automation module",
    description: "Verified surplus industrial spare part",
    category: "industrial automation components",
    buyer: {
      country: "SA",
      priceMicroUsd: 1_000_000_000,
      paymentSecured: true,
      fundsAvailableBeforePurchase: true,
      identityVerified: true,
    },
    supplier: {
      country: "JO",
      priceMicroUsd: 400_000_000,
      shippingMicroUsd: 40_000_000,
      dutiesMicroUsd: 20_000_000,
      platformFeesMicroUsd: 10_000_000,
      paymentFeesMicroUsd: 10_000_000,
      fxCostMicroUsd: 5_000_000,
      otherCostsMicroUsd: 5_000_000,
      requiredQuantity: 1,
      availableQuantity: 1,
      reliabilityBps: 9_500,
      inventoryVerified: true,
      identityVerified: true,
    },
    risk: {
      score: 10,
      counterfeitRisk: false,
      sanctionsRisk: false,
      restrictedGoodsRisk: false,
    },
  };
  return { ...base, ...overrides };
}

const NOW = new Date("2026-08-21T13:35:00.000Z").getTime();

describe("strict shariah gate", () => {
  it("allows clearly ordinary industrial trade", () => {
    expect(evaluateShariahPolicy(candidate())).toEqual({
      status: "HALAL",
      reason: "approved_trade_category",
    });
  });

  it.each([
    ["wine distribution equipment", "industrial machinery"],
    ["casino slot machine controller", "electronics"],
    ["vape replacement parts", "electronic components"],
    ["rifle spare parts", "industrial components"],
    ["pork processing spare kit", "industrial machinery"],
  ])("hard-blocks prohibited trade even inside a safe category: %s", (title, category) => {
    const result = evaluateShariahPolicy(candidate({ title, category }));
    expect(result.status).toBe("HARAM");
  });

  it("rejects ambiguous categories rather than guessing", () => {
    expect(
      evaluateShariahPolicy(
        candidate({ title: "protein product", category: "food supplement" }),
      ).status,
    ).toBe("UNKNOWN");
  });
});

describe("pre-funded back-to-back opportunity evaluation", () => {
  it("accepts a fresh, funded, verified, profitable opportunity", () => {
    const result = evaluateOpportunity(candidate(), NOW);
    expect(result.state).toBe("READY");
    expect(result.netProfitMicroUsd).toBe(510_000_000);
    expect(result.marginBps).toBe(5_100);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("never purchases before buyer funds are available", () => {
    const base = candidate();
    const result = evaluateOpportunity(
      candidate({
        buyer: { ...base.buyer, fundsAvailableBeforePurchase: false },
      }),
      NOW,
    );
    expect(result.state).toBe("REJECTED_FUNDING");
    expect(result.reasons).toContain("buyer_funds_not_available_before_purchase");
  });

  it("rejects apparent spread that disappears after landed costs", () => {
    const base = candidate();
    const result = evaluateOpportunity(
      candidate({
        supplier: {
          ...base.supplier,
          priceMicroUsd: 850_000_000,
          shippingMicroUsd: 100_000_000,
        },
      }),
      NOW,
    );
    expect(result.state).toBe("REJECTED_ECONOMICS");
    expect(result.netProfitMicroUsd).toBeLessThan(100_000_000);
  });

  it("rejects unverified inventory and counterfeit risk", () => {
    const base = candidate();
    const result = evaluateOpportunity(
      candidate({
        supplier: { ...base.supplier, inventoryVerified: false },
        risk: { ...base.risk, counterfeitRisk: true },
      }),
      NOW,
    );
    expect(result.state).toBe("REJECTED_RISK");
    expect(result.reasons).toContain("supplier_inventory_unverified");
    expect(result.reasons).toContain("counterfeit_risk");
  });

  it("rejects stale opportunities so execution cannot chase dead spreads", () => {
    const result = evaluateOpportunity(
      candidate({ observedAt: "2026-08-21T12:00:00.000Z" }),
      NOW,
    );
    expect(result.state).toBe("REJECTED_STALE");
  });
});
