import { describe, expect, it } from "vitest";
import { RoutingEngine, XGuardError } from "@xguard/core";
import { fixturePayment, MockFacilitator } from "./fixtures.js";

describe("health and economics aware routing", () => {
  it("fails verification over to the next capability-compatible facilitator", async () => {
    const broken = new MockFacilitator();
    broken.verify = async () => {
      broken.verifyCalls += 1;
      throw new Error("network down");
    };
    const healthy = new MockFacilitator();
    const router = new RoutingEngine(
      [
        {
          id: "broken",
          url: "https://broken.example",
          client: broken,
          downstreamCostMicroUsd: 0n,
        },
        {
          id: "healthy",
          url: "https://healthy.example",
          client: healthy,
          downstreamCostMicroUsd: 0n,
        },
      ],
      2_000n,
      0n,
    );
    await router.refreshCapabilities();
    const payment = fixturePayment();
    const result = await router.verify(payment.payload, payment.requirements);
    expect(result.result.isValid).toBe(true);
    expect(broken.verifyCalls + healthy.verifyCalls).toBeGreaterThanOrEqual(1);
  });

  it("excludes unknown and structurally negative settlement economics", async () => {
    const unknown = new MockFacilitator(["eip155:8453"]);
    const expensive = new MockFacilitator(["eip155:8453"]);
    const router = new RoutingEngine(
      [
        {
          id: "unknown",
          url: "https://unknown.example",
          client: unknown,
          downstreamCostMicroUsd: null,
        },
        {
          id: "expensive",
          url: "https://expensive.example",
          client: expensive,
          downstreamCostMicroUsd: 2_001n,
        },
      ],
      2_000n,
      0n,
    );
    await router.refreshCapabilities();
    const payment = fixturePayment({ network: "eip155:8453" });
    expect(() => router.selectForSettlement(payment.requirements)).toThrowError(
      XGuardError,
    );
  });

  it("accepts current mixed v1/v2 capabilities but only advertises normalized v2 exact EVM", async () => {
    const official = new MockFacilitator();
    official.getSupported = async () => ({
      kinds: [
        { x402Version: 1, scheme: "exact", network: "base-sepolia" },
        { x402Version: 2, scheme: "exact", network: "eip155:84532" },
      ],
      extensions: ["payment-identifier"],
      signers: { eip155: [] },
    });
    const router = new RoutingEngine(
      [
        {
          id: "official-shape",
          url: "https://facilitator.example",
          client: official,
          downstreamCostMicroUsd: 0n,
          exactEvmTransferMethods: ["eip3009", "permit2"],
        },
      ],
      2_000n,
    );
    await router.refreshCapabilities();
    expect(router.snapshots()[0]?.state).toBe("HEALTHY");
    expect(router.getCombinedSupported().kinds).toEqual([
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:84532",
        extra: {
          assetTransferMethod: "eip3009",
          paymentFlow: "authorization",
        },
      },
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:84532",
        extra: {
          assetTransferMethod: "permit2",
          paymentFlow: "authorization",
        },
      },
    ]);
    expect(
      router.selectForSettlement(fixturePayment().requirements, false).id,
    ).toBe("official-shape");
    expect(
      router.selectForSettlement(
        {
          ...fixturePayment().requirements,
          extra: {
            assetTransferMethod: "permit2",
            paymentFlow: "authorization",
          },
        },
        false,
      ).id,
    ).toBe("official-shape");
  });

  it("fails closed for unadvertised extensions and Permit2 capability", async () => {
    const generic = new MockFacilitator();
    generic.getSupported = async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: { eip155: [] },
    });
    const bazaar = new MockFacilitator();
    bazaar.getSupported = async () => ({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: "eip155:84532",
          extra: {
            assetTransferMethod: "eip3009",
            paymentFlow: "authorization",
          },
        },
      ],
      extensions: ["bazaar"],
      signers: { eip155: [] },
    });
    const router = new RoutingEngine(
      [
        {
          id: "generic",
          url: "https://generic.example",
          client: generic,
          downstreamCostMicroUsd: 0n,
        },
        {
          id: "bazaar",
          url: "https://bazaar.example",
          client: bazaar,
          downstreamCostMicroUsd: 0n,
        },
      ],
      2_000n,
    );
    await router.refreshCapabilities();
    const requirements = fixturePayment().requirements;
    expect(
      router.selectForSettlement(requirements, false, {
        requiredExtensions: ["bazaar"],
      }).id,
    ).toBe("bazaar");
    expect(() =>
      router.selectForSettlement(
        {
          ...requirements,
          extra: {
            assetTransferMethod: "permit2",
            paymentFlow: "authorization",
          },
        },
        false,
      ),
    ).toThrowError(XGuardError);
  });

  it("rejects private facilitator destinations before making a request", () => {
    expect(
      () =>
        new RoutingEngine(
          [
            {
              id: "private",
              url: "https://127.0.0.1",
              downstreamCostMicroUsd: 0n,
            },
          ],
          2_000n,
        ),
    ).toThrow(/non-public/);
  });
});
