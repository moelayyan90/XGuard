import { describe, expect, it } from "vitest";
import { a2aAgentResponse } from "../apps/worker/src/a2a-agent.js";
import { enhanceA2AAgentCard } from "../apps/worker/src/a2a-discovery.js";
import { discoveryResponse } from "../apps/worker/src/discovery.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("XGuard A2A compatibility", () => {
  it("publishes a v0.3-compatible Agent Card pointing to the live A2A endpoint", async () => {
    const request = new Request(`${ORIGIN}/.well-known/agent-card.json`);
    const base = discoveryResponse(request);
    expect(base).not.toBeNull();

    const response = await enhanceA2AAgentCard(request, base!);
    const card = (await response.json()) as {
      protocolVersion: string;
      url: string;
      preferredTransport: string;
      additionalInterfaces: Array<{ url: string; transport: string }>;
      supportedInterfaces: Array<{
        url: string;
        protocolBinding: string;
        protocolVersion: string;
      }>;
      capabilities: { streaming: boolean; pushNotifications: boolean };
      defaultInputModes: string[];
      defaultOutputModes: string[];
    };

    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.url).toBe(`${ORIGIN}/a2a`);
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.additionalInterfaces).toContainEqual({
      url: `${ORIGIN}/a2a`,
      transport: "JSONRPC",
    });
    expect(card.supportedInterfaces[0]).toEqual({
      url: `${ORIGIN}/a2a`,
      protocolBinding: "JSONRPC",
      protocolVersion: "0.3",
    });
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.defaultInputModes).toContain("text/plain");
    expect(card.defaultOutputModes).toContain("text/plain");
  });

  it("responds to crawler reachability probes on GET and HEAD /a2a", async () => {
    const getResponse = await a2aAgentResponse(new Request(`${ORIGIN}/a2a`));
    expect(getResponse?.status).toBe(200);
    expect(getResponse?.headers.get("cache-control")).toBe("public, max-age=300");
    const descriptor = (await getResponse?.json()) as {
      status: string;
      protocol: string;
      protocolVersion: string;
      transport: string;
      endpoint: string;
      agentCard: string;
      methods: string[];
    };
    expect(descriptor).toMatchObject({
      status: "ok",
      protocol: "A2A",
      protocolVersion: "0.3.0",
      transport: "JSONRPC",
      endpoint: `${ORIGIN}/a2a`,
      agentCard: `${ORIGIN}/.well-known/agent-card.json`,
    });
    expect(descriptor.methods).toContain("message/send");

    const headResponse = await a2aAgentResponse(
      new Request(`${ORIGIN}/a2a`, { method: "HEAD" }),
    );
    expect(headResponse?.status).toBe(200);
    expect(await headResponse?.text()).toBe("");
  });

  it("responds to A2A message/send JSON-RPC", async () => {
    const response = await a2aAgentResponse(
      new Request(`${ORIGIN}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-1",
          method: "message/send",
          params: {
            message: {
              kind: "message",
              messageId: "msg-1",
              role: "user",
              parts: [
                { kind: "text", text: "What capabilities are supported?" },
              ],
            },
          },
        }),
      }),
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      jsonrpc: string;
      id: string;
      result: {
        kind: string;
        role: string;
        messageId: string;
        contextId: string;
        parts: Array<{ kind: string; text: string }>;
      };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("req-1");
    expect(body.result.kind).toBe("message");
    expect(body.result.role).toBe("agent");
    expect(body.result.parts[0]?.text).toContain("x402 v2");
    expect(body.result.parts[0]?.text).toContain(`${ORIGIN}/supported`);
  });

  it("returns JSON-RPC errors for invalid or unsupported requests", async () => {
    const invalid = await a2aAgentResponse(
      new Request(`${ORIGIN}/a2a`, {
        method: "POST",
        body: "not-json",
      }),
    );
    expect((await invalid?.json()) as unknown).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32700 },
    });

    const unsupported = await a2aAgentResponse(
      new Request(`${ORIGIN}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tasks/get",
          params: {},
        }),
      }),
    );
    expect((await unsupported?.json()) as unknown).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601 },
    });
  });

  it("returns 405 for unsupported HTTP methods on /a2a", async () => {
    const response = await a2aAgentResponse(
      new Request(`${ORIGIN}/a2a`, { method: "PUT" }),
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET, HEAD, POST");
  });

  it("does not intercept unrelated paths", async () => {
    expect(await a2aAgentResponse(new Request(`${ORIGIN}/status`))).toBeNull();
  });
});
