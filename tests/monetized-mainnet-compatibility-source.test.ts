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
  it("authenticates verify traffic before compatibility parsing", () => {
    const verify = billVerifySource();
    const authorize = verify.indexOf("authorizeMerchantScope(");
    const normalize = verify.indexOf(
      "normalizeX402CompatibilityRequest(request)",
    );

    expect(authorize).toBeGreaterThanOrEqual(0);
    expect(normalize).toBeGreaterThan(authorize);
  });

  it("does not leak compatibility adaptation on authentication failures", () => {
    const verify = billVerifySource();
    const authorize = verify.indexOf("authorizeMerchantScope(");
    const authFailure = verify.indexOf("if (!access.ok)", authorize);
    const normalize = verify.indexOf(
      "normalizeX402CompatibilityRequest(request)",
    );
    const authFailureBlock = verify.slice(authFailure, normalize);

    expect(authFailure).toBeGreaterThan(authorize);
    expect(authFailureBlock).toContain("return access.response;");
    expect(authFailureBlock).not.toContain("adaptCompatibilityResponse(");
    expect(verify).toContain("await delegateFetch(effectiveRequest, env, ctx)");
    expect(verify).toContain("compatibility,");
  });

  it("delegates invalid authenticated legacy traffic without reserving a monetization fee", () => {
    const verify = billVerifySource();
    const catchIndex = verify.indexOf("catch {");
    const delegateIndex = verify.indexOf(
      "return delegateFetch(request, env, ctx);",
    );
    const billIndex = verify.indexOf("return billExecution({");

    expect(catchIndex).toBeGreaterThanOrEqual(0);
    expect(delegateIndex).toBeGreaterThan(catchIndex);
    expect(billIndex).toBeGreaterThan(delegateIndex);
  });
});
