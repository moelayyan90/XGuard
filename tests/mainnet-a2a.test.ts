import { describe, expect, it, vi } from "vitest";
import { a2aOptions, a2aRequest } from "../apps/worker/src/mainnet-a2a.js";

const ENDPOINT = "https://xguard-mainnet.maqamapp.workers.dev/a2a";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("mainnet A2A JSON-RPC", () => {
  it("answers A2A 1.0 SendMessage with a direct agent Message", async () => {
    const resolve = vi.fn(async (kind: "status" | "supported") => ({
      kind,
      ok: true,
    }));
    const response = await a2aRequest(
      request({
        jsonrpc: "2.0",
        id: "v1-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "client-message-1",
            role: "ROLE_USER",
            parts: [{ text: "What x402 capabilities do you support?" }],
          },
        },
      }),
      resolve,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toMatchObject({ jsonrpc: "2.0", id: "v1-1" });
    expect(body.result.message.role).toBe("ROLE_AGENT");
    expect(body.result.message.contextId).toEqual(expect.any(String));
    expect(body.result.message.messageId).toEqual(expect.any(String));
    expect(body.result.message.parts[0].text).toContain("capabilities");
    expect(resolve).toHaveBeenCalledWith("supported");
  });

  it("answers legacy A2A 0.3 message/send on the same endpoint", async () => {
    const response = await a2aRequest(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "message/send",
        params: {
          message: {
            messageId: "client-message-legacy",
            role: "user",
            parts: [{ kind: "text", text: "Show discovery endpoints" }],
          },
        },
      }),
      async () => ({}),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.result).toMatchObject({
      kind: "message",
      role: "agent",
      parts: [{ kind: "text" }],
    });
    expect(body.result.parts[0].text).toContain("/discovery/resources");
  });

  it("uses live status data for status requests", async () => {
    const resolve = vi.fn(async () => ({ gateway: "operational" }));
    const response = await a2aRequest(
      request({
        jsonrpc: "2.0",
        id: 4,
        method: "SendMessage",
        params: {
          message: {
            messageId: "client-status",
            role: "ROLE_USER",
            parts: [{ text: "Is XGuard operational?" }],
          },
        },
      }),
      resolve,
    );
    const body = (await response.json()) as any;
    expect(body.result.message.parts[0].text).toContain('"gateway":"operational"');
    expect(resolve).toHaveBeenCalledWith("status");
  });

  it("returns JSON-RPC method-not-found for unsupported operations", async () => {
    const response = await a2aRequest(
      request({ jsonrpc: "2.0", id: 5, method: "GetTask", params: {} }),
      async () => ({}),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32601 },
    });
  });

  it("rejects malformed JSON-RPC requests", async () => {
    const response = await a2aRequest(
      request({ id: 6, method: "SendMessage", params: {} }),
      async () => ({}),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: -32600 },
    });
  });

  it("publishes CORS preflight for A2A clients", () => {
    const response = a2aOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "A2A-Version",
    );
  });
});
