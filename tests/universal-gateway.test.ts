import { describe, expect, it } from "vitest";
import {
  isBillableGatewayStatus,
  universalGatewayResponse,
} from "../apps/worker/src/universal-gateway.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";
const env = {
  DB: {} as D1Database,
  XGUARD_MODEL_FEE_MICRO_USD: "10",
  XGUARD_TOOL_FEE_MICRO_USD: "10",
  XGUARD_SOURCE_FEE_MICRO_USD: "25",
  XGUARD_ANALYSIS_FEE_MICRO_USD: "50",
  XGUARD_SECURITY_FEE_MICRO_USD: "5",
};

const delegate = async () => new Response("delegate-not-used", { status: 500 });

describe("XGuard universal gateway", () => {
  it("advertises payment, model, tool, source, analysis, and security gateways", async () => {
    const response = await universalGatewayResponse(
      new Request(`${ORIGIN}/v1/gateway/capabilities`),
      env,
      delegate,
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      name: string;
      billing: Record<string, number | string>;
      gateways: string[];
      providers: Array<{ id: string; kind: string; byok: boolean }>;
      endpoints: Record<string, unknown>;
    };

    expect(body.name).toBe("XGuard Universal Gateway");
    expect(body.gateways).toEqual(
      expect.arrayContaining([
        "payment",
        "model",
        "tool",
        "source",
        "analysis",
        "security",
      ]),
    );
    expect(body.billing).toMatchObject({
      modelMicroUsd: 10,
      toolMicroUsd: 10,
      sourceMicroUsd: 25,
      analysisMicroUsd: 50,
      securityMicroUsd: 5,
      chargingModel: "prepaid-per-successful-gateway-event",
    });
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openai", kind: "model", byok: true }),
        expect.objectContaining({ id: "anthropic", kind: "model", byok: true }),
        expect.objectContaining({ id: "gemini", kind: "model", byok: true }),
        expect.objectContaining({ id: "github", kind: "tool", byok: true }),
        expect.objectContaining({ id: "slack", kind: "tool", byok: true }),
      ]),
    );
  });

  it("quotes each gateway event class without requiring a merchant credential", async () => {
    for (const [kind, expected] of [
      ["MODEL", 10],
      ["TOOL", 10],
      ["SOURCE", 25],
      ["ANALYSIS", 50],
      ["SECURITY", 5],
    ] as const) {
      const response = await universalGatewayResponse(
        new Request(`${ORIGIN}/v1/gateway/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        }),
        env,
        delegate,
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ kind, feeMicroUsd: expected });
    }
  });

  it("rejects invalid quote kinds", async () => {
    const response = await universalGatewayResponse(
      new Request(`${ORIGIN}/v1/gateway/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "UNKNOWN" }),
      }),
      env,
      delegate,
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: "invalid_gateway_kind" });
  });

  it("requires a merchant credential before billable gateway execution", async () => {
    const response = await universalGatewayResponse(
      new Request(`${ORIGIN}/v1/gateway/security/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl: "https://example.com" }),
      }),
      env,
      delegate,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "unauthorized" });
  });

  it("treats only 2xx provider responses as billable success", () => {
    for (const status of [200, 201, 204, 206, 299])
      expect(isBillableGatewayStatus(status)).toBe(true);

    for (const status of [199, 300, 301, 302, 307, 308, 399, 400, 429, 500])
      expect(isBillableGatewayStatus(status)).toBe(false);
  });

  it("does not intercept non-gateway routes", async () => {
    expect(
      await universalGatewayResponse(
        new Request(`${ORIGIN}/status`),
        env,
        delegate,
      ),
    ).toBeNull();
  });
});
