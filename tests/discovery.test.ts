import { describe, expect, it } from "vitest";
import { discoveryResponse } from "../apps/worker/src/discovery.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("mainnet discovery", () => {
  it.each([
    ["/.well-known/agent-card.json", "application/json"],
    ["/.well-known/agent.json", "application/json"],
    ["/.well-known/agent-market.json", "application/json"],
    ["/openapi.json", "application/json"],
    ["/llms.txt", "text/plain"],
    ["/llms-full.txt", "text/plain"],
    ["/robots.txt", "text/plain"],
  ])("serves %s", async (path, contentType) => {
    const response = discoveryResponse(new Request(`${ORIGIN}${path}`));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain(contentType);
    expect((await response?.text())?.length ?? 0).toBeGreaterThan(0);
  });

  it("publishes an agent card with x402 capabilities", async () => {
    const response = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`),
    );
    const card = (await response?.json()) as {
      name: string;
      supportedInterfaces: Array<{
        protocolBinding: string;
        protocolVersion: string;
      }>;
      skills: Array<{ id: string }>;
    };

    expect(card.name).toBe("XGuard");
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe("2");
    expect(card.supportedInterfaces[0]?.protocolBinding).toContain("x402");
    expect(card.skills.map((skill) => skill.id)).toContain(
      "x402-payment-settlement",
    );
  });

  it("supports conditional agent-card requests", () => {
    const first = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`),
    );
    const etag = first?.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = discoveryResponse(
      new Request(`${ORIGIN}/.well-known/agent-card.json`, {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(cached?.status).toBe(304);
  });

  it("serves HEAD without a body", async () => {
    const response = discoveryResponse(
      new Request(`${ORIGIN}/openapi.json`, { method: "HEAD" }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("");
  });

  it("does not intercept unrelated or mutating requests", () => {
    expect(discoveryResponse(new Request(`${ORIGIN}/status`))).toBeNull();
    expect(
      discoveryResponse(
        new Request(`${ORIGIN}/.well-known/agent-card.json`, {
          method: "POST",
        }),
      ),
    ).toBeNull();
  });
});
