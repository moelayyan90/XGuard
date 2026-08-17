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
    const authorize = verify.indexOf(
      'authorizeMerchantScope(request, env, "verify")',
    );
    const normalize = verify.indexOf(
      "normalizeX402CompatibilityRequest(request)",
    );

    expect(authorize).toBeGreaterThanOrEqual(0);
    expect(normalize).toBeGreaterThan(authorize);
  });

  it("returns authentication failures before parsing legacy compatibility", () => {
    const verify = billVerifySource();
    const authorize = verify.indexOf("authorizeMerchantScope(");
    const authFailure = verify.indexOf("if (!access.ok) return access.response;");
    const normalize = verify.indexOf(
      "normalizeX402CompatibilityRequest(request)",
    );

    expect(authFailure).toBeGreaterThan(authorize);
    expect(normalize).toBeGreaterThan(authFailure);
    expect(verify).not.toContain(
      "adaptCompatibilityResponse(access.response, compatibility)",
    );
  });

  it("preserves compatibility adaptation for authenticated execution responses", () => {
    const verify = billVerifySource();

    expect(verify).toContain("await delegateFetch(effectiveRequest, env, ctx)");
    expect(verify).toContain("adaptCompatibilityResponse(");
    expect(verify).toContain("compatibility,");
  });

  it("delegates invalid authenticated legacy traffic without reserving a fee", () => {
    const verify = billVerifySource();
    const normalize = verify.indexOf(
      "normalizeX402CompatibilityRequest(request)",
    );
    const catchIndex = verify.indexOf("catch {", normalize);
    const delegateIndex = verify.indexOf(
      "return delegateFetch(request, env, ctx);",
      catchIndex,
    );
    const billIndex = verify.indexOf("return billExecution({");

    expect(catchIndex).toBeGreaterThan(normalize);
    expect(delegateIndex).toBeGreaterThan(catchIndex);
    expect(billIndex).toBeGreaterThan(delegateIndex);
  });
});
