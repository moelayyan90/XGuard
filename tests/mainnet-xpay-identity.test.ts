import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  PAYAI_URL,
  XPAY_URL,
} from "../apps/worker/src/mainnet-protocol.js";

describe("mainnet downstream identity", () => {
  it("canonically routes to xpay without changing the legacy source alias", () => {
    expect(XPAY_URL).toBe("https://facilitator.xpay.sh");
    expect(PAYAI_URL).toBe(XPAY_URL);
  });

  it("documents xpay as the live production facilitator", async () => {
    const source = await readFile("docs/FACILITATORS.md", "utf8");

    expect(source).toContain("https://facilitator.xpay.sh");
    expect(source).toContain("xpay");
    expect(source).not.toContain("https://facilitator.payai.network");
  });
});
