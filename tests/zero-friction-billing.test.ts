import { describe, expect, it } from "vitest";
import { calculateZeroFrictionFeeMicroUsd } from "../apps/worker/src/zero-friction-billing.js";

describe("zero-friction capped revenue share", () => {
  it("charges 0.5% below the cap", () => {
    expect(calculateZeroFrictionFeeMicroUsd(100_000, 50, 1_000)).toBe(500);
    expect(calculateZeroFrictionFeeMicroUsd(10_000, 50, 1_000)).toBe(50);
  });

  it("caps the service share at $0.001", () => {
    expect(calculateZeroFrictionFeeMicroUsd(1_000_000, 50, 1_000)).toBe(1_000);
    expect(calculateZeroFrictionFeeMicroUsd(100_000_000, 50, 1_000)).toBe(
      1_000,
    );
  });

  it("allows sub-micro fees to floor to zero instead of overcharging tiny payments", () => {
    expect(calculateZeroFrictionFeeMicroUsd(100, 50, 1_000)).toBe(0);
  });

  it("rejects invalid pricing inputs", () => {
    expect(() => calculateZeroFrictionFeeMicroUsd(-1, 50, 1_000)).toThrow();
    expect(() => calculateZeroFrictionFeeMicroUsd(1_000, -1, 1_000)).toThrow();
    expect(() =>
      calculateZeroFrictionFeeMicroUsd(1_000, 10_001, 1_000),
    ).toThrow();
    expect(() => calculateZeroFrictionFeeMicroUsd(1_000, 50, -1)).toThrow();
  });
});
