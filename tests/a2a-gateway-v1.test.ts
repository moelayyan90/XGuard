import { describe, expect, it } from "vitest";
import { a2aGatewayV1Response } from "../apps/worker/src/a2a-gateway-v1.js";

describe("A2A v1 gateway", () => {
  it("publishes a 1.0 JSON-RPC interface with 0.3 compatibility", async () => {
    const response = await a2aGatewayV1Response(
      new Request("https://xguardgate.com/.well-known/agent-card.json"),
      {},
      async () => new Response(null, { status: 500 }),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      supportedInterfaces?: Array<{
        protocolBinding?: string;
        protocolVersion?: string;
      }>;
      skills?: Array<{ id?: string }>;
    };
    expect(body.supportedInterfaces).toContainEqual(
      expect.objectContaining({
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      }),
    );
    expect(body.skills?.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["payments", "x402", "operations"]),
    );
  });

  it("returns the canonical payment manifest as an A2A action", async () => {
    const request = new Request("https://xguardgate.com/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: {
          message: {
            parts: [{ data: { action: "payment-manifest" } }],
          },
        },
      }),
    });
    const response = await a2aGatewayV1Response(
      request,
      {},
      async () => new Response(null, { status: 500 }),
    );
    const body = (await response?.json()) as {
      result?: { parts?: Array<{ data?: Record<string, unknown> }> };
    };
    const action = body.result?.parts?.[0]?.data as {
      result?: { pricing?: { amountUsd?: string } };
    };
    expect(action.result?.pricing?.amountUsd).toBe("0.04");
  });
});
