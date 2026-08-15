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

  it("exposes configured fee, route cost, and contribution on the public status endpoint", async () => {
    const source = await readFile("apps/worker/src/mainnet.ts", "utf8");

    expect(source).toContain("feeMicroUsd: feeMicroUsd(context.env)");
    expect(source).toContain(
      "downstreamCostMicroUsd: downstreamCostMicroUsd(context.env)",
    );
    expect(source).toContain(
      "contributionMicroUsd: feeMicroUsd(context.env) - downstreamCostMicroUsd(context.env)",
    );
  });
});
