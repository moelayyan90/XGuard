import { describe, expect, it } from "vitest";
import {
  assertPaymentTransition,
  calculateUnitEconomics,
  canonicalJson,
  formatMicroUsd,
  parseJsonStrict,
  parseMicroUsd,
  parseUnsignedInteger,
} from "@xguard/core";

describe("strict JSON boundary", () => {
  it("parses valid JSON and canonicalizes keys", () => {
    expect(parseJsonStrict('{"b":2,"a":[true,null,"x"]}')).toEqual({
      b: 2,
      a: [true, null, "x"],
    });
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it.each([
    '{"a":1,"a":2}',
    '{"__proto__":{}}',
    '{"constructor":1}',
    '{"x":"\\uZZZZ"}',
    "[1,]",
    "1 trailing",
  ])("rejects hostile JSON: %s", (raw) => {
    expect(() => parseJsonStrict(raw)).toThrow();
  });

  it("enforces size and depth limits", () => {
    expect(() =>
      parseJsonStrict(`{"x":"${"a".repeat(50)}"}`, { maxBytes: 20 }),
    ).toThrow(/exceeds/);
    expect(() => parseJsonStrict("[[[[[0]]]]]", { maxDepth: 2 })).toThrow(
      /nesting/,
    );
  });
});

describe("exact money", () => {
  it("uses integer micro-USD arithmetic", () => {
    expect(parseMicroUsd("0.002")).toBe(2_000n);
    expect(formatMicroUsd(2_000n)).toBe("0.002000");
    expect(parseUnsignedInteger("900719925474099312345", "amount")).toBe(
      900719925474099312345n,
    );
    expect(
      calculateUnitEconomics(2_000n, 500n, 100n).contributionMicroUsd,
    ).toBe(1_400n);
    expect(
      calculateUnitEconomics(2_000n, null, 100n).contributionMicroUsd,
    ).toBeNull();
  });

  it("rejects ambiguous monetary encodings", () => {
    expect(() => parseMicroUsd("0.0020001")).toThrow();
    expect(() => parseUnsignedInteger("01", "amount")).toThrow();
    expect(() => parseUnsignedInteger("1e3", "amount")).toThrow();
  });
});

describe("payment state machine", () => {
  it("permits only explicit transitions", () => {
    expect(() =>
      assertPaymentTransition("VERIFIED", "SETTLEMENT_IN_PROGRESS"),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition("SETTLED", "SETTLEMENT_IN_PROGRESS"),
    ).toThrow(/Invalid/);
  });
});
