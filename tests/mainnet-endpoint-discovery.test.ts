import { describe, expect, it } from "vitest";
import {
  writeEndpointDiscoveryResponse,
} from "../apps/worker/src/mainnet-endpoint-discovery.js";

const BASE = "https://xguard-mainnet.maqamapp.workers.dev";

function request(path: string, method: string) {
  return new Request(new URL(path, BASE), { method });
}

function discover(path: string, method: string) {
  return writeEndpointDiscoveryResponse(request(path, method));
}

function requireResponse(response: Response | null): Response {
  expect(response).not.toBeNull();
  if (response === null) throw new Error("expected discovery response");
  return response;
}

describe("mainnet write endpoint discovery", () => {
  it("passes POST registration through", () => {
    const response = discover("/v1/register", "POST");
    expect(response).toBeNull();
  });

  it("describes GET registration safely", async () => {
    const response = requireResponse(discover("/v1/register", "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-xguard-discovery")).toBe(
      "endpoint-introspection",
    );
    expect(response.headers.get("allow")).toContain("POST");
    expect(body).toMatchObject({
      service: "XGuard",
      endpoint: "/v1/register",
      method: "POST",
      auth: "none",
      body: { name: "string" },
    });
  });

  it("supports HEAD and OPTIONS probes", async () => {
    const head = requireResponse(discover("/v1/register", "HEAD"));
    const options = requireResponse(discover("/v1/register", "OPTIONS"));

    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = requireResponse(discover("/v1/register", "PUT"));
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(body).toMatchObject({
      error: "method_not_allowed",
      endpoint: "/v1/register",
    });
  });

  it("normalizes a trailing slash", async () => {
    const response = requireResponse(discover("/v1/register/", "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ endpoint: "/v1/register" });
  });

  it("documents protected write routes", async () => {
    const verify = requireResponse(discover("/verify", "GET"));
    const topup = requireResponse(discover("/v1/topups/intents", "GET"));
    const verifyBody = await verify.json();
    const topupBody = await topup.json();

    expect(verifyBody).toMatchObject({
      endpoint: "/verify",
      method: "POST",
      auth: "api-key",
    });
    expect(topupBody).toMatchObject({
      endpoint: "/v1/topups/intents",
      method: "POST",
      auth: "api-key",
    });
  });

  it("ignores unrelated routes", () => {
    const response = discover("/status", "GET");
    expect(response).toBeNull();
  });
});
