import test from "node:test";
import assert from "node:assert/strict";
import { hostedGateResponse } from "../src/hosted-gate.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const RESOURCE = "https://merchant.example/premium";

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function request(signature) {
  const headers = new Headers({
    "x-xguard-resource-url": RESOURCE,
    "x-xguard-pay-to": PAY_TO,
    "x-xguard-amount": "10000",
    "x-xguard-network": "eip155:8453",
    "x-xguard-asset": BASE_USDC,
  });
  if (signature) headers.set("payment-signature", signature);
  return new Request("https://api.xguardgate.com/v1/gate/authorize", { method: "POST", headers });
}

function payload(amount = "10000") {
  return {
    x402Version: 2,
    resource: { url: RESOURCE, description: "Premium", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount,
      asset: BASE_USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    },
    payload: {
      signature: "0x" + "11".repeat(65),
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: PAY_TO,
        value: amount,
        validAfter: "1",
        validBefore: "9999999999",
        nonce: "0x" + "33".repeat(32),
      },
    },
    extensions: {},
  };
}

test("returns a canonical x402 v2 challenge before any facilitator call", async () => {
  const worker = { fetch: async () => { throw new Error("facilitator must not be called"); } };
  const response = await hostedGateResponse(request(), {}, {}, worker);
  assert.equal(response.status, 402);
  const challenge = decode(response.headers.get("payment-required"));
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.resource.url, RESOURCE);
  assert.equal(challenge.accepts[0].scheme, "exact");
  assert.equal(challenge.accepts[0].network, "eip155:8453");
  assert.equal(challenge.accepts[0].amount, "10000");
  assert.equal(challenge.accepts[0].asset.toLowerCase(), BASE_USDC.toLowerCase());
  assert.equal(challenge.accepts[0].payTo.toLowerCase(), PAY_TO.toLowerCase());
});

test("rejects a signed payload whose accepted amount does not match policy", async () => {
  let calls = 0;
  const worker = { fetch: async () => { calls += 1; throw new Error("must not call facilitator"); } };
  const response = await hostedGateResponse(request(encode(payload("9999"))), {}, {}, worker);
  assert.equal(response.status, 402);
  assert.equal(calls, 0);
  const challenge = decode(response.headers.get("payment-required"));
  assert.match(challenge.error, /does not match/i);
});

test("verifies then settles and returns PAYMENT-RESPONSE only after successful settlement", async () => {
  const calls = [];
  const worker = {
    fetch: async req => {
      const url = new URL(req.url);
      calls.push({ path: url.pathname, body: await req.clone().json() });
      if (url.pathname === "/verify") {
        return new Response(JSON.stringify({ isValid: true, payer: "0x2222222222222222222222222222222222222222" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/settle") {
        return new Response(JSON.stringify({ success: true, payer: "0x2222222222222222222222222222222222222222", transaction: "0x" + "44".repeat(32), network: "eip155:8453" }), {
          status: 200,
          headers: { "content-type": "application/json", "x-xguard-receipt-id": "xgr_" + "55".repeat(20) },
        });
      }
      throw new Error(`unexpected path ${url.pathname}`);
    },
  };

  const response = await hostedGateResponse(request(encode(payload())), {}, {}, worker);
  assert.equal(response.status, 204);
  assert.deepEqual(calls.map(x => x.path), ["/verify", "/settle"]);
  assert.equal(calls[0].body.x402Version, 2);
  assert.equal(calls[0].body.paymentRequirements.amount, "10000");
  assert.equal(calls[1].body.paymentPayload.accepted.payTo.toLowerCase(), PAY_TO.toLowerCase());
  const paymentResponse = decode(response.headers.get("payment-response"));
  assert.equal(paymentResponse.success, true);
  assert.equal(response.headers.get("x-xguard-gate-authorized"), "1");
  assert.match(response.headers.get("x-xguard-receipt-id"), /^xgr_/);
});

test("fails closed on ambiguous settlement errors", async () => {
  const worker = {
    fetch: async req => {
      const path = new URL(req.url).pathname;
      if (path === "/verify") return new Response(JSON.stringify({ isValid: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ error: "upstream_timeout" }), { status: 503, headers: { "content-type": "application/json", "x-xguard-settlement-safety": "fail-closed" } });
    },
  };
  const response = await hostedGateResponse(request(encode(payload())), {}, {}, worker);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-xguard-settlement-safety"), "fail-closed");
  assert.equal(response.headers.get("payment-response"), null);
});
