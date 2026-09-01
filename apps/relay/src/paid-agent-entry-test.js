import test from "node:test";
import assert from "node:assert/strict";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import app, { PaidGatewayState, ProofAuthority } from "./paid-agent-entry.js";

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarm = null; }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(value) { this.alarm = value; }
}

function namespaceFor(Class, env) {
  const objects = new Map();
  return {
    idFromName(name) { return name; },
    get(id) {
      if (!objects.has(id)) objects.set(id, new Class({ storage: new MemoryStorage() }, env));
      const object = objects.get(id);
      return { fetch(input, init) { return object.fetch(input instanceof Request ? input : new Request(input, init)); } };
    },
  };
}

function environment() {
  const env = {
    XGUARD_PAID_FACILITATOR: "https://facilitator.test",
    XGUARD_TESTNET_FACILITATOR: "https://facilitator.test",
    XGUARD_TREASURY_USDC_ADDRESS: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_TESTNET_PAY_TO: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_WEB_FETCH_PRICE_ATOMIC: "1000",
    XGUARD_MARGIN_USD_MICROS: "1000",
  };
  env.PROOF_AUTHORITY = namespaceFor(ProofAuthority, env);
  env.PAID_GATEWAY = namespaceFor(PaidGatewayState, env);
  return env;
}

const target = "https://example.com/data.json";
const payer = "0x1111111111111111111111111111111111111111";
const transaction = `0x${"2".repeat(64)}`;

async function signedQuote(env) {
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target, testnet: true }),
  }), env, {});
  assert.equal(response.status, 200);
  return response.json();
}

test("paid discovery advertises only the real enabled connector", async () => {
  const env = environment();
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/capabilities"), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, "5.1.0");
  assert.equal(body.tools.find(tool => tool.id === "xguard.web.fetch")?.available, true);
  assert.equal(body.tools.find(tool => tool.id === "xguard.web.search")?.available, false);
  assert.equal(body.tools.find(tool => tool.id === "xguard.ai.generate")?.unavailable_reason?.code, "connector_not_configured");
  const mcp = await app.fetch(new Request("https://api.xguardgate.com/mcp"), env, {});
  assert.equal(mcp.status, 200);
  assert.ok((await mcp.json()).tools.some(tool => tool.name === "xguard.pricing.quote"));
});

test("readiness accepts the official facilitator supported shape", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "facilitator.test" && url.pathname === "/supported") {
      return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/ready"), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.deepEqual(body.checks, { proof_authority: true, paid_state: true, mainnet_config: true, facilitator: true });
});

test("quote issuance rejects private, local, metadata, and XGuard-owned targets", async () => {
  const env = environment();
  for (const url of [
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://metadata.google.internal/",
    "https://api.xguardgate.com/identity",
    "https://localhost/",
  ]) {
    const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, testnet: true }),
    }), env, {});
    assert.equal(response.status, 403, url);
    assert.equal((await response.json()).error.code, "target_not_public");
  }
});

test("signed quote produces an official x402 v2 challenge", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "cloudflare-dns.com") return new Response(JSON.stringify({ Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/dns-json" } });
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const quoted = await signedQuote(env);
  assert.match(quoted.quote, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(quoted.network, "eip155:84532");
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xguard-quote": quoted.quote },
    body: JSON.stringify({ url: target }),
  }), env, {});
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("payment-required"));
  const required = await response.json();
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].network, "eip155:84532");
  assert.equal(required.accepts[0].amount, "1000");
  assert.equal(required.extensions["payment-identifier"].info.required, true);
  assert.equal(required.extensions["payment-identifier"].info.id, quoted.payment_identifier);
  assert.ok(required.extensions["offer-receipt"].info.offers[0].signature);

  const mcpResponse = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "xguard.web.fetch", arguments: { url: target, quote: quoted.quote } } }),
  }), env, {});
  assert.equal(mcpResponse.status, 402);
  assert.equal((await mcpResponse.json()).accepts[0].network, "eip155:84532");
});

test("settlement precedes execution and an exact retry does not settle twice", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  let verifyCalls = 0;
  let settleCalls = 0;
  let upstreamCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      return new Response(JSON.stringify({ Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/dns-json" } });
    }
    if (url.hostname === "facilitator.test" && url.pathname === "/verify") {
      verifyCalls += 1;
      return new Response(JSON.stringify({ isValid: true, payer }), { headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "facilitator.test" && url.pathname === "/settle") {
      settleCalls += 1;
      return new Response(JSON.stringify({ success: true, payer, transaction, network: "eip155:84532" }), { headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "example.com") {
      upstreamCalls += 1;
      assert.equal(settleCalls, 1, "upstream must not execute before settlement succeeds");
      return new Response(JSON.stringify({ source: "test-upstream" }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const quoted = await signedQuote(env);
  const challengeResponse = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xguard-quote": quoted.quote },
    body: JSON.stringify({ url: target }),
  }), env, {});
  const challenge = await challengeResponse.json();
  const paymentPayload = {
    x402Version: 2,
    resource: challenge.resource,
    accepted: challenge.accepts[0],
    payload: {
      signature: `0x${"1".repeat(130)}`,
      authorization: {
        from: payer,
        to: challenge.accepts[0].payTo,
        value: challenge.accepts[0].amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${"3".repeat(64)}`,
      },
    },
    extensions: { "payment-identifier": { info: { id: quoted.payment_identifier } } },
  };
  const execute = () => app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-xguard-quote": quoted.quote,
      "payment-signature": encodePaymentSignatureHeader(paymentPayload),
    },
    body: JSON.stringify({ url: target }),
  }), env, {});

  const first = await execute();
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.status, "succeeded");
  assert.equal(firstBody.replay, false);
  assert.equal(firstBody.accounting.gross_revenue_usd_micros, 0);
  assert.equal(firstBody.accounting.net_profit_usd_micros, 0);
  assert.equal(firstBody.accounting.revenue_source, "testnet_settlement_non_revenue");
  assert.ok(firstBody.receipt.signature);
  assert.ok(firstBody.proofrail.proof);
  const verifiedProof = await app.fetch(new Request("https://api.xguardgate.com/v1/proofs/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof: firstBody.proofrail.proof }),
  }), env, {});
  assert.equal(verifiedProof.status, 200);
  const proofResult = await verifiedProof.json();
  assert.equal(proofResult.valid, true);
  assert.equal(proofResult.payload.transaction, transaction);

  const status = await app.fetch(new Request(`https://api.xguardgate.com/v1/operations/${quoted.payment_identifier}`), env, {});
  assert.equal(status.status, 200);
  const operation = await status.json();
  assert.equal(operation.status, "succeeded");
  assert.equal(operation.transaction, transaction);
  assert.equal(operation.gross_revenue_usd_micros, 0);

  const replay = await execute();
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-xguard-replay"), "true");
  assert.equal((await replay.json()).replay, true);
  assert.equal(verifyCalls, 1);
  assert.equal(settleCalls, 1);
  assert.equal(upstreamCalls, 1);
});

test("pending, verified, and ambiguous states never record revenue", async () => {
  const env = environment();
  const object = new PaidGatewayState({ storage: new MemoryStorage() }, env);
  const post = (path, body) => object.fetch(new Request(`https://paid-gateway${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  await post("/operation/begin", { request_id: "xgr_financial_test", payment_identifier: "pay_12345678901234567890123456789012", authorization_fingerprint: "a".repeat(64), request_digest: "b".repeat(64), customer_price_usd_micros: 1000, maximum_upstream_cost_usd_micros: 0 });
  for (const status of ["verified", "ambiguous"]) {
    const response = await post("/operation/transition", { status, patch: {} });
    assert.equal(response.status, 200);
    const record = (await response.json()).record;
    assert.equal(record.gross_revenue_usd_micros, 0);
    assert.equal(record.net_profit_usd_micros, 0);
    assert.equal(record.revenue_source, null);
  }
  const settled = await post("/operation/transition", { status: "settled", patch: { transaction, network: "eip155:8453" } });
  assert.equal(settled.status, 200);
  const settledRecord = (await settled.json()).record;
  assert.equal(settledRecord.gross_revenue_usd_micros, 1000);
  assert.equal(settledRecord.net_profit_usd_micros, 1000);
  assert.equal(settledRecord.revenue_source, "x402_settlement");
});
