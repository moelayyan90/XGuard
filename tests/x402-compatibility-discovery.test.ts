import { describe, expect, it } from "vitest";
import { augmentCompatibilityDiscovery } from "../apps/worker/src/x402-compatibility-discovery.js";

describe("x402 compatibility discovery", () => {
  it("advertises V1 and V2 compatibility in facilitator discovery", async () => {
    const response = await augmentCompatibilityDiscovery(
      new Response(
        JSON.stringify({
          protocol: { name: "x402", version: 2 },
          facilitator: {
            baseUrl: "https://xguard-mainnet.maqamapp.workers.dev",
          },
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

    expect(protocol.canonicalVersion).toBe(2);
    expect(protocol.supportedVersions).toEqual([1, 2]);
    expect(bridge.accepts).toEqual([
      "x402-v1 exact@base",
      "x402-v2 exact@eip155:8453",
    ]);
    expect(bridge.canonicalizesTo).toBe("x402-v2 exact@eip155:8453");
    expect(compatibility.mode).toBe("transaction-compatibility-bridge");
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
