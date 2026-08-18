import { describe, expect, it } from "vitest";
import {
  embedXGuardAutomatedPayments,
  type X402BeforePaymentCreationHook,
  type X402PaymentCreationContextLike,
} from "../packages/sdk/src/auto-pay.js";

class FakeX402Client {
  hook: X402BeforePaymentCreationHook | null = null;

  onBeforePaymentCreation(hook: X402BeforePaymentCreationHook): this {
    this.hook = hook;
    return this;
  }

  async attempt(
    overrides: Partial<
      X402PaymentCreationContextLike["selectedRequirements"]
    > = {},
    resourceUrl = "https://merchant.example/paid-api",
  ) {
    if (!this.hook) throw new Error("hook not installed");
    return this.hook({
      paymentRequired: {
        x402Version: 2,
        resource: {
          url: resourceUrl,
          serviceName: "Merchant API",
        },
      },
      selectedRequirements: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "250000",
        payTo: "0x1111111111111111111111111111111111111111",
        ...overrides,
      },
    });
  }
}

const standardBudget = {
  network: "eip155:8453",
  asset: "USDC",
  maxAtomicAmountPerPayment: "1000000",
  maxAtomicAmountPerWindow: "1500000",
};

describe("XGuard headless automated payment guard", () => {
  it("requires explicit auto mode and a spend budget by default", () => {
    const client = new FakeX402Client();
    expect(() =>
      embedXGuardAutomatedPayments(client, {
        mode: "auto",
      }),
    ).toThrow(/require a budget/i);
  });

  it("allows a budgeted x402 payment before signing and records the attempt", async () => {
    const client = new FakeX402Client();
    const decisions: boolean[] = [];
    const guard = embedXGuardAutomatedPayments(client, {
      mode: "auto",
      budgets: [standardBudget],
      onDecision: ({ allow }) => decisions.push(allow),
    });

    await expect(client.attempt()).resolves.toBeUndefined();
    expect(decisions).toEqual([true]);
    expect(guard.getAttemptSpend()).toEqual({
      "eip155:8453|USDC": "250000",
    });
  });

  it("blocks a single automatic payment above the configured cap", async () => {
    const client = new FakeX402Client();
    embedXGuardAutomatedPayments(client, {
      mode: "auto",
      budgets: [standardBudget],
    });

    await expect(client.attempt({ amount: "1000001" })).resolves.toEqual({
      abort: true,
      reason: "Payment exceeds XGuard per-payment budget",
    });
  });

  it("blocks when authorized attempts would exceed the rolling window", async () => {
    const client = new FakeX402Client();
    embedXGuardAutomatedPayments(client, {
      mode: "auto",
      budgets: [standardBudget],
    });

    await expect(client.attempt({ amount: "800000" })).resolves.toBeUndefined();
    await expect(client.attempt({ amount: "800000" })).resolves.toEqual({
      abort: true,
      reason: "Payment exceeds XGuard rolling-window budget",
    });
  });

  it("fails closed for unapproved networks, payees, and insecure resources", async () => {
    const client = new FakeX402Client();
    embedXGuardAutomatedPayments(client, {
      mode: "auto",
      allowedNetworks: ["eip155:*"],
      allowedSchemes: ["exact"],
      allowedPayees: ["0x1111111111111111111111111111111111111111"],
      budgets: [standardBudget],
    });

    await expect(
      client.attempt({ network: "solana:mainnet" }),
    ).resolves.toEqual({
      abort: true,
      reason: "Network not allowed: solana:mainnet",
    });
    await expect(
      client.attempt({ payTo: "0x2222222222222222222222222222222222222222" }),
    ).resolves.toEqual({ abort: true, reason: "Payee is not allowlisted" });
    await expect(
      client.attempt({}, "http://merchant.example/paid-api"),
    ).resolves.toEqual({
      abort: true,
      reason: "XGuard requires an HTTPS x402 resource",
    });
  });

  it("supports an XGuard policy callback and blocks when it denies or fails", async () => {
    const denied = new FakeX402Client();
    embedXGuardAutomatedPayments(denied, {
      mode: "auto",
      budgets: [standardBudget],
      authorize: async (intent) => ({
        allow: false,
        reason: `Policy denied ${intent.payTo}`,
      }),
    });
    await expect(denied.attempt()).resolves.toEqual({
      abort: true,
      reason: "Policy denied 0x1111111111111111111111111111111111111111",
    });

    const unavailable = new FakeX402Client();
    embedXGuardAutomatedPayments(unavailable, {
      mode: "auto",
      budgets: [standardBudget],
      authorize: async () => {
        throw new Error("policy service unavailable");
      },
    });
    await expect(unavailable.attempt()).resolves.toEqual({
      abort: true,
      reason: "XGuard authorization failed: policy service unavailable",
    });
  });

  it("does not require or expose signing secrets", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../packages/sdk/src/auto-pay.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(source).not.toMatch(
      /privateKey|seed phrase|mnemonic|signTransaction/i,
    );
    expect(source).toContain("onBeforePaymentCreation");
    expect(source).toContain('mode: "auto"');
  });
});
