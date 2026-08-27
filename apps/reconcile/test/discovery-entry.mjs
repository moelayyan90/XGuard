import test from "node:test";
import assert from "node:assert/strict";
import entry, { bareChallenge } from "../src/discovery-entry.js";

const TREASURY = "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07";

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

test("bare monitor probe returns a standard x402 v2 challenge", async () => {
  const response = bareChallenge({ XGUARD_TREASURY_USDC_ADDRESS: TREASURY });
  assert.equal(response.status, 402);
  const challenge = decode(response.headers.get("payment-required"));
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.accepts[0].scheme, "exact");
  assert.equal(challenge.accepts[0].network, "eip155:8453");
  assert.equal(challenge.accepts[0].amount, "2000");
  assert.equal(challenge.accepts[0].payTo.toLowerCase(), TREASURY.toLowerCase());
  assert.match(challenge.resource.url, /\?from=0x[0-9a-f]+&nonce=0x[0-9a-f]+$/i);
});

test("signed retry on bare URL is rejected before any payment middleware can settle it", async () => {
  const request = new Request("https://reconcile.xguardgate.com/v1/reconcile", {
    method: "GET",
    headers: { "payment-signature": "not-a-real-payment" },
  });
  const response = await entry.fetch(request, { XGUARD_TREASURY_USDC_ADDRESS: TREASURY }, {});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "input_required_before_payment");
});

test("missing treasury fails closed instead of advertising an uncollectable payment", () => {
  const response = bareChallenge({});
  assert.equal(response.status, 503);
});
