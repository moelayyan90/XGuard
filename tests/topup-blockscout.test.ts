import { describe, expect, it } from "vitest";
import {
  isTransientBlockscoutFailure,
  parseBlockscoutTransferItem,
} from "../apps/worker/src/topup-blockscout.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    block_number: 123456,
    timestamp: "2033-05-18T03:33:20.000Z",
    transaction_hash: `0x${"a".repeat(64)}`,
    log_index: 7,
    from: { hash: SENDER },
    to: { hash: TREASURY },
    token: { address_hash: USDC, decimals: "6", type: "ERC-20" },
    total: { value: "5000123", decimals: "6" },
    ...overrides,
  };
}

describe("Blockscout automatic top-up parser", () => {
  it("converts an incoming Base USDC transfer into the canonical deposit", () => {
    expect(parseBlockscoutTransferItem(transfer(), TREASURY)).toEqual({
      transactionHash: `0x${"a".repeat(64)}`,
      sender: SENDER,
      recipient: TREASURY,
      amountMicroUsd: 5_000_123,
      blockNumber: 123456,
      blockTimestampSeconds: 2_000_000_000,
      logIndex: 7,
    });
  });

  it("rejects a token or recipient that is not exactly the protected Base USDC deposit", () => {
    expect(() =>
      parseBlockscoutTransferItem(
        transfer({
          token: {
            address_hash: "0x3333333333333333333333333333333333333333",
            decimals: "6",
            type: "ERC-20",
          },
        }),
        TREASURY,
      ),
    ).toThrow("blockscout_wrong_token");
    expect(() =>
      parseBlockscoutTransferItem(transfer({ to: { hash: SENDER } }), TREASURY),
    ).toThrow("blockscout_wrong_recipient");
  });

  it("falls back only for source availability failures", () => {
    expect(
      isTransientBlockscoutFailure(
        new Error("blockscout_http_429"),
        "blockscout_http_429",
      ),
    ).toBe(true);
    expect(
      isTransientBlockscoutFailure(
        new Error("blockscout_invalid_items"),
        "blockscout_invalid_items",
      ),
    ).toBe(false);
  });
});
