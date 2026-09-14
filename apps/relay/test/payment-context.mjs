import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HTTPFacilitatorClient } from "@x402/core/server";

const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] };
async function payment() {
  const account = privateKeyToAccount(generatePrivateKey());
  const requirements = {
    scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x3333333333333333333333333333333333333333", amount: "1", maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  const authorization = { from: account.address, to: requirements.payTo, value: "1", validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + randomBytes(32).toString("hex") };
  const signature = await account.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: requirements.asset },
    types, primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: 1n, validAfter: 0n, validBefore: BigInt(authorization.validBefore) },
  });
  return { x402Version: 2, paymentPayload: { x402Version: 2, accepted: requirements, payload: { authorization, signature } }, paymentRequirements: requirements };
}
function isolated(body, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./payment-context-worker.mjs", import.meta.url), { workerData: { body, ...options } });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Isolated request timed out")); }, 20000);
    worker.once("message", value => { clearTimeout(timeout); value.error ? reject(new Error(value.error)) : resolve(value); });
    worker.once("error", error => { clearTimeout(timeout); reject(error); });
    worker.once("exit", code => { if (code !== 0) { clearTimeout(timeout); reject(new Error("Isolate exited: " + code)); } });
  });
}

test("official facilitator client verifies and settles in different isolates, then replays from durable evidence", async t => {
  const body = await payment(), original = globalThis.fetch;
  const calls = []; let storage = {};
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, "https://api.xguardgate.com");
    const result = await isolated(JSON.parse(init.body), { path: new URL(url).pathname, storage });
    storage = result.storage; calls.push(result);
    return Response.json(result.body, { status: result.status, headers: result.headers });
  };
  t.after(() => { globalThis.fetch = original; });
  const client = new HTTPFacilitatorClient({ url: "https://api.xguardgate.com" });
  assert.equal((await client.verify(body.paymentPayload, body.paymentRequirements)).isValid, true);
  assert.equal((await client.settle(body.paymentPayload, body.paymentRequirements)).success, true);
  assert.equal((await client.settle(body.paymentPayload, body.paymentRequirements)).success, true);
  assert.equal(new Set(calls.map(x => x.threadId)).size, 3);
  assert.equal(calls[1].counts.verify, 1, "settle must independently verify this request");
  assert.equal(calls[1].counts.settle, 1);
  assert.equal(calls[1].headers["x-xguard-payment-context"], "verified_per_request");
  assert.equal(calls[2].headers["x-xguard-payment-context"], "durable_receipt");
  assert.equal(calls[2].counts.settle, 0);
  assert.equal(calls[2].counts.verify, 0, "confirmed replay need not reverify a consumed authorization");
  const altered = structuredClone(body); altered.paymentPayload.resource = { url: "https://different.example" };
  const conflict = await isolated(altered, { storage });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.errorReason, "settlement_context_conflict");
  assert.equal(conflict.counts.settle, 0);
});

test("direct settlement rebuilds trust with no earlier verification request", async () => {
  const result = await isolated(await payment());
  assert.equal(result.status, 200); assert.equal(result.counts.verify, 1); assert.equal(result.counts.settle, 1);
});

test("supported envelope aliases are normalized before reaching the configured facilitator", async () => {
  const body = await payment();
  const result = await isolated({ payment: body.paymentPayload, requirements: body.paymentRequirements });
  assert.equal(result.status, 200); assert.equal(result.counts.verify, 1); assert.equal(result.counts.settle, 1);
});

test("missing or conflicting context is rejected before any upstream call", async () => {
  const body = await payment();
  for (const [value, reason] of [
    [{}, "missing_payment_context"],
    [{ paymentPayload: body.paymentPayload }, "missing_payment_context"],
    [{ ...body, requirements: { ...body.paymentRequirements, amount: "999" } }, "conflicting_payment_context"],
  ]) {
    const result = await isolated(value, { headers: { "x-xguard-verified-payment-context": "true" } });
    assert.equal(result.status, 400); assert.equal(result.body.reason, reason);
    assert.equal(result.counts.verify, 0); assert.equal(result.counts.settle, 0);
  }
});

test("forged verification fields and headers cannot authorize an invalid signature", async () => {
  const body = await payment(); body.paymentPayload.payload.signature = "0x" + "0".repeat(130);
  body.isValid = true; body.verifiedPaymentContext = { trusted: true };
  const result = await isolated(body, { headers: { "x-xguard-verified": "true", "x-xguard-payment-context": "verified_per_request" } });
  assert.equal(result.status, 400); assert.equal(result.counts.verify, 1); assert.equal(result.counts.settle, 0);
  assert.equal(result.body.errorReason, "invalid_signature");
  assert.ok(Object.values(result.storage).every(value => Object.keys(value).length === 0), "no quota or receipt mutation before trust exists");
});

test("verification outage cannot broadcast, bill, or enter late-settlement recovery", async () => {
  const result = await isolated(await payment(), { verifierUnavailable: true });
  assert.equal(result.status, 503); assert.equal(result.counts.settle, 0); assert.equal(result.counts.other, 0);
  assert.ok(Object.values(result.storage).every(value => Object.keys(value).length === 0));
});

test("recipient, amount and expiry firewall checks still reject before verification", async () => {
  const body = await payment();
  for (const mutate of [
    b => { b.paymentRequirements = { ...b.paymentRequirements, amount: "2" }; },
    b => { b.paymentPayload.payload.authorization.to = "0x4444444444444444444444444444444444444444"; },
    b => { b.paymentPayload.payload.authorization.validBefore = "1"; },
  ]) {
    const input = structuredClone(body); mutate(input);
    const result = await isolated(input);
    assert.equal(result.status, 400); assert.equal(result.headers["x-xguard-firewall"], "block");
    assert.equal(result.counts.verify, 0); assert.equal(result.counts.settle, 0);
  }
});
