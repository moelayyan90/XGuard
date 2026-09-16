// A fresh JS isolate for each request; only the simulated durable store survives.
// All upstreams are fixtures. This file never sends a blockchain payment.
import { parentPort, workerData, threadId } from "node:worker_threads";
import { verifyTypedData } from "viem";
import app, { MerchantQuota, SettlementReceipt } from "../src/canonical-entry.js";

const counts = { verify: 0, settle: 0, other: 0 };
const snapshot = structuredClone(workerData.storage || {});
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] };
function namespace(Class, name) {
  const instances = new Map();
  return { idFromName: id => id, get(id) {
    const key = name + ":" + id;
    snapshot[key] ||= {};
    if (!instances.has(key)) {
      let pending = Promise.resolve();
      const storage = {
        async get(k) { return structuredClone(snapshot[key][k]); },
        async put(k, value) { snapshot[key][k] = structuredClone(value); },
        async delete(k) { delete snapshot[key][k]; },
        transaction(fn) {
          const next = pending.then(() => fn(storage));
          pending = next.catch(() => {}); return next;
        },
      };
      instances.set(key, new Class({ storage }));
    }
    return { fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (name === "receipt" && workerData.receiptWriteUnavailable && path === "/record") return Response.json({ error: "unavailable" }, { status: 503 });
      if (name === "quota" && workerData.quotaDenied && path === "/admit") return Response.json({ error: "free_quota_exhausted" }, { status: 402 });
      return instances.get(key).fetch(request);
    } };
  } };
}
const env = {
  X402_GLOBAL_PRIMARY: "https://context-facilitator.example",
  X402_BASE_PRIMARY: "https://context-facilitator.example",
  X402_BASE_SECONDARY: "https://context-facilitator.example",
  X402_MULTI: "https://context-facilitator.example",
  FREE_SETTLEMENTS: "25", SETTLEMENT_CREDITS: "2",
  QUOTAS: namespace(MerchantQuota, "quota"),
  RECEIPTS: namespace(SettlementReceipt, "receipt"),
};
let releaseVerify;
const verifyBarrier = new Promise(resolve => { releaseVerify = resolve; });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "context-facilitator.example") { counts.other++; throw new Error("Unexpected external request"); }
  if (url.pathname === "/supported") return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] });
  const body = JSON.parse(init.body);
  if (!body.paymentPayload?.accepted || !body.paymentRequirements || body.x402Version !== 2) return Response.json({ error: "noncanonical_payment_envelope" }, { status: 400 });
  if (url.pathname === "/verify") {
    counts.verify++;
    if (workerData.concurrent) {
      if (counts.verify >= workerData.concurrent) releaseVerify();
      await verifyBarrier;
    }
    if (workerData.verifierUnavailable) return Response.json({ error: "unavailable" }, { status: 503 });
    const p = body.paymentPayload, r = body.paymentRequirements, a = p.payload.authorization;
    let valid = false;
    try {
      valid = await verifyTypedData({
        address: a.from,
        domain: { name: r.extra.name, version: r.extra.version, chainId: 8453, verifyingContract: r.asset },
        types, primaryType: "TransferWithAuthorization",
        message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
        signature: p.payload.signature,
      });
    } catch {}
    return Response.json({ isValid: valid, payer: a.from, ...(!valid ? { invalidReason: "invalid_signature" } : {}) });
  }
  if (url.pathname === "/settle") {
    counts.settle++;
    if (workerData.concurrent) await new Promise(resolve => setTimeout(resolve, 25));
    return Response.json({ success: true, transaction: "0x" + "2".repeat(64), payer: body.paymentPayload.payload.authorization.from, network: body.paymentRequirements.network });
  }
  counts.other++; throw new Error("Unexpected facilitator path");
};
console.log = () => {};
console.warn = () => {};
try {
  const call = async () => {
    const response = await app.fetch(new Request("https://api.xguardgate.com" + (workerData.path || "/settle"), {
      method: "POST", headers: { "content-type": "application/json", "x-xguard-traffic-class": "synthetic", ...workerData.headers },
      body: workerData.rawBody ?? JSON.stringify(workerData.body),
    }), env, {});
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
  };
  const responses = await Promise.all(Array.from({ length: workerData.concurrent || 1 }, call));
  parentPort.postMessage({ ...responses[0], responses, counts, storage: snapshot, threadId });
} catch (error) { parentPort.postMessage({ error: error.message, counts }); }
