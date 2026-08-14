import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyFinalizedBaseUsdcSettlement } from "../apps/worker/src/base-settlement.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYER = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const TX = `0x${"a".repeat(64)}`;
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("Base settlement finality", () => {
  it("accepts a finalized exact native USDC transfer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        const result =
          body.method === "eth_getTransactionReceipt"
            ? {
                status: "0x1",
                blockNumber: "0xff",
                logs: [
                  {
                    address: USDC,
                    topics: [TRANSFER, topic(PAYER), topic(PAY_TO)],
                    data: "0x7d0",
                    logIndex: "0x3",
                    removed: false,
                  },
                ],
              }
            : { number: "0x100" };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      }),
    );

    await expect(
      verifyFinalizedBaseUsdcSettlement({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        usdcContractAddress: USDC,
        expectedPayer: PAYER,
        expectedPayTo: PAY_TO,
        expectedAmountMicroUsd: 2_000,
      }),
    ).resolves.toEqual({
      transactionHash: TX,
      blockNumber: 255,
      logIndex: 3,
    });
  });

  it("waits until the transaction is finalized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        const result =
          body.method === "eth_getTransactionReceipt"
            ? { status: "0x1", blockNumber: "0x101", logs: [] }
            : { number: "0x100" };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      }),
    );
    await expect(
      verifyFinalizedBaseUsdcSettlement({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        usdcContractAddress: USDC,
        expectedPayer: PAYER,
        expectedPayTo: PAY_TO,
        expectedAmountMicroUsd: 2_000,
      }),
    ).rejects.toThrow("transaction_not_finalized");
  });

  it("rejects a finalized transaction without the exact payer, payee and amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        const result =
          body.method === "eth_getTransactionReceipt"
            ? {
                status: "0x1",
                blockNumber: "0xff",
                logs: [
                  {
                    address: USDC,
                    topics: [TRANSFER, topic(PAYER), topic(PAY_TO)],
                    data: "0x7d1",
                    logIndex: "0x1",
                  },
                ],
              }
            : { number: "0x100" };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      }),
    );
    await expect(
      verifyFinalizedBaseUsdcSettlement({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        usdcContractAddress: USDC,
        expectedPayer: PAYER,
        expectedPayTo: PAY_TO,
        expectedAmountMicroUsd: 2_000,
      }),
    ).rejects.toThrow("expected_usdc_transfer_not_found");
  });
});
