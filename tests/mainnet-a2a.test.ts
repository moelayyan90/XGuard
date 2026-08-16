import { describe, expect, it } from "vitest";
import {
  A2A_PATH,
  a2aOptions,
  a2aRequest,
} from "../apps/worker/src/mainnet-a2a.js";

const URL = `https://xguard-mainnet.maqamapp.workers.dev${A2A_PATH}`;

function request(
  method: string,
  params: Record<string, unknown>,
  id: unknown = 1,
) {
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

describe("stateless A2A discovery surface", () => {
  it("supports A2A 0.3 message/send with a direct discovery message", async () => {
    const response = await a2aRequest(
      request("message/send", {
        message: {
          role: "user",
          messageId: "user-1",
          contextId: "ctx-1",
          parts: [{ kind: "text", text: "How do I use XGuard?" }],
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        kind: string;
        role: string;
        contextId: string;
        parts: Array<{ kind: string; text: string }>;
        metadata: { discoveryOnly: boolean; paymentExecution: boolean };
      };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result).toMatchObject({
      kind: "message",
      role: "agent",
      contextId: "ctx-1",
      metadata: { discoveryOnly: true, paymentExecution: false },
    });
    expect(body.result.parts[0]?.kind).toBe("text");
    expect(body.result.parts[0]?.text).toContain("/verify");
    expect(body.result.parts[0]?.text).toContain("never");
  });

  it("supports A2A 1.0 SendMessage without executing a payment", async () => {
    const response = await a2aRequest(
      request(
        "SendMessage",
        {
          message: {
            role: "ROLE_USER",
            messageId: "user-2",
            parts: [{ text: "What can XGuard do?" }],
          },
        },
        "req-2",
      ),
    );
    const body = (await response.json()) as {
      id: string;
      result: {
        message: {
          role: string;
          parts: Array<{ text: string }>;
          metadata: { discoveryOnly: boolean; paymentExecution: boolean };
        };
      };
    };
    expect(body.id).toBe("req-2");
    expect(body.result.message.role).toBe("ROLE_AGENT");
    expect(body.result.message.parts[0]?.text).toContain("/settle");
    expect(body.result.message.metadata).toEqual({
      discoveryOnly: true,
      paymentExecution: false,
    });
  });

  it("accepts the v1 protobuf-style msg alias", async () => {
    const response = await a2aRequest(
      request("SendMessage", {
        msg: {
          role: "ROLE_USER",
          messageId: "user-3",
          parts: [{ text: "status" }],
        },
      }),
    );
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      result: { message: { role: "ROLE_AGENT" } },
    });
  });

  it("returns JSON-RPC parse, request, params, and method errors", async () => {
    const parse = await a2aRequest(
      new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(await parse.json()).toMatchObject({
      id: null,
      error: { code: -32700 },
    });

    const invalid = await a2aRequest(
      new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "message/send" }),
      }),
    );
    expect(await invalid.json()).toMatchObject({
      id: null,
      error: { code: -32600 },
    });

    const params = await a2aRequest(request("message/send", {}));
    expect(await params.json()).toMatchObject({ error: { code: -32602 } });

    const unknown = await a2aRequest(request("tasks/get", { id: "x" }));
    expect(await unknown.json()).toMatchObject({ error: { code: -32601 } });
  });

  it("serves CORS preflight without a body", async () => {
    const response = a2aOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(await response.text()).toBe("");
  });
});
