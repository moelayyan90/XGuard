import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyFinalizedBaseUsdcDeposit } from "../apps/worker/src/base-usdc.js";

const TREASURY = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TX = `0x${"a".repeat(64)}`;
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("Base USDC deposit verification", () => {
  it("accepts exactly one finalized successful USDC transfer to treasury", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };
        let result: unknown;
        if (request.method === "eth_getTransactionReceipt") {
          result = {
            status: "0x1",
            blockNumber: "0xff",
            logs: [
              {
                address: USDC,
                topics: [
                  TRANSFER,
                  addressTopic(SENDER),
                  addressTopic(TREASURY),
                ],
                data: "0x4c4b40",
                logIndex: "0x2",
                removed: false,
              },
            ],
          };
        } else if (request.params[0] === "finalized") {
          result = { number: "0x100", timestamp: "0x77359400" };
        } else {
          result = { number: "0xff", timestamp: "0x77359300" };
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(
      verifyFinalizedBaseUsdcDeposit({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        treasuryAddress: TREASURY,
        usdcContractAddress: USDC,
      }),
    ).resolves.toEqual({
      transactionHash: TX,
      sender: SENDER,
      recipient: TREASURY,
      amountMicroUsd: 5_000_000,
      blockNumber: 255,
      blockTimestampSeconds: 2_000_000_768,
      logIndex: 2,
    });
  });

  it("fails closed before the transaction reaches the finalized block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { method: string };
        const result =
          request.method === "eth_getTransactionReceipt"
            ? { status: "0x1", blockNumber: "0x101", logs: [] }
            : { number: "0x100", timestamp: "0x77359400" };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
        });
      }),
    );

    await expect(
      verifyFinalizedBaseUsdcDeposit({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        treasuryAddress: TREASURY,
        usdcContractAddress: USDC,
      }),
    ).rejects.toThrow("transaction_not_finalized");
  });

  it("rejects transactions with more than one treasury transfer", async () => {
    const log = {
      address: USDC,
      topics: [TRANSFER, addressTopic(SENDER), addressTopic(TREASURY)],
      data: "0x7d0",
      removed: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };
        let result: unknown;
        if (request.method === "eth_getTransactionReceipt") {
          result = {
            status: "0x1",
            blockNumber: "0xff",
            logs: [
              { ...log, logIndex: "0x1" },
              { ...log, logIndex: "0x2" },
            ],
          };
        } else if (request.params[0] === "finalized") {
          result = { number: "0x100", timestamp: "0x77359400" };
        } else {
          result = { number: "0xff", timestamp: "0x77359300" };
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
        });
      }),
    );

    await expect(
      verifyFinalizedBaseUsdcDeposit({
        rpcUrl: "https://mainnet.base.org",
        transactionHash: TX,
        treasuryAddress: TREASURY,
        usdcContractAddress: USDC,
      }),
    ).rejects.toThrow("ambiguous_multiple_treasury_transfers");
  });
});
