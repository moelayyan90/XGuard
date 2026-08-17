import { describe, expect, it } from "vitest";
import { writeEndpointDiscoveryResponse } from "../apps/worker/src/mainnet-endpoint-discovery.js";

const BASE = "https://xguardgate.com";
const PAYMENT_KEY = "a".repeat(64);

function request(path: string, method: string) {
  return new Request(new URL(path, BASE), { method });
}

describe("mainnet write endpoint discovery", () => {
  it("leaves the real POST registration flow untouched", () => {
    expect(
      writeEndpointDiscoveryResponse(request("/v1/register", "POST")),
    ).toBe(null);
  });

  it("makes GET /v1/register discoverable without registering a merchant", async () => {
    const response = writeEndpointDiscoveryResponse(
      request("/v1/register", "GET"),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-xguard-discovery")).toBe(
      "endpoint-introspection",
    );
    expect(response?.headers.get("allow")).toContain("POST");
    expect(await response?.json()).toMatchObject({
      service: "XGuard",
      endpoint: "/v1/register",
      method: "POST",
      auth: "none",
      body: { name: "string" },
    });
  });

  it("supports HEAD and OPTIONS probes without creating side effects", async () => {
    const head = writeEndpointDiscoveryResponse(
      request("/v1/register", "HEAD"),
    );
    const options = writeEndpointDiscoveryResponse(
      request("/v1/register", "OPTIONS"),
    );

    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
    expect(options?.status).toBe(204);
    expect(options?.headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
  });

  it("returns 405 instead of a misleading 404 for unsupported methods", async () => {
    const response = writeEndpointDiscoveryResponse(
      request("/v1/register", "PUT"),
    );

    expect(response?.status).toBe(405);
    expect(await response?.json()).toMatchObject({
      error: "method_not_allowed",
      endpoint: "/v1/register",
    });
  });

  it("normalizes a trailing slash for crawler compatibility", async () => {
    const response = writeEndpointDiscoveryResponse(
      request("/v1/register/", "GET"),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ endpoint: "/v1/register" });
  });

  it("documents other write-only mainnet routes consistently", async () => {
    const verify = writeEndpointDiscoveryResponse(request("/verify", "GET"));
    const topup = writeEndpointDiscoveryResponse(
      request("/v1/topups/intents", "GET"),
    );

    expect(await verify?.json()).toMatchObject({
      endpoint: "/verify",
      method: "POST",
      auth: "api-key",
    });
    expect(await topup?.json()).toMatchObject({
      endpoint: "/v1/topups/intents",
      method: "POST",
      auth: "api-key",
    });
  });

  it("advertises settlement truth without intercepting its real GET", async () => {
    const path = `/v1/settlements/${PAYMENT_KEY}/truth`;
    expect(writeEndpointDiscoveryResponse(request(path, "GET"))).toBe(null);

    const options = writeEndpointDiscoveryResponse(request(path, "OPTIONS"));
    expect(options?.status).toBe(204);
    expect(options?.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("makes the active settlement resolver discoverable", async () => {
    const path = `/v1/settlements/${PAYMENT_KEY}/resolve`;
    expect(writeEndpointDiscoveryResponse(request(path, "POST"))).toBe(null);

    const discovery = writeEndpointDiscoveryResponse(request(path, "GET"));
    expect(await discovery?.json()).toMatchObject({
      endpoint: path,
      method: "POST",
      auth: "api-key",
    });
  });

  it("does not intercept unrelated routes", () => {
    expect(writeEndpointDiscoveryResponse(request("/status", "GET"))).toBe(
      null,
    );
  });
});
