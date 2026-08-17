import { describe, expect, it, vi } from "vitest";
import {
  protocolAdapterManifests,
  universalProtocolResponse,
} from "../apps/worker/src/universal-protocol-router.js";

const ORIGIN = "https://xguardgate.com";

function delegates() {
  return {
    verifyX402: vi.fn(
      async () =>
        new Response(JSON.stringify({ isValid: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
    settleX402: vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, transaction: "0xabc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  };
}

describe("XGuard universal protocol router", () => {
  it("advertises protocol adapters without presenting every protocol as a settlement rail", async () => {
    const d = delegates();
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/.well-known/xguard/protocols.json`),
      d,
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      protocolAgnostic: boolean;
      adapters: Array<{ id: string; settlement: string }>;
    };
    expect(body.protocolAgnostic).toBe(true);
    expect(body.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "x402", settlement: "native" }),
        expect.objectContaining({ id: "ap2", settlement: "bridge" }),
        expect.objectContaining({ id: "acp", settlement: "bridge" }),
        expect.objectContaining({
          id: "visa-trusted-agent",
          settlement: "not-a-settlement-rail",
        }),
        expect.objectContaining({ id: "mcp", settlement: "bridge" }),
        expect.objectContaining({ id: "a2a", settlement: "bridge" }),
        expect.objectContaining({ id: "http", settlement: "bridge" }),
      ]),
    );
  });

  it("keeps the registry extensible across payment, commerce, trust, agent, and generic transports", () => {
    const ids = protocolAdapterManifests().map((adapter) => adapter.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "x402",
        "ap2",
        "acp",
        "visa-trusted-agent",
        "mcp",
        "a2a",
        "http",
        "openapi",
        "graphql",
        "json-rpc",
        "webhook",
      ]),
    );
  });

  it("routes unified x402 verification to the existing monetized native adapter", async () => {
    const d = delegates();
    const body = {
      x402Version: 2,
      paymentPayload: { example: true },
      paymentRequirements: { example: true },
    };
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/v1/transactions/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      d,
    );

    expect(response?.status).toBe(200);
    expect(d.verifyX402).toHaveBeenCalledTimes(1);
    const delegated = d.verifyX402.mock.calls[0]?.[0] as Request;
    expect(new URL(delegated.url).pathname).toBe("/verify");
    expect(await delegated.json()).toEqual(body);
    expect(response?.headers.get("X-XGuard-Source-Protocol")).toBe("x402");
    expect(response?.headers.get("X-XGuard-Settlement-Adapter")).toBe("native");
  });

  it("accepts an AP2 envelope structurally without pretending to cryptographically verify it", async () => {
    const d = delegates();
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/v1/transactions/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "ap2",
          payload: { mandate: { id: "mandate-1" } },
        }),
      }),
      d,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      protocol: "ap2",
      accepted: true,
      validation: "structural",
      cryptographicVerification: "not-claimed",
      settlement: "bridge",
    });
    expect(d.verifyX402).not.toHaveBeenCalled();
  });

  it("requires Visa Trusted Agent signature metadata instead of claiming trust from JSON alone", async () => {
    const d = delegates();
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/v1/transactions/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "visa-tap",
          payload: { intent: "checkout" },
        }),
      }),
      d,
    );

    expect(response?.status).toBe(422);
    expect(await response?.json()).toMatchObject({
      protocol: "visa-trusted-agent",
      accepted: false,
      error: "visa_trusted_agent_signature_headers_required",
    });
  });

  it("bridges a non-settlement protocol to x402 only when the settlement envelope is explicit", async () => {
    const d = delegates();
    const settlementPayload = {
      x402Version: 2,
      paymentPayload: { example: true },
      paymentRequirements: { example: true },
    };
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/v1/transactions/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "acp",
          payload: { checkout_session_id: "checkout_1" },
          settlement: { protocol: "x402", payload: settlementPayload },
        }),
      }),
      d,
    );

    expect(response?.status).toBe(200);
    expect(d.settleX402).toHaveBeenCalledTimes(1);
    const delegated = d.settleX402.mock.calls[0]?.[0] as Request;
    expect(new URL(delegated.url).pathname).toBe("/settle");
    expect(await delegated.json()).toEqual(settlementPayload);
    expect(response?.headers.get("X-XGuard-Source-Protocol")).toBe("acp");
    expect(response?.headers.get("X-XGuard-Settlement-Adapter")).toBe("x402");
  });

  it("rejects implicit settlement for a protocol that is not itself a settlement rail", async () => {
    const d = delegates();
    const response = await universalProtocolResponse(
      new Request(`${ORIGIN}/v1/transactions/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "mcp",
          payload: { jsonrpc: "2.0", method: "tools/call" },
        }),
      }),
      d,
    );

    expect(response?.status).toBe(422);
    expect(await response?.json()).toMatchObject({
      error: "settlement_bridge_required",
      protocol: "mcp",
      supportedSettlementBridges: ["x402"],
    });
    expect(d.settleX402).not.toHaveBeenCalled();
  });
});
