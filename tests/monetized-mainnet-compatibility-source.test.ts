import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../apps/worker/src/monetized-mainnet.ts", import.meta.url),
  "utf8",
);

function billVerifySource() {
  const start = source.indexOf("async function billVerify(");
  const end = source.indexOf("\nasync function billDirectDiscovery(", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("monetized mainnet x402 compatibility boundary", () => {
  it("normalizes verify traffic before merchant authorization", () => {
    const verify = billVerifySource();
    const normalize = verify.indexOf("normalizeX402CompatibilityRequest(request)");
    const authorize = verify.indexOf("authorizeMerchantScope(");

    expect(normalize).toBeGreaterThanOrEqual(0);
    expect(authorize).toBeGreaterThan(normalize);
  });

  it("preserves compatibility headers on both auth failures and execution responses", () => {
    const verify = billVerifySource();

    expect(verify).toContain(
      "adaptCompatibilityResponse(access.response, compatibility)",
    );
    expect(verify).toContain("await delegateFetch(effectiveRequest, env, ctx)");
    expect(verify).toContain("compatibility,");
  });

  it("delegates invalid legacy traffic without reserving a monetization fee", () => {
    const verify = billVerifySource();
    const catchIndex = verify.indexOf("catch {");
    const delegateIndex = verify.indexOf("return delegateFetch(request, env, ctx);");
    const billIndex = verify.indexOf("return billExecution({");

    expect(catchIndex).toBeGreaterThanOrEqual(0);
    expect(delegateIndex).toBeGreaterThan(catchIndex);
    expect(billIndex).toBeGreaterThan(delegateIndex);
  });
});
