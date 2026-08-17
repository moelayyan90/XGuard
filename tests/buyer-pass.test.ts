import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isBuyerPassToken,
  parseBuyerTopUpAmountUsd,
} from "../apps/worker/src/buyer-pass.js";

describe("Buyer Pass", () => {
  it("accepts only the dedicated buyer-pass credential shape", () => {
    expect(isBuyerPassToken(`xg_pass_${"a".repeat(43)}`)).toBe(true);
    expect(isBuyerPassToken(`xg_live_${"a".repeat(43)}`)).toBe(false);
    expect(isBuyerPassToken("xg_pass_short")).toBe(false);
  });

  it("parses top-up USD amounts without floating-point rounding", () => {
    expect(parseBuyerTopUpAmountUsd("0.01")).toBe(10_000);
    expect(parseBuyerTopUpAmountUsd("1.000001")).toBe(1_000_001);
    expect(parseBuyerTopUpAmountUsd("25")).toBe(25_000_000);
  });

  it("rejects sub-cent, over-precision, and scientific notation top-ups", () => {
    expect(() => parseBuyerTopUpAmountUsd("0.001")).toThrow(
      "invalid_amountUsd",
    );
    expect(() => parseBuyerTopUpAmountUsd("1.0000001")).toThrow(
      "invalid_amountUsd",
    );
    expect(() => parseBuyerTopUpAmountUsd("1e2")).toThrow("invalid_amountUsd");
  });

  it("removes the merchant API-key setup from the browser flow", async () => {
    const worker = await readFile(
      "browser-extension/service-worker.js",
      "utf8",
    );
    const options = await readFile("browser-extension/options.js", "utf8");
    expect(worker).toContain("/v1/buyer-pass");
    expect(worker).toContain("xguardBuyerPass");
    expect(worker).not.toContain("xguardAccessKey");
    expect(options).toContain("/v1/buyer-pass/topups/intents");
    expect(options).not.toContain("xguardAccessKey");
  });
});
