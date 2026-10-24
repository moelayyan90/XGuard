import test from "node:test";
import assert from "node:assert/strict";
import entry, { bareChallenge } from "../src/discovery-entry.js";
import { validateDiscoveryExtension } from '@x402/extensions/bazaar';

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

test('unknown routes and invalid input never initialize payment or require credentials', async t => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected payment initialization'); };
  t.after(() => { globalThis.fetch = original; });
  for (const [path, method, status] of [['/unknown', 'GET', 404], ['/v1/reconcile', 'POST', 404], ['/v1/reconcile?from=bad&nonce=bad', 'GET', 400]]) {
    const response = await entry.fetch(new Request('https://reconcile.xguardgate.com' + path, { method }), {}, {});
    assert.equal(response.status, status); assert.equal(response.headers.has('payment-response'), false);
  }
  assert.equal(calls, 0);
});

test('public discovery retains the paid offer and its schema validates the published information', async () => {
  const response = await entry.fetch(new Request('https://reconcile.xguardgate.com/.well-known/x402.json'), { XGUARD_TREASURY_USDC_ADDRESS: TREASURY }, {});
  const resource = (await response.json()).resources[0];
  assert.equal(resource.accepts[0].amount, '2000'); assert.equal(resource.accepts[0].network, 'eip155:8453');
  assert.equal(validateDiscoveryExtension(resource.extensions.bazaar).valid, true);
});
