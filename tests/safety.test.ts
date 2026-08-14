import { describe, expect, it } from "vitest";
import { x402ExactPermit2ProxyAddress } from "@x402/evm";
import { derivePaymentIdentities } from "@xguard/core";
import { ASSET, fixturePayment, PAYER, PAY_TO } from "./fixtures.js";

describe("scheme-specific safety identities", () => {
  it("derives a permanent replay key independent of Payment Identifier", () => {
    const first = fixturePayment({
      paymentId: "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const second = fixturePayment({
      paymentId: "pay_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const a = derivePaymentIdentities(first.payload, first.requirements);
    const b = derivePaymentIdentities(second.payload, second.requirements);
    expect(a.logicalPaymentKey).toBe(b.logicalPaymentKey);
    expect(a.requestFingerprint).toBe(b.requestFingerprint);
    expect(a.paymentIdentifier).not.toBe(b.paymentIdentifier);
  });

  it("binds authorization to amount and recipient", () => {
    const payment = fixturePayment();
    payment.requirements.amount = "999";
    expect(() =>
      derivePaymentIdentities(payment.payload, payment.requirements),
    ).toThrow(/does not match/);

    const recipient = fixturePayment();
    recipient.payload.accepted.payTo = PAY_TO;
    (recipient.payload.payload.authorization as Record<string, unknown>).to =
      "0x5555555555555555555555555555555555555555";
    expect(() =>
      derivePaymentIdentities(recipient.payload, recipient.requirements),
    ).toThrow(/recipient/);
  });

  it("rejects expired and malformed Payment Identifiers", () => {
    const expired = fixturePayment();
    (
      expired.payload.payload.authorization as Record<string, unknown>
    ).validBefore = "1";
    expect(() =>
      derivePaymentIdentities(expired.payload, expired.requirements),
    ).toThrow(/expired/);

    const invalid = fixturePayment({ paymentId: "short" });
    expect(() =>
      derivePaymentIdentities(invalid.payload, invalid.requirements),
    ).toThrow(/Invalid payment identifier/);
  });

  it("derives and validates exact Permit2 authorization identity", () => {
    const payment = fixturePayment();
    const deadline = (
      BigInt(Math.floor(Date.now() / 1_000)) + 3_600n
    ).toString();
    payment.requirements.extra = {
      assetTransferMethod: "permit2",
      paymentFlow: "authorization",
    };
    payment.payload.accepted.extra = structuredClone(
      payment.requirements.extra,
    );
    payment.payload.payload = {
      signature: `0x${"ab".repeat(65)}`,
      permit2Authorization: {
        from: PAYER,
        permitted: { token: ASSET, amount: payment.requirements.amount },
        spender: x402ExactPermit2ProxyAddress,
        nonce: "123456",
        deadline,
        witness: { to: PAY_TO, validAfter: "0" },
      },
    };
    const identity = derivePaymentIdentities(
      payment.payload,
      payment.requirements,
    );
    expect(identity.portability).toBe("PORTABLE");
    expect(identity.expiresAtSeconds).toBe(BigInt(deadline));

    const altered = structuredClone(payment);
    (
      altered.payload.payload.permit2Authorization as Record<string, unknown>
    ).spender = "not-an-address";
    expect(() =>
      derivePaymentIdentities(altered.payload, altered.requirements),
    ).toThrow(/spender/);
  });

  it("rejects unsupported schemes, networks, future windows, and zero amounts", () => {
    const scheme = fixturePayment();
    scheme.requirements.scheme = "upto";
    scheme.payload.accepted.scheme = "upto";
    expect(() =>
      derivePaymentIdentities(scheme.payload, scheme.requirements),
    ).toThrow(/exact scheme/);

    const network = fixturePayment({ network: "solana:testnet" });
    expect(() =>
      derivePaymentIdentities(network.payload, network.requirements),
    ).toThrow(/exact EVM/);

    const future = fixturePayment();
    (
      future.payload.payload.authorization as Record<string, unknown>
    ).validAfter = (BigInt(Math.floor(Date.now() / 1_000)) + 3_600n).toString();
    expect(() =>
      derivePaymentIdentities(future.payload, future.requirements),
    ).toThrow(/not valid yet/);

    const zero = fixturePayment({ amount: "0" });
    expect(() =>
      derivePaymentIdentities(zero.payload, zero.requirements),
    ).toThrow(/positive uint256/);

    const oversized = fixturePayment({
      amount: (1n << 256n).toString(),
    });
    expect(() =>
      derivePaymentIdentities(oversized.payload, oversized.requirements),
    ).toThrow(/positive uint256/);

    const malformedNetwork = fixturePayment({
      network: "eip155:base" as `${string}:${string}`,
    });
    expect(() =>
      derivePaymentIdentities(
        malformedNetwork.payload,
        malformedNetwork.requirements,
      ),
    ).toThrow(/exact EVM/);
  });
});
