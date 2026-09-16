import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { settlementIdentity, settlementReceiptId } from "../src/core/settlement-receipt.js";

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

test("simultaneous verified settlements admit one broadcast and return the same durable receipt on retry", async () => {
  const body = await payment();
  const result = await isolated(body, { concurrent: 2 });
  assert.equal(result.counts.verify, 2);
  assert.equal(result.counts.settle, 1);
  assert.deepEqual(result.responses.map(x => x.status).sort(), [200, 409]);
  const pending = result.responses.find(x => x.status === 409);
  assert.equal(pending.body.error.code, "settlement_in_progress");
  assert.equal(pending.body.error.retryable, false);
  assert.equal(pending.body.next.path, "/v1/receipts/" + pending.body.receiptId);
  const replay = await isolated(body, { storage: result.storage });
  assert.equal(replay.status, 200); assert.equal(replay.counts.settle, 0);
  assert.equal(replay.body.receiptId, pending.body.receiptId);
  assert.equal(JSON.stringify(replay.body).includes("reservation_token"), false);
});

test("a lost confirmation write preserves the reservation across isolates instead of resubmitting", async () => {
  const body = await payment();
  const first = await isolated(body, { receiptWriteUnavailable: true });
  assert.equal(first.status, 500); assert.equal(first.counts.settle, 1);
  const replay = await isolated(body, { storage: first.storage });
  assert.equal(replay.status, 409); assert.equal(replay.body.error.code, "settlement_in_progress");
  assert.equal(replay.counts.verify, 0); assert.equal(replay.counts.settle, 0);
  const changed = structuredClone(body);
  changed.paymentPayload.resource = { url: "https://different.example" };
  const conflict = await isolated(changed, { storage: first.storage });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "settlement_context_conflict");
  assert.equal(conflict.counts.settle, 0);
});

test("an admission failure before submission releases the reservation safely", async () => {
  const body = await payment();
  const first = await isolated(body, { quotaDenied: true });
  assert.equal(first.status, 402); assert.equal(first.counts.settle, 0);
  const retry = await isolated(body, { storage: first.storage });
  assert.equal(retry.status, 200); assert.equal(retry.counts.settle, 1);
});

test("EVM asset casing cannot bypass reservation and legacy receipt identifiers still replay", async () => {
  const body = await payment();
  const first = await isolated(body);
  const changed = structuredClone(body);
  changed.paymentRequirements.asset = changed.paymentRequirements.asset.toLowerCase();
  changed.paymentPayload.accepted.asset = changed.paymentPayload.accepted.asset.toLowerCase();
  const conflict = await isolated(changed, { storage: first.storage });
  assert.equal(conflict.status, 409); assert.equal(conflict.counts.settle, 0);
  const identity = settlementIdentity(body), id = await settlementReceiptId(identity), legacyId = await settlementReceiptId(identity, true);
  const storage = structuredClone(first.storage);
  storage["receipt:" + legacyId] = storage["receipt:" + id];
  storage["receipt:" + legacyId].record.receipt_id = legacyId;
  delete storage["receipt:" + id];
  const legacy = await isolated(body, { storage });
  assert.equal(legacy.status, 200); assert.equal(legacy.body.receiptId, legacyId);
  assert.equal(legacy.counts.verify, 0); assert.equal(legacy.counts.settle, 0);
});

test("supported envelope aliases are normalized before reaching the configured facilitator", async () => {
  const body = await payment();
  const result = await isolated({ payment: body.paymentPayload, requirements: body.paymentRequirements });
  assert.equal(result.status, 200); assert.equal(result.counts.verify, 1); assert.equal(result.counts.settle, 1);
});

test("snake case and encoded payload aliases preserve the original signed authorization", async () => {
  const body = await payment();
  for (const value of [
    { payment_payload: body.paymentPayload, payment_requirements: body.paymentRequirements },
    { payment: Buffer.from(JSON.stringify(body.paymentPayload)).toString("base64"), requirements: body.paymentRequirements },
  ]) {
    const result = await isolated(value, { headers: { "content-type": "text/plain" } });
    assert.equal(result.status, 200); assert.equal(result.counts.verify, 1); assert.equal(result.counts.settle, 1);
  }
  const conflict = await isolated({ ...body, payment_payload: { ...body.paymentPayload, resource: { url: "https://other.example" } } });
  assert.equal(conflict.status, 400); assert.equal(conflict.body.error.code, "conflicting_payment_context");
  assert.equal(conflict.counts.verify, 0); assert.equal(conflict.counts.settle, 0);
});

test("empty, malformed, duplicate and oversized JSON get bounded repair errors before verification", async () => {
  for (const [rawBody, code, status] of [
    ["", "empty_body", 400], ["{\"payment\":", "invalid_json", 400],
    ['{"payment":{},"payment":{}}', "duplicate_json_key", 400],
    ['{"payment":{},"paym\\u0065nt":{}}', "duplicate_json_key", 400],
    [" ".repeat(131073), "payload_too_large", 413],
  ]) {
    const result = await isolated({}, { path: "/verify", rawBody });
    assert.equal(result.status, status); assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, code); assert.equal(result.body.next.path, "/verify");
    assert.equal(typeof result.body.error.example.paymentPayload.accepted, "object");
    assert.equal(result.body.request_id, result.headers["x-xguard-request-id"]);
    assert.equal(result.counts.verify, 0); assert.equal(result.counts.settle, 0);
  }
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
