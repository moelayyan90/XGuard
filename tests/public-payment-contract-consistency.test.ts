import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  XGUARD_ATTEMPT_EVENT,
  XGUARD_ATTEMPT_FEE_MICRO_USD,
  XGUARD_ATTEMPT_FEE_USD,
} from "../apps/worker/src/public-payment-contract.js";

const runtimeSource = readFileSync(
  new URL("../apps/worker/src/monetized-mainnet.ts", import.meta.url),
  "utf8",
);
const wranglerSource = readFileSync(
  new URL("../apps/worker/wrangler.mainnet.jsonc", import.meta.url),
  "utf8",
);
const pricingDocs = readFileSync(new URL("../PRICING.md", import.meta.url), "utf8");
const billingDocs = readFileSync(new URL("../BILLING.md", import.meta.url), "utf8");

describe("canonical public payment contract consistency", () => {
  it("keeps runtime fee execution bound to the public contract constants", () => {
    expect(runtimeSource).toContain("XGUARD_ATTEMPT_FEE_MICRO_USD");
    expect(runtimeSource).toContain("XGUARD_ATTEMPT_FEE_USD");
    expect(runtimeSource).toContain("XGUARD_ATTEMPT_EVENT");
    expect(runtimeSource).not.toContain("const ATTEMPT_FEE_MICRO_USD = 40_000");
    expect(runtimeSource).not.toContain('headers.set("X-XGuard-Attempt-Fee-USD", "0.04")');
  });

  it("keeps deployment configuration on the canonical micro-USD amount", () => {
    expect(wranglerSource).toContain(
      `"XGUARD_FEE_MICRO_USD": "${XGUARD_ATTEMPT_FEE_MICRO_USD}"`,
    );
    expect(XGUARD_ATTEMPT_FEE_USD).toBe("0.03");
    expect(XGUARD_ATTEMPT_FEE_MICRO_USD).toBe(30_000);
    expect(XGUARD_ATTEMPT_EVENT).toBe(
      "accepted_authenticated_economic_attempt",
    );
  });

  it("keeps pricing and billing documentation on the attempt-fee model", () => {
    for (const document of [pricingDocs, billingDocs]) {
      expect(document).toContain(`$${XGUARD_ATTEMPT_FEE_USD}`);
      expect(document).toContain("accepted authenticated");
      expect(document).not.toContain("$0.002 per successful billable settlement");
      expect(document).not.toContain("Successful finalized x402 settlement | $0.0020");
    }
  });
});
