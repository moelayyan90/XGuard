import { describe, expect, it } from "vitest";
import { publicDiscoveryPreflight } from "../apps/worker/src/universal-mainnet.js";

const ORIGIN = "https://xguardgate.com";

describe("universal mainnet discovery preflight", () => {
  it("answers OPTIONS /openapi.json without falling through", async () => {
    const response = publicDiscoveryPreflight(
      new Request(`${ORIGIN}/openapi.json`, { method: "OPTIONS" }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(204);
    expect(response?.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("access-control-allow-methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(response?.headers.get("access-control-allow-headers")).toContain(
      "Content-Type",
    );
    expect(await response?.text()).toBe("");
  });

  it("supports OPTIONS on the public discovery family", () => {
    for (const path of [
      "/.well-known/agent-card.json",
      "/.well-known/agent.json",
      "/.well-known/agent-market.json",
      "/.well-known/x402/facilitator.json",
      "/.well-known/x402.json",
      "/provider.json",
      "/openapi.json",
      "/llms.txt",
      "/llms-full.txt",
      "/robots.txt",
    ]) {
      expect(
        publicDiscoveryPreflight(
          new Request(`${ORIGIN}${path}`, { method: "OPTIONS" }),
        )?.status,
      ).toBe(204);
    }
  });

  it("does not intercept GET or unrelated OPTIONS requests", () => {
    expect(
      publicDiscoveryPreflight(new Request(`${ORIGIN}/openapi.json`)),
    ).toBeNull();
    expect(
      publicDiscoveryPreflight(
        new Request(`${ORIGIN}/status`, { method: "OPTIONS" }),
      ),
    ).toBeNull();
  });
});
