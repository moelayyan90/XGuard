import { describe, expect, it } from "vitest";
import {
  isGatewayRedirectStatus,
  universalGatewayResponse,
} from "../apps/worker/src/universal-gateway.js";

const ORIGIN = "https://xguardgate.com";
const env = {
  DB: {} as D1Database,
  XGUARD_MODEL_FEE_MICRO_USD: "10",
  XGUARD_TOOL_FEE_MICRO_USD: "10",
  XGUARD_SOURCE_FEE_MICRO_USD: "25",
  XGUARD_ANALYSIS_FEE_MICRO_USD: "50",
  XGUARD_SECURITY_FEE_MICRO_USD: "5",
};
const delegate = async () => new Response("delegate-not-used", { status: 500 });

describe("universal gateway production hardening", () => {
  it("classifies provider redirects separately from billable success", () => {
    for (const status of [300, 301, 302, 303, 307, 308, 399])
      expect(isGatewayRedirectStatus(status)).toBe(true);

    for (const status of [200, 204, 299, 400, 500])
      expect(isGatewayRedirectStatus(status)).toBe(false);
  });

  it("rejects oversized JSON even when Content-Length is absent", async () => {
    const body = JSON.stringify({
      kind: "MODEL",
      padding: "x".repeat(70 * 1024),
    });
    const request = new Request(`${ORIGIN}/v1/gateway/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await universalGatewayResponse(request, env, delegate);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: "request_body_too_large" });
  });
});
