import assert from "node:assert/strict";
import worker from "../src/index.js";
import { SettlementReceipt } from "../src/gateway.js";

const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function requestBody() {
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: NETWORK,
        asset: "USDC",
        payTo: "merchant-test",
        amount: "1",
      },
      payload: {
        authorization: {
          from: "payer-test",
          nonce: "nonce-test",
        },
      },
    },
    paymentRequirements: {
      scheme: "exact",
      network: NETWORK,
      asset: "USDC",
      payTo: "merchant-test",
      amount: "1",
    },
  };
}

function quotaBinding() {
  return {
    idFromName(name) { return name; },
    get() {
      return {
        async fetch(input) {
          const href = typeof input === "string" ? input : input?.url;
          const path = new URL(href).pathname;
          if (path === "/admit") return new Response(JSON.stringify({ ok: true, nonce: "quota-test", success: 0 }), { status: 200, headers: { "content-type": "application/json" } });
          return new Response(JSON.stringify({ ok: true, success: path === "/commit" ? 1 : 0 }), { status: 200, headers: { "content-type": "application/json" } });
        },
      };
    },
  };
}

function receiptBinding() {
  const instances = new Map();
  return { idFromName: id => id, get(id) {
    if (!instances.has(id)) {
      const data = new Map();
      const storage = { async get(key) { return data.get(key); }, async put(key, value) { data.set(key, value); }, async delete(key) { data.delete(key); }, async transaction(fn) { return fn(storage); } };
      instances.set(id, new SettlementReceipt({ storage }));
    }
    return { fetch(input, init) { return instances.get(id).fetch(new Request(input, init)); } };
  } };
}

const env = {
  QUOTAS: quotaBinding(),
  RECEIPTS: receiptBinding(),
  FREE_SETTLEMENTS: "25",
  SETTLEMENT_CREDITS: "2",
  X402_GLOBAL_PRIMARY: "https://one.example",
  X402_BASE_PRIMARY: "https://two.example",
  X402_BASE_SECONDARY: "https://three.example",
  X402_MULTI: "https://four.example",
};

function supported() {
  return new Response(JSON.stringify({ kinds: [{ scheme: "exact", network: NETWORK }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function callSettle() {
  return worker.fetch(new Request("https://api.xguardgate.com/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody()),
  }), env);
}

// Ambiguous 5xx after sending a signed settlement must not be replayed to a second facilitator.
{
  let settleCalls = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/supported")) return supported();
    if (url.endsWith("/verify")) return Response.json({ isValid: true, payer: "payer-test" });
    if (url.endsWith("/settle")) {
      settleCalls += 1;
      return new Response(JSON.stringify({ error: "upstream_internal_after_submission" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const response = await callSettle();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(settleCalls, 1, "ambiguous settlement must be sent to exactly one facilitator");
  assert.equal(response.headers.get("x-xguard-settlement-safety"), "fail-closed-ambiguous");
  assert.equal(response.headers.get("x-xguard-route-attempts"), "1");
  assert.equal(body.errorReason, "settlement_state_ambiguous_no_reconciliation");
}

// Explicit rate limiting is safe to route around because the upstream refused admission.
{
  env.RECEIPTS = receiptBinding();
  let settleCalls = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/supported")) return supported();
    if (url.endsWith("/verify")) return Response.json({ isValid: true, payer: "payer-test" });
    if (url.endsWith("/settle")) {
      settleCalls += 1;
      if (settleCalls === 1) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, transaction: "test-tx", network: NETWORK }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const response = await callSettle();
  assert.equal(response.status, 200);
  assert.equal(settleCalls, 2, "429 should permit one safe route failover");
  assert.equal(response.headers.get("x-xguard-route-attempts"), "2");
  assert.equal(response.headers.get("x-xguard-settlement-safety"), "rate-limit-safe-retry");
}

console.log("settlement safety behavior: ok");
