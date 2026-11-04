import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { Miniflare, Response } from "miniflare";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const site = "https://xguardgate.com";
const path = "/fact/npm/react/latest-version";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const payTo = "0x" + "22".repeat(20);
// Deterministic unfunded fixture key. No network route uses a real wallet.
const buyer = privateKeyToAccount("0x" + "11".repeat(32));
const otherBuyer = privateKeyToAccount("0x" + "33".repeat(32));
const blockHash = "0x" + "44".repeat(32);
const txHash = "0x" + "55".repeat(32);
const authEvent = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const baseTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "xguard-do-"));
  const opts = { noVerify: true, durableObjectsPersist: dir };
  const calls = { verify: 0, settle: 0, origin: 0, getLogs: 0 };
  const modes = { failOrigin: false, verifyInvalid: false, lostSettle: false,
    mismatch: false, reorg: false, chainId: "0x2105", latest: "0x128", ttlTest: false };
  let authorization;
  const log = (index, topics, data) => ({
    address: usdc, topics, data, blockNumber: "0x110", blockHash, transactionHash: txHash,
    transactionIndex: "0x0", logIndex: "0x" + index.toString(16), removed: false,
  });
  function logs() {
    if (!authorization || !calls.settle) return [];
    const used = log(0, encodeEventTopics({ abi: [authEvent], eventName: "AuthorizationUsed",
      args: { authorizer: authorization.from, nonce: authorization.nonce } }), "0x");
    const moved = (index, to) => log(index, encodeEventTopics({ abi: [transferEvent], eventName: "Transfer",
      args: { from: authorization.from, to } }), encodeAbiParameters([{ type: "uint256" }], [1000n]));
    return modes.mismatch ? [used, moved(1, otherBuyer.address), moved(2, payTo)] : [used, moved(1, payTo)];
  }
  opts.workers = [
    {
      name: "gateway", modules: true, scriptPath: "dist/xguard-gateway.js",
      compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      bindings: { GATEWAY_ENABLED: "true", PUBLIC_ORIGIN: site, MERCHANT_ID: "xguard-live",
        PAY_TO: payTo, BASE_RPC_URL: "https://base-rpc.invalid", BASE_CONFIRMATIONS: "12",
        WEB2_TOKEN_SECRET: Buffer.alloc(32, 17).toString("base64url") },
      durableObjects: { XGUARD_STATE: { className: "XGuardState", useSQLite: true } },
      serviceBindings: {
        XGUARD_ORIGIN: async (request) => {
          calls.origin++;
          assert.equal(new URL(request.url).hostname, "xguard-origin.internal");
          assert.equal(request.headers.has("authorization"), false);
          assert.equal(request.headers.has("payment-signature"), false);
          assert.equal(request.headers.has("cookie"), false);
          if (modes.failOrigin) return Response.json({ sensitive: "never-forward-error" }, { status: 503 });
          return Response.json({ verified_fact: "fixture fact", path: new URL(request.url).pathname });
        },
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.origin === "https://facilitator.xpay.sh") {
          const input = await request.json();
          assert.equal(input.x402Version, 2);
          assert.equal(input.paymentRequirements.amount, "1000");
          assert.equal(input.paymentRequirements.network, "eip155:8453");
          authorization = input.paymentPayload.payload.authorization;
          if (url.pathname === "/verify") {
            calls.verify++;
            modes.submissionPending = true;
            return Response.json({ isValid: !modes.verifyInvalid, payer: authorization.from });
          }
          assert.equal(url.pathname, "/settle");
          calls.settle++;
          modes.submissionPending = false;
          if (modes.lostSettle) return Response.json({ error: "lost_response" }, { status: 503 });
          return Response.json({ success: true, transaction: txHash, network: "eip155:8453" });
        }
        assert.equal(url.origin, "https://base-rpc.invalid");
        const rpc = await request.json();
        const results = {
          eth_chainId: () => modes.chainId,
          eth_blockNumber: () => modes.submissionPending ? "0x108" : modes.latest,
          eth_getBlockByNumber: () => ({ number: "0x110", hash: modes.reorg ? txHash : blockHash, transactions: [] }),
          eth_getTransactionReceipt: () => !calls.settle ? null : ({
            transactionHash: txHash, transactionIndex: "0x0", status: "0x1", type: "0x2",
            blockNumber: "0x110", blockHash, from: buyer.address, to: usdc,
            cumulativeGasUsed: "0x9000", gasUsed: "0x9000", effectiveGasPrice: "0x1",
            contractAddress: null, logsBloom: "0x" + "00".repeat(256), logs: logs(),
          }),
          eth_getLogs: () => { calls.getLogs++; return logs().slice(0, 1); },
        };
        assert.ok(results[rpc.method], "Unexpected RPC " + rpc.method);
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result: results[rpc.method]() });
      },
    },
    {
      name: "billing-fixture", modules: true, compatibilityDate: "2026-07-30",
      serviceBindings: { CREDITS: { name: "gateway", entrypoint: "XGuardCredits" } },
      script: 'export default {async fetch(r,e){const i=await r.json();return Response.json(i.paymentId?await e.CREDITS.credit(i):await e.CREDITS.issueToken(i));}}',
    },
  ];
  let mf = new Miniflare(opts);
  t.after(async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  const request = (p = path, headers = {}) => mf.dispatchFetch(site + p, { headers });
  const control = async (data) => {
    const worker = await mf.getWorker("billing-fixture");
    const reply = await worker.fetch("https://billing-test.invalid/", { method: "POST", body: JSON.stringify(data) });
    assert.equal(reply.status, 200, reply.status !== 200 ? await reply.text() : undefined);
    return reply.json();
  };
  async function proof(idem = "order-base-0001", p = path, mutate, signer = buyer) {
    const unsigned = await request(p);
    assert.equal(unsigned.status, 402);
    const offer = JSON.parse(Buffer.from(unsigned.headers.get("payment-required"), "base64"));
    assert.equal(offer.accepts[0].amount, "1000");
    assert.equal(offer.resource.url, site + p);
    const now = Math.floor(Date.now() / 1000);
    const auth = { from: buyer.address, to: payTo, value: "1000", validAfter: String(now - 30),
      validBefore: String(now + 240), nonce: "0x" + crypto.randomUUID().replaceAll("-", "").repeat(2) };
    const signature = await signer.signTypedData({
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: usdc },
      primaryType: "TransferWithAuthorization", types: baseTypes,
      message: { ...auth, value: 1000n, validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) },
    });
    const payment = { x402Version: 2, accepted: offer.accepts[0], resource: offer.resource,
      payload: { authorization: auth, signature } };
    mutate?.(payment);
    return { "Payment-Signature": Buffer.from(JSON.stringify(payment)).toString("base64"), "Idempotency-Key": idem };
  }
  async function restart() { await mf.dispose(); mf = new Miniflare(opts); }
  return { request, control, calls, modes, proof, restart };
}

test("unpaid, malformed, unsafe routes and ambiguous credentials never reach origin", async (t) => {
  const f = await fixture(t);
  for (const p of [path, "/live/npm/react", "/history/npm/react/latest-version", "/healthz", "/status", "/topics", "/changes"]) {
    assert.equal((await f.request(p)).status, 402);
  }
  for (const p of ["/admin", "/v1/settle", "/internal/credit", "/api/paid/v1/catalog", "/sitemap.xml"]) {
    assert.equal((await f.request(p)).status, 404);
  }
  assert.equal((await f.request(path, { "Payment-Signature": "invalid", "Idempotency-Key": "bad-sig-0001" })).status, 402);
  assert.equal((await f.request(path, { Authorization: "Bearer bad", "Payment-Signature": "bad", "Idempotency-Key": "bad-both-0001" })).status, 402);
  assert.deepEqual(f.calls, { verify: 0, settle: 0, origin: 0, getLogs: 0 });
});

test("wrong signature, altered amount, and facilitator rejection fail closed", async (t) => {
  const f = await fixture(t);
  const wrong = await f.proof("invalid-signer", path, undefined, otherBuyer);
  assert.equal((await f.request(path, wrong)).status, 402);
  const changed = await f.proof("invalid-amount", path, (p) => { p.payload.authorization.value = "2000"; });
  assert.equal((await f.request(path, changed)).status, 402);
  assert.equal(f.calls.verify, 0);
  f.modes.verifyInvalid = true;
  const denied = await f.request(path, await f.proof());
  assert.equal(denied.status, 402);
  assert.equal(f.calls.verify, 1);
  assert.equal(f.calls.origin, 0);
  assert.equal(f.calls.settle, 0);
});

test("48 parallel same-nonce requests settle once; cache survives workerd restart", async (t) => {
  const f = await fixture(t);
  const headers = await f.proof();
  const start = performance.now();
  const replies = await Promise.all(Array.from({ length: 48 }, () => f.request(path, headers)));
  t.diagnostic("48 local requests completed in " + (performance.now() - start).toFixed(1) + " ms (not production latency)");
  assert.equal(replies.filter((r) => r.status === 200 && r.headers.get("x-xguard-replayed") === "0").length, 1);
  assert.ok(replies.every((r) => [200, 503].includes(r.status)));
  assert.deepEqual(f.calls, { verify: 1, settle: 1, origin: 1, getLogs: 0 });
  const first = replies.find((r) => r.status === 200);
  const payment = JSON.parse(Buffer.from(first.headers.get("payment-response"), "base64"));
  assert.equal(payment.transaction, txHash);
  assert.equal((await first.json()).verified_fact, "fixture fact");
  assert.equal((await f.request(path, { ...headers, "Idempotency-Key": "changed-order-1" })).status, 409);
  assert.equal((await f.request(path, await f.proof())).status, 409);
  await f.restart();
  const restored = await f.request(path, headers);
  assert.equal(restored.status, 200);
  assert.equal(restored.headers.get("x-xguard-replayed"), "1");
  assert.equal(f.calls.settle, 1);
  assert.equal(f.calls.origin, 1);
});

test("lost settlement response is reconciled by on-chain authorization nonce without resubmission", async (t) => {
  const f = await fixture(t);
  f.modes.lostSettle = true;
  const headers = await f.proof();
  const pending = await f.request(path, headers);
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get("payment-response"), null);
  assert.equal((await pending.json()).error, "settlement_unconfirmed_retry_original");
  await sleep(5200);
  const retry = await f.request(path, headers);
  assert.equal(retry.status, 200);
  assert.equal(f.calls.getLogs, 1);
  assert.equal(f.calls.settle, 1);
  assert.equal(f.calls.origin, 1);
});

test("wrong-chain RPC, reorg and unpaired token logs cannot prove payment", async (t) => {
  const f = await fixture(t);
  f.modes.chainId = "0x1";
  assert.equal((await f.request(path, await f.proof("wrong-chain-1"))).status, 503);
  assert.equal(f.calls.origin, 0);
  f.modes.chainId = "0x2105";
  f.modes.mismatch = true;
  assert.equal((await f.request(path, await f.proof("wrong-pair-01"))).status, 503);
  f.modes.mismatch = false;
  f.modes.reorg = true;
  assert.equal((await f.request(path, await f.proof("wrong-block-1"))).status, 503);
  assert.equal(f.calls.settle, 2);
});

test("failed origin read does not settle and its response body stays private", async (t) => {
  const f = await fixture(t);
  f.modes.failOrigin = true;
  const headers = await f.proof();
  const rejected = await f.request(path, headers);
  assert.equal(rejected.status, 502);
  assert.equal((await rejected.text()).includes("never-forward-error"), false);
  assert.equal(f.calls.settle, 0);
  f.modes.failOrigin = false;
  assert.equal((await f.request(path, headers)).status, 200);
  assert.equal(f.calls.settle, 1);
});

test("provider-ID credit dedup, credit holds under concurrency, and tamper rejection", async (t) => {
  const f = await fixture(t);
  const user = { wallet: buyer.address, merchant: "xguard-live", account: "account-001" };
  const grant = { ...user, provider: "stripe", paymentId: "pi_fixture_001", amount: 1000 };
  assert.equal(await f.control(grant), "credited");
  assert.equal(await f.control(grant), "duplicate");
  assert.equal(await f.control({ ...grant, wallet: otherBuyer.address }), "conflict");
  const token = await f.control(user);
  const bearer = { Authorization: "Bearer " + token };
  assert.equal((await f.request(path, { Authorization: "Bearer " + token + "x", "Idempotency-Key": "tampered-001" })).status, 402);
  assert.equal(f.calls.origin, 0);
  const answers = await Promise.all(Array.from({ length: 24 }, (_, n) => f.request(path, { ...bearer, "Idempotency-Key": "credits-order-" + n })));
  assert.equal(answers.filter((r) => r.status === 200).length, 1);
  assert.equal(answers.filter((r) => r.status === 402).length, 23);
  const index = answers.findIndex((r) => r.status === 200);
  const replay = await f.request(path, { ...bearer, "Idempotency-Key": "credits-order-" + index });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-xguard-replayed"), "1");
  assert.equal(f.calls.origin, 1);
  assert.equal(f.calls.settle, 0);
});

test("credit reservation releases on failed delivery; unused credit funds a different request", async (t) => {
  const f = await fixture(t);
  const user = { wallet: buyer.address, merchant: "xguard-live", account: "account-002" };
  await f.control({ ...user, provider: "lemon_squeezy", paymentId: "order_fixture_002", amount: 1000 });
  const token = await f.control(user);
  f.modes.failOrigin = true;
  const query = (key) => f.request(path, { Authorization: "Bearer " + token, "Idempotency-Key": key });
  assert.equal((await query("failed-read-1")).status, 502);
  f.modes.failOrigin = false;
  assert.equal((await query("retry-other-1")).status, 200);
  assert.equal((await query("no-more-credit")).status, 402);
  assert.equal(f.calls.origin, 2);
});
