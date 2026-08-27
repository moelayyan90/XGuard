import test from "node:test";
import assert from "node:assert/strict";
import app from "./a2a-entry.js";

const base = "https://xguardgate.com";

test("A2A Agent Card exposes the canonical v1 discovery surface", async () => {
  const response = await app.fetch(new Request(`${base}/.well-known/agent-card.json`), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/a2a\+json/);
  const card = await response.json();
  assert.equal(card.name, "XGuard Discovery Agent");
  assert.equal(card.version, "5.0.2");
  assert.equal(card.supportedInterfaces?.[0]?.url, `${base}/a2a`);
  assert.equal(card.supportedInterfaces?.[0]?.protocolBinding, "JSONRPC");
  assert.equal(card.supportedInterfaces?.[0]?.protocolVersion, "1.0");
  assert.equal(card.capabilities?.streaming, false);
  assert.ok(Array.isArray(card.defaultInputModes) && card.defaultInputModes.length > 0);
  assert.ok(Array.isArray(card.defaultOutputModes) && card.defaultOutputModes.length > 0);
  assert.ok(Array.isArray(card.skills) && card.skills.length >= 3);
  for (const skill of card.skills) assert.ok(Array.isArray(skill.tags) && skill.tags.length > 0);
});

test("A2A SendMessage returns deterministic public discovery without echoing user input", async () => {
  const sentinel = "DO-NOT-ECHO-UNTRUSTED-INPUT-123";
  const response = await app.fetch(new Request(`${base}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "SendMessage",
      params: {
        message: {
          messageId: "msg-1",
          role: "ROLE_USER",
          parts: [{ text: sentinel }],
        },
      },
    }),
  }), {}, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 7);
  assert.equal(body.result?.message?.role, "ROLE_AGENT");
  const text = body.result?.message?.parts?.[0]?.text || "";
  assert.match(text, /https:\/\/api\.xguardgate\.com\/mcp/);
  assert.doesNotMatch(text, new RegExp(sentinel));
});

test("A2A rejects unsupported protocol versions", async () => {
  const response = await app.fetch(new Request(`${base}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "0.3" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "SendMessage",
      params: { message: { messageId: "msg-2", role: "ROLE_USER", parts: [{ text: "discover" }] } },
    }),
  }), {}, {});
  const body = await response.json();
  assert.equal(body.error?.code, -32009);
});
