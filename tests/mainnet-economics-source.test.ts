import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mainnet finalized settlement economics", () => {
  it("persists both the earned XGuard fee and configured downstream route cost", async () => {
    const source = await readFile("apps/worker/src/mainnet.ts", "utf8");

    expect(source).toContain(
      "UPDATE settlement_projection SET state='SETTLED',fee_micro_usd=?,downstream_cost_micro_usd=?,recorded_at=? WHERE logical_payment_key=?",
    );
    expect(source).toContain(
      ".bind(\n          feeMicroUsd(env),\n          downstreamCostMicroUsd(env),\n          now,\n          job.logical_payment_key,\n        )",
    );
  });
});
