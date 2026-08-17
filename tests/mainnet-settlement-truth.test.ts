import { describe, expect, it } from "vitest";
import { classifySettlementTruth } from "../apps/worker/src/mainnet-settlement-truth.js";

describe("mainnet settlement truth", () => {
  it("keeps absent or unresolved evidence pending", () => {
    expect(classifySettlementTruth(null, null)).toBe("PENDING");
    expect(
      classifySettlementTruth(
        { state: "PENDING", confirmed_at: null, last_error_code: null },
        null,
      ),
    ).toBe("PENDING");
  });

  it("treats independent Base confirmation as finalized even before billing projection catches up", () => {
    expect(
      classifySettlementTruth(
        {
          state: "PENDING",
          confirmed_at: "2026-08-17T08:00:00.000Z",
          last_error_code: null,
        },
        null,
      ),
    ).toBe("FINALIZED");
  });

  it("classifies confirmed finality and late recovery as finalized", () => {
    expect(
      classifySettlementTruth(
        {
          state: "CONFIRMED",
          confirmed_at: "2026-08-17T08:00:00.000Z",
          last_error_code: null,
        },
        null,
      ),
    ).toBe("FINALIZED");
    expect(classifySettlementTruth(null, { state: "CONFIRMED" })).toBe(
      "FINALIZED",
    );
  });

  it("classifies permanent finality failure and unused authorization closure as proven failed", () => {
    expect(
      classifySettlementTruth(
        {
          state: "PENDING",
          confirmed_at: null,
          last_error_code: "expected_usdc_transfer_not_found",
        },
        null,
      ),
    ).toBe("PROVEN_FAILED");
    expect(classifySettlementTruth(null, { state: "EXPIRED" })).toBe(
      "PROVEN_FAILED",
    );
    expect(classifySettlementTruth(null, { state: "CANCELED" })).toBe(
      "PROVEN_FAILED",
    );
  });

  it("fails closed when success and failure evidence conflict", () => {
    expect(
      classifySettlementTruth(
        {
          state: "CONFIRMED",
          confirmed_at: "2026-08-17T08:00:00.000Z",
          last_error_code: null,
        },
        { state: "FAILED" },
      ),
    ).toBe("CONFLICT");
  });
});
