import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createXGuardOutcomeClient } from "./outcomes.js";

// Real HTTP sockets exercise response-body interruption. The payment challenge
// and signer are fixtures: no wallet is funded and no blockchain payment occurs.
const timeoutMs = 350;
const recovery = { payment_identifier: "pay_deadline_fixture", quote: "fixture-only-quote" };
const challenge = {
  x402Version: 2, resource: { url: "https://api.xguardgate.com/v1/execute" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payTo: `0x${"1".repeat(40)}` }],
  extensions: { "payment-identifier": { info: { id: recovery.payment_identifier } } },
};
const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json", "x-xguard-quote": recovery.quote });
  res.end(JSON.stringify(data));
};
const stallBody = (res, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.write('{"incomplete":');
};
async function serverFor(t, handler) {
  const requests = [], errors = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const call = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      requests.push(call);
      await handler(call, res);
    } catch (error) { errors.push(error); res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(errors, []);
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}
const isTimeout = error => error.name === "TimeoutError" && error.code === "XGUARD_REQUEST_TIMEOUT";
function payerFor(state) {
  return { async createPaymentPayload(input) {
    state.signatures++;
    return { x402Version: 2, accepted: input.accepts[0], payload: { signature: "fixture-only-signature", nonce: state.signatures } };
  } };
}

test("invalid network deadlines fail before any request", () => {
  for (const value of [0, -1, 0.5, "350", NaN, Infinity, 300001, null]) {
    assert.throws(() => createXGuardOutcomeClient({ timeoutMs: value, fetchImpl: () => assert.fail("unexpected network") }), /timeoutMs/);
  }
});

test("free responses and payment challenges cannot hang while their body is read", async t => {
  for (const status of [200, 402]) await t.test(`HTTP ${status}`, async t => {
    const h = await serverFor(t, (_call, res) => stallBody(res, status));
    const state = { signatures: 0 };
    const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, maxAmountAtomic: "2000", payer: payerFor(state) });
    await assert.rejects(client.execute("demo"), isTimeout);
    assert.equal(h.requests.length, 1);
    assert.equal(state.signatures, 0);
  });
});

test("a paid body timeout retries the identical authorization once with a fresh deadline", async t => {
  const paid = [], signals = [];
  const state = { signatures: 0, prepared: 0 };
  const h = await serverFor(t, (call, res) => {
    if (!call.headers["payment-signature"]) return json(res, 402, challenge);
    assert.equal(state.prepared, 1, "recovery must be saved before submission");
    paid.push(call);
    if (paid.length === 1) return stallBody(res);
    json(res, 200, { ok: true, payment_identifier: recovery.payment_identifier, replay: true, result: { items: [] } });
  });
  const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, maxAmountAtomic: "2000", payer: payerFor(state),
    fetchImpl: (url, init) => { if (init.headers["payment-signature"]) signals.push(init.signal); return fetch(url, init); },
    onPaymentPrepared: async value => { assert.deepEqual(value, recovery); assert.equal(paid.length, 0); state.prepared++; },
  });
  const result = await client.execute({ intent: "Summarize technology feeds" });
  assert.equal(result.ok, true); assert.deepEqual(result.recovery, recovery);
  assert.equal(state.signatures, 1); assert.equal(state.prepared, 1);
  assert.equal(paid.length, 2); assert.equal(h.requests.length, 3);
  assert.equal(paid[0].body, paid[1].body);
  assert.equal(paid[0].headers["payment-signature"], paid[1].headers["payment-signature"]);
  assert.equal(paid[0].headers["x-xguard-quote"], paid[1].headers["x-xguard-quote"]);
  assert.notEqual(signals[0], signals[1]); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
});

test("two lost paid responses stop with saved recovery and no new authorization", async t => {
  const state = { signatures: 0 }, paid = [];
  const h = await serverFor(t, (call, res) => {
    if (!call.headers["payment-signature"]) return json(res, 402, challenge);
    paid.push(call); stallBody(res);
  });
  const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, maxAmountAtomic: "2000", payer: payerFor(state) });
  await assert.rejects(client.execute("Summarize technology feeds"), error => {
    assert.equal(isTimeout(error), true); assert.deepEqual(error.recovery, recovery); return true;
  });
  assert.equal(state.signatures, 1); assert.equal(paid.length, 2); assert.equal(h.requests.length, 3);
  assert.equal(paid[0].headers["payment-signature"], paid[1].headers["payment-signature"]);
});

test("recovery has a body deadline and can never submit a payment", async t => {
  const h = await serverFor(t, (_call, res) => stallBody(res));
  const state = { signatures: 0 };
  const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, payer: payerFor(state) });
  await assert.rejects(client.getResult(recovery), isTimeout);
  assert.equal(state.signatures, 0); assert.equal(h.requests.length, 1);
  const [call] = h.requests;
  assert.equal(call.method, "GET"); assert.equal(call.path, `/v1/results/${recovery.payment_identifier}`);
  assert.equal(call.headers["payment-signature"], undefined); assert.equal(call.headers["x-xguard-quote"], recovery.quote);
});

test("an HTTP error preserves execution credit and recovery without automatic resubmission", async t => {
  const failure = { error: { message: "Source unavailable", details: { execution_credit: "fixture-credit" } } };
  const h = await serverFor(t, (call, res) => json(res, call.headers["payment-signature"] ? 502 : 402, call.headers["payment-signature"] ? failure : challenge));
  const state = { signatures: 0 };
  const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, maxAmountAtomic: "2000", payer: payerFor(state) });
  await assert.rejects(client.execute("Summarize technology feeds"), error => {
    assert.equal(error.status, 502); assert.deepEqual(error.data, failure); assert.deepEqual(error.recovery, recovery); return true;
  });
  assert.equal(h.requests.length, 2); assert.equal(state.signatures, 1);
});

test("malformed paid JSON is not retried and retains recovery", async t => {
  const h = await serverFor(t, (call, res) => {
    if (!call.headers["payment-signature"]) return json(res, 402, challenge);
    res.writeHead(200, { "content-type": "application/json" }); res.end("invalid JSON");
  });
  const state = { signatures: 0 };
  const client = createXGuardOutcomeClient({ baseUrl: h.baseUrl, timeoutMs, maxAmountAtomic: "2000", payer: payerFor(state) });
  await assert.rejects(client.execute("Summarize technology feeds"), error => {
    assert.ok(error instanceof SyntaxError); assert.deepEqual(error.recovery, recovery); return true;
  });
  assert.equal(h.requests.length, 2); assert.equal(state.signatures, 1);
});

test("a custom transport that ignores abort still returns control at the deadline", async () => {
  let signal;
  const client = createXGuardOutcomeClient({ timeoutMs, fetchImpl: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  await assert.rejects(client.execute("demo"), isTimeout);
  assert.equal(signal.aborted, true);
});
