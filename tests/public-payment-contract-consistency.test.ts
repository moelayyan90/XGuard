import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  XGUARD_ATTEMPT_EVENT,
  XGUARD_ATTEMPT_FEE_MICRO_USD,
  XGUARD_ATTEMPT_FEE_USD,
} from "../apps/worker/src/public-payment-contract.js";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const runtimeSource = read("../apps/worker/src/monetized-mainnet.ts");
const discoverySource = read("../apps/worker/src/discovery.ts");
const wranglerSource = read("../apps/worker/wrangler.mainnet.jsonc");
const staticOpenApi = read("../docs/openapi.yaml");

const canonicalPublicDocs = [
  "../PRICING.md",
  "../BILLING.md",
  "../QUICKSTART.md",
  "../UNIT_ECONOMICS.md",
  "../TREASURY.md",
  "../PAYOUTS.md",
  "../DEPLOYMENT.md",
  "../ARCHITECTURE.md",
  "../RECONCILIATION.md",
  "../SECURITY.md",
  "../docs/API.md",
  "../docs/PAYMENTS.md",
  "../docs/FACILITATORS.md",
].map(read);

const forbiddenLegacyContractPhrases = [
  "successful_billable_settlement",
  "$0.002 per successful billable settlement",
  "$0.04 per accepted authenticated economic attempt",
  "Successful finalized x402 settlement | $0.0020",
  "XGuard's canonical x402 economic-attempt fee is **$0.04**",
  "successful settlement reaches independent finalized on-chain confirmation",
  "fees earned from final successful billable settlements",
  "successful-settlement and independent-finality boundary",
  "earns its service fee only after successful finality confirmation",
];

describe("canonical public payment contract consistency", () => {
  it("keeps runtime fee execution bound to the public fee constants", () => {
    expect(runtimeSource).toContain("XGUARD_ATTEMPT_FEE_MICRO_USD");
    expect(runtimeSource).toContain("XGUARD_ATTEMPT_FEE_USD");
    expect(runtimeSource).not.toContain("const ATTEMPT_FEE_MICRO_USD = 40_000");
    expect(runtimeSource).not.toContain(
      'headers.set("X-XGuard-Attempt-Fee-USD", "0.04")',
    );
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

  it("keeps public discovery generated from the canonical contract", () => {
    expect(discoverySource).toContain("XGUARD_ATTEMPT_FEE_USD");
    expect(discoverySource).toContain("XGUARD_ATTEMPT_EVENT");
    expect(discoverySource).toContain("XGUARD_ATTEMPT_BILLING");
    expect(discoverySource).toContain("XGUARD_ATTEMPT_MODEL");
    expect(discoverySource).not.toContain('feeUsd: "0.002"');
    expect(discoverySource).not.toContain(
      'event: "successful_billable_settlement"',
    );
  });

  it("keeps the static OpenAPI contract on the canonical x402 fee", () => {
    expect(staticOpenApi).toContain('amountUsd: { const: "0.03" }');
    expect(staticOpenApi).toContain("amountMicroUsd: { const: 30000 }");
    expect(staticOpenApi).toContain(
      "event: { const: accepted_authenticated_economic_attempt }",
    );
    expect(staticOpenApi).not.toContain("successful_billable_settlement");
    expect(staticOpenApi).not.toContain('amount: { const: "0.002" }');
  });

  it("prevents canonical public docs from regressing to an older x402 contract", () => {
    for (const document of canonicalPublicDocs) {
      expect(document).toContain(`$${XGUARD_ATTEMPT_FEE_USD}`);
      for (const legacy of forbiddenLegacyContractPhrases) {
        expect(document).not.toContain(legacy);
      }
    }
  });
});
