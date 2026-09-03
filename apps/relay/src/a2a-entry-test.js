import test from "node:test";
import assert from "node:assert/strict";
import app, { PaidGatewayState, ProofAuthority } from "./a2a-entry.js";

const base = "https://xguardgate.com";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm() {}
}

function namespaceFor(Class, env) {
  const objects = new Map();
  return { idFromName(name) { return name; }, get(id) { if (!objects.has(id)) objects.set(id, new Class({ storage: new MemoryStorage() }, env)); const object = objects.get(id); return { fetch(input, init) { return object.fetch(input instanceof Request ? input : new Request(input, init)); } }; } };
}

function paidEnvironment() {
  const env = {
    XGUARD_PAYMENT_ENVIRONMENT: "production",
    XGUARD_PAID_FACILITATOR: "https://facilitator.test",
    XGUARD_TESTNET_FACILITATOR: "https://facilitator.test",
    XGUARD_TREASURY_USDC_ADDRESS: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_TESTNET_PAY_TO: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_WEB_FETCH_PRICE_ATOMIC: "1000",
    XGUARD_MARGIN_USD_MICROS: "1000",
    XGUARD_TESTNET_WEB_FETCH_PRICE_ATOMIC: "1000",
    XGUARD_TESTNET_MARGIN_USD_MICROS: "1000",
  };
  env.PROOF_AUTHORITY = namespaceFor(ProofAuthority, env);
  env.PAID_GATEWAY = namespaceFor(PaidGatewayState, env);
  return env;
}

function sendMessage(id, data, headers = {}) {
  return new Request(`${base}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0.0", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "SendMessage", params: { message: { messageId: `msg-${id}`, role: "ROLE_USER", parts: [{ data }] } } }),
  });
}

test("A2A Agent Card exposes the canonical v1 discovery surface", async () => {
  const response = await app.fetch(new Request(`${base}/.well-known/agent-card.json`), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/a2a\+json/);
  const card = await response.json();
  assert.equal(card.name, "XGuard Universal Paid AI Agent + Secretless Gateway");
  assert.equal(card.version, "5.1.0");
  assert.equal(card.supportedInterfaces?.[0]?.url, "https://api.xguardgate.com/a2a");
  assert.equal(card.supportedInterfaces?.[0]?.protocolBinding, "JSONRPC");
  assert.equal(card.supportedInterfaces?.[0]?.protocolVersion, "1.0.0");
  assert.equal(card.capabilities?.streaming, false);
  assert.ok(Array.isArray(card.defaultInputModes) && card.defaultInputModes.length > 0);
  assert.ok(Array.isArray(card.defaultOutputModes) && card.defaultOutputModes.length > 0);
  assert.ok(Array.isArray(card.skills) && card.skills.length >= 5);
  assert.ok(card.skills.some(skill => skill.id === "xguard-secretless-egress"));
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

test("A2A SendMessage bridges a useful preflight action instead of discovery only", async () => {
  const response = await app.fetch(new Request(`${base}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "SendMessage",
      params: { message: { messageId: "msg-3", role: "ROLE_USER", parts: [{ data: { action: "xguard.preflight", input: { url: "https://127.0.0.1/" } } }] } },
    }),
  }), {}, {});
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.result.status, "FAILED");
  assert.equal(body.result.message.parts[0].data.error.code, "target_not_public");
});

test("A2A direct paid call creates a signed quote and returns actionable x402 PaymentRequired", async t => {
  const env = paidEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const paidResponse = await app.fetch(sendMessage(11, { action: "xguard.web.fetch", input: { url: "https://example.com/", testnet: true } }), env, {});
  assert.equal(paidResponse.status, 402);
  assert.ok(paidResponse.headers.get("payment-required"));
  assert.match(paidResponse.headers.get("x-xguard-quote") || "", /^[^.]+\.[^.]+\.[^.]+$/);
  const paidBody = await paidResponse.json();
  assert.equal(paidBody.result.status, "INPUT_REQUIRED");
  assert.equal(paidBody.result.message.parts[0].data.x402Version, 2);
  assert.equal(paidBody.result.payment["x-xguard-quote"], paidResponse.headers.get("x-xguard-quote"));
  assert.equal(paidBody.result.message.parts[0].data.extensions.xguard.next.action, "sign_and_retry");
});
