import { describe, expect, it } from "vitest";
import { augmentCompatibilityDiscovery } from "../apps/worker/src/x402-compatibility-discovery.js";

describe("x402 compatibility discovery", () => {
  it("advertises V1/V2 compatibility and settlement truth in facilitator discovery", async () => {
    const response = await augmentCompatibilityDiscovery(
      new Response(
        JSON.stringify({
          protocol: { name: "x402", version: 2 },
          facilitator: {
            baseUrl: "https://xguardgate.com",
          },
          safety: { replayProtection: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      "/.well-known/x402/facilitator.json",
    );

    const body = (await response.json()) as Record<string, unknown>;
    const protocol = body.protocol as Record<string, unknown>;
    const facilitator = body.facilitator as Record<string, unknown>;
    const bridge = facilitator.compatibilityBridge as Record<string, unknown>;
    const compatibility = body.compatibility as Record<string, unknown>;
    const safety = body.safety as Record<string, unknown>;
    const truth = body.settlementTruth as Record<string, unknown>;

    expect(protocol.canonicalVersion).toBe(2);
    expect(protocol.supportedVersions).toEqual([1, 2]);
    expect(bridge.accepts).toEqual([
      "x402-v1 exact@base",
      "x402-v2 exact@eip155:8453",
    ]);
    expect(bridge.canonicalizesTo).toBe("x402-v2 exact@eip155:8453");
    expect(compatibility.mode).toBe("transaction-compatibility-bridge");
    expect(safety.replayProtection).toBe(true);
    expect(safety.merchantFacingSettlementTruth).toBe(true);
    expect(safety.activeAmbiguityResolution).toBe(true);
    expect(safety.releaseSafeOnlyAfterIndependentFinality).toBe(true);
    expect(safety.blindResubmissionAfterAmbiguity).toBe(false);
    expect(truth.version).toBe("xguard-settlement-truth-v1");
    expect(truth.states).toEqual([
      "FINALIZED",
      "PENDING",
      "PROVEN_FAILED",
      "CONFLICT",
    ]);
    expect(truth.releaseSafeState).toBe("FINALIZED");
    expect(truth.truthEndpoint).toBe(
      "/v1/settlements/{logicalPaymentKey}/truth",
    );
    expect(truth.resolveEndpoint).toBe(
      "/v1/settlements/{logicalPaymentKey}/resolve",
    );
    expect(response.headers.get("x-xguard-compatibility")).toBe("x402-v1-v2");
  });

  it("marks the agent card as compatibility-bridge capable", async () => {
    const response = await augmentCompatibilityDiscovery(
      new Response(JSON.stringify({ capabilities: { streaming: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      "/.well-known/agent-card.json",
    );

    const body = (await response.json()) as {
      capabilities: Record<string, unknown>;
      compatibility: Record<string, unknown>;
    };
    expect(body.capabilities.x402CompatibilityBridge).toBe(true);
    expect(body.compatibility.mode).toBe("transaction-compatibility-bridge");
  });

  it("keeps the canonical agent-market protocol while advertising compatibility separately", async () => {
    const response = await augmentCompatibilityDiscovery(
      new Response(
        JSON.stringify({
          name: "XGuard",
          protocol: "x402-v2",
          network: "eip155:8453",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      "/.well-known/agent-market.json",
    );

    const body = (await response.json()) as {
      protocol: string;
      compatibility: Record<string, unknown>;
    };
    expect(body.protocol).toBe("x402-v2");
    expect(body.compatibility.mode).toBe("transaction-compatibility-bridge");
  });
});
