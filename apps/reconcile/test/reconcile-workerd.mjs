import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from "miniflare";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { bazaarResourceServerExtension, validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, verifyTypedData } from "viem";
import discovery from "../src/discovery.js";
import { runReconcileSmoke } from "../scripts/production-smoke.mjs";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const bundle = fileURLToPath(new URL("../.wrangler/build/discovery-entry.js", import.meta.url));
const ORIGIN = "https://reconcile.xguardgate.com";
const NETWORK = "eip155:8453";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = config.vars.XGUARD_TREASURY_USDC_ADDRESS;
const FROM = `0x${"1".repeat(40)}`;
const NONCE = `0x${"2".repeat(64)}`;
const TX = `0x${"3".repeat(64)}`;
const PAID_URL = `${ORIGIN}/v1/reconcile?from=${FROM}&nonce=${NONCE}`;
const authAbi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const eventAbi = parseAbi(["event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"]);
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
] };

// Only providers are simulated. Production Worker, SDK payment middleware,
// client signing, Bazaar metadata and EIP-712 signature verification are real.
// Every outbound request is intercepted; no funded keys or live settlements.
async function fixture(t, options = {}) {
  const state = { supported: 0, verify: 0, cryptographicallyVerified: 0, settle: 0, rpc: 0, order: [], logs: [], ...options };
  const bindings = { ...config.vars, X402_FACILITATOR: "https://facilitator.test", BASE_RPC_URL: "https://base-rpc.test", ...options.bindings };
  const mf = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: 0, cf: false,
    handleStructuredLogs: log => state.logs.push(log),
    workers: [{
      name: "reconcile-test", modules: true, scriptPath: bundle,
      compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
      bindings,
      outboundService: async request => {
        const url = new URL(request.url);
        const isCdp = url.hostname === "api.cdp.coinbase.com";
        if (url.hostname === "facilitator.test" || isCdp) {
          if (isCdp) assert.match(request.headers.get("authorization") || "", /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
          const action = url.pathname.split("/").at(-1);
          state.order.push(action);
          if (action === "supported") {
            state.supported++;
            return MFResponse.json({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: ["bazaar"], signers: {} });
          }
          const { paymentPayload, paymentRequirements } = await request.json();
          assert.equal(paymentRequirements.network, NETWORK);
          assert.equal(paymentRequirements.amount, "2000");
          assert.equal(paymentRequirements.asset.toLowerCase(), USDC.toLowerCase());
          assert.equal(paymentRequirements.payTo.toLowerCase(), TREASURY.toLowerCase());
          assert.equal(paymentPayload.resource.url, `${ORIGIN}/v1/reconcile`);
          const bazaar = paymentPayload.extensions.bazaar;
          assert.equal(validateDiscoveryExtensionSpec(bazaar).valid, true);
          assert.equal(validateDiscoveryExtension(bazaar).valid, true);
          assert.equal(bazaar.info.input.method, "GET");
          assert.deepEqual(bazaar.info.input.queryParams, discovery.bazaar.info.input.queryParams);
          const auth = paymentPayload.payload.authorization;
          if (action === "verify") {
            state.verify++;
            let valid = false;
            try {
              valid = auth.to.toLowerCase() === TREASURY.toLowerCase() && auth.value === "2000" &&
                Number(auth.validAfter) <= Date.now() / 1000 && Number(auth.validBefore) > Date.now() / 1000 &&
                await verifyTypedData({
                  address: auth.from,
                  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
                  types, primaryType: "TransferWithAuthorization",
                  message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) },
                  signature: paymentPayload.payload.signature
                });
            } catch { /* malformed signatures must be rejected */ }
            if (valid) state.cryptographicallyVerified++;
            return MFResponse.json({ isValid: valid && !state.rejectVerify, payer: auth.from, ...(!valid || state.rejectVerify ? { invalidReason: "invalid_signature" } : {}) });
          }
          assert.equal(action, "settle");
          assert.ok(state.cryptographicallyVerified > state.settle, "Settlement requires verified payment");
          state.settle++;
          if (state.rejectSettle) return MFResponse.json({ success: false, errorReason: "insufficient_funds", network: NETWORK, payer: auth.from, transaction: "" });
          return MFResponse.json({ success: true, network: NETWORK, transaction: TX, payer: auth.from });
        }
        assert.equal(url.hostname, "base-rpc.test", "No real provider/network access is permitted");
        const rpc = await request.json();
        state.order.push(`rpc:${rpc.method}`);
        state.rpc++;
        if (state.rpcFailure) return MFResponse.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "Isolated RPC outage" } });
        let result;
        if (rpc.method === "eth_call") {
          assert.equal(rpc.params[0].to.toLowerCase(), USDC.toLowerCase());
          const decoded = decodeFunctionData({ abi: authAbi, data: rpc.params[0].data });
          assert.equal(decoded.functionName, "authorizationState");
          assert.equal(decoded.args[0].toLowerCase(), FROM.toLowerCase());
          assert.equal(decoded.args[1], NONCE);
          result = encodeAbiParameters([{ type: "bool" }], [Boolean(state.used)]);
        } else if (rpc.method === "eth_blockNumber") result = "0x2710";
        else {
          assert.equal(rpc.method, "eth_getLogs");
          result = state.noLogs ? [] : [{
            address: USDC, blockHash: `0x${"4".repeat(64)}`, blockNumber: "0x270f", data: "0x",
            logIndex: "0x0", transactionHash: TX, transactionIndex: "0x0", removed: false,
            topics: encodeEventTopics({ abi: eventAbi, eventName: "AuthorizationUsed", args: { authorizer: FROM, nonce: NONCE } })
          }];
        }
        return MFResponse.json({ jsonrpc: "2.0", id: rpc.id, result });
      }
    }]
  }));
  t.after(async () => { await mf.dispose(); });
  await mf.ready;
  const fetch = (url, init) => mf.dispatchFetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const challenge = async (url = PAID_URL) => {
    const response = await fetch(url);
    assert.equal(response.status, 402);
    const required = decodePaymentRequiredHeader(response.headers.get("payment-required"));
    assert.equal(required.x402Version, 2);
    assert.equal(required.accepts[0].amount, "2000");
    assert.equal(required.accepts[0].network, NETWORK);
    assert.equal(required.accepts[0].asset.toLowerCase(), USDC.toLowerCase());
    assert.equal(required.accepts[0].payTo.toLowerCase(), TREASURY.toLowerCase());
    await response.text();
    return required;
  };
  const payment = async (url = PAID_URL) => {
    const payer = new x402Client().register(NETWORK, new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
    return payer.createPaymentPayload(await challenge(url));
  };
  const signed = (payload, url = PAID_URL, header = "payment-signature") => fetch(url, { headers: { [header]: encodePaymentSignatureHeader(payload) } });
  const noCompilerErrors = () => {
    assert.doesNotMatch(JSON.stringify(state.logs), /Error compiling schema|Code generation from strings|invalid bazaar extension|Unknown Bazaar schema/);
  };
  return { state, fetch, payment, signed, challenge, noCompilerErrors };
}

test("workerd: discovery and 404 never initialize payments, even without treasury", { timeout: 30000 }, async t => {
  const { state, fetch } = await fixture(t, { bindings: { XGUARD_TREASURY_USDC_ADDRESS: "" } });
  for (const path of ["/", "/healthz", "/docs", "/openapi.json", "/.well-known/x402", "/.well-known/x402.json", "/robots.txt", "/sitemap.xml", "/llms.txt"]) {
    const response = await fetch(`${ORIGIN}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0);
  }
  assert.equal((await fetch(`${ORIGIN}/`, { method: "HEAD" })).status, 200);
  for (const [path, method] of [["/unknown", "GET"], ["/unknown", "POST"], ["/docs", "POST"], ["/v1/reconcile", "HEAD"], ["/v1/reconcile", "POST"], ["/v1/reconcile", "OPTIONS"], ["/v1/reconcile/", "GET"]]) {
    const response = await fetch(`${ORIGIN}${path}`, { method, headers: { "payment-signature": "forged" } });
    assert.equal(response.status, 404, `${method} ${path}`);
    await response.text();
  }
  assert.equal(state.supported + state.verify + state.settle + state.rpc, 0);
  const missing = await fetch(`${ORIGIN}/v1/reconcile`);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, "payment_not_configured");
});

test("workerd: discovery challenge, signed bare retries and invalid input keep their contracts", { timeout: 30000 }, async t => {
  const { state, fetch } = await fixture(t);
  const bare = await fetch(`${ORIGIN}/v1/reconcile`);
  assert.equal(bare.status, 402);
  const required = decodePaymentRequiredHeader(bare.headers.get("payment-required"));
  assert.equal(required.accepts[0].amount, "2000");
  assert.equal(required.accepts[0].asset.toLowerCase(), USDC.toLowerCase());
  assert.equal(required.accepts[0].network, NETWORK);
  assert.match(required.resource.url, /from=0x.*&nonce=0x/);
  await bare.text();
  for (const url of [`${ORIGIN}/v1/reconcile`, `${ORIGIN}/v1/reconcile?from=bad&nonce=${NONCE}`, `${ORIGIN}/v1/reconcile?from=${FROM}`, `${ORIGIN}/v1/reconcile?nonce=${NONCE}`]) {
    const response = await fetch(url, { headers: { "payment-signature": "forged" } });
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.equal(state.supported + state.verify + state.settle + state.rpc, 0);
});

test("workerd: full-query 402 preserves Bazaar, price and the official client contract", { timeout: 30000 }, async t => {
  const { state, challenge, fetch, noCompilerErrors } = await fixture(t);
  const required = await challenge();
  assert.equal(required.resource.serviceName, "XGuard Reconcile");
  assert.deepEqual(required.resource.tags, ["x402", "reconciliation", "base", "usdc", "eip-3009"]);
  assert.equal(validateDiscoveryExtension(required.extensions.bazaar).valid, true);
  assert.equal(validateDiscoveryExtensionSpec(required.extensions.bazaar).valid, true);
  const document = await (await fetch(`${ORIGIN}/.well-known/x402.json`)).json();
  assert.equal(document.resources[0].accepts[0].amount, required.accepts[0].amount);
  assert.equal(document.resources[0].accepts[0].payTo, required.accepts[0].payTo);
  assert.deepEqual(document.resources[0].extensions.bazaar.info, required.extensions.bazaar.info);
  assert.equal(state.supported, 1);
  assert.equal(state.verify + state.settle + state.rpc, 0);
  noCompilerErrors();
});

for (const [name, mode, expected] of [
  ["unused nonce", {}, { authorization_used: false, settlement: "not_observed", safe_to_retry_same_authorization: true }],
  ["observed settlement", { used: true }, { authorization_used: true, settlement: "observed", transaction: TX, safe_to_retry_same_authorization: false }],
  ["consumed nonce without recent log", { used: true, noLogs: true }, { authorization_used: true, settlement: "nonce_consumed_tx_not_found_in_window", transaction: null, safe_to_retry_same_authorization: false }]
]) {
  test(`workerd: paid 200 for ${name} requires verification and settlement`, { timeout: 30000 }, async t => {
    const { state, payment, signed, noCompilerErrors } = await fixture(t, mode);
    const response = await signed(await payment());
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    for (const [key, value] of Object.entries(expected)) assert.equal(body[key], value);
    assert.equal(body.network, NETWORK);
    assert.equal(body.asset.toLowerCase(), USDC.toLowerCase());
    const receipt = decodePaymentResponseHeader(response.headers.get("payment-response"));
    assert.equal(receipt.success, true);
    assert.equal(receipt.transaction, TX);
    assert.equal(receipt.network, NETWORK);
    assert.equal(state.verify, 1);
    assert.equal(state.cryptographicallyVerified, 1);
    assert.equal(state.settle, 1);
    assert.ok(state.order.indexOf("verify") < state.order.indexOf("rpc:eth_call"));
    assert.ok(state.order.indexOf("rpc:eth_call") < state.order.indexOf("settle"));
    noCompilerErrors();
  });
}

test("workerd: malformed and tampered payments never deliver results or settle", { timeout: 30000 }, async t => {
  const { state, fetch, payment, signed, noCompilerErrors } = await fixture(t);
  const valid = await payment();
  const variants = [
    p => { p.payload.signature = `0x${"0".repeat(130)}`; },
    p => { p.payload.authorization.value = "1"; },
    p => { p.accepted.amount = "1"; },
    p => { p.accepted.network = "eip155:1"; },
    p => { p.accepted.payTo = FROM; }
  ];
  for (const mutate of variants) {
    const payload = structuredClone(valid); mutate(payload);
    const response = await signed(payload);
    assert.equal(response.status, 402);
    assert.equal(response.headers.has("payment-response"), false);
    assert.doesNotMatch(await response.text(), /authorization_used/);
  }
  for (const value of ["not-base64", Buffer.from("{}").toString("base64")]) {
    const response = await fetch(PAID_URL, { headers: { "payment-signature": value } });
    assert.equal(response.status, 402);
    await response.text();
  }
  assert.equal(state.rpc + state.settle, 0);
  noCompilerErrors();
});

test("workerd: facilitator verification refusal blocks RPC and settlement", { timeout: 30000 }, async t => {
  const { state, payment, signed } = await fixture(t, { rejectVerify: true });
  const response = await signed(await payment());
  assert.equal(response.status, 402);
  await response.text();
  assert.equal(state.verify, 1);
  assert.equal(state.rpc + state.settle, 0);
});

test("workerd: RPC 503 cancels settlement after verification", { timeout: 30000 }, async t => {
  const { state, payment, signed } = await fixture(t, { rpcFailure: true });
  const response = await signed(await payment());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "base_rpc_unavailable");
  assert.equal(state.verify, 1);
  assert.ok(state.rpc > 0);
  assert.equal(state.settle, 0);
  assert.equal(response.headers.has("payment-response"), false);
});

test("workerd: settlement refusal withholds the successful RPC result", { timeout: 30000 }, async t => {
  const { state, payment, signed } = await fixture(t, { rejectSettle: true });
  const response = await signed(await payment());
  assert.equal(response.status, 402);
  assert.doesNotMatch(await response.text(), /authorization_used/);
  assert.equal(state.verify, 1);
  assert.equal(state.settle, 1);
  const header = response.headers.get("payment-response");
  if (header) assert.equal(decodePaymentResponseHeader(header).success, false);
});

test("workerd: authorizer alias retains paid behavior and unsigned retries stay unpaid", { timeout: 30000 }, async t => {
  const { state, payment, signed, fetch, noCompilerErrors } = await fixture(t);
  const alias = PAID_URL.replace("?from=", "?authorizer=");
  const response = await signed(await payment(alias), alias);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authorizer.toLowerCase(), FROM.toLowerCase());
  assert.equal(state.verify, 1);
  assert.equal(state.settle, 1);
  assert.equal((await fetch(`${ORIGIN}/unknown`)).status, 404);
  await (await fetch(PAID_URL)).text();
  assert.equal(state.supported, 1, "The initialized payment app remains cached");
  assert.equal(state.settle, 1, "Unsigned requests never settle");
  noCompilerErrors();
});

test("workerd: a v2 payload in legacy x-payment cannot bypass PAYMENT-SIGNATURE", { timeout: 30000 }, async t => {
  const { state, payment, signed } = await fixture(t);
  const response = await signed(await payment(), PAID_URL, "x-payment");
  assert.equal(response.status, 402);
  await response.text();
  assert.equal(state.verify + state.settle + state.rpc, 0);
});

test("workerd: Coinbase CDP auth, Bazaar publication readiness and paid flow are preserved", { timeout: 30000 }, async t => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const secret = Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
  const { state, payment, signed, fetch, noCompilerErrors } = await fixture(t, { bindings: { CDP_API_KEY_ID: "organizations/fixture/apiKeys/fixture", CDP_API_KEY_SECRET: secret } });
  const docs = await (await fetch(`${ORIGIN}/docs`)).json();
  assert.equal(docs.facilitator_mode, "coinbase_cdp");
  assert.equal(docs.bazaar_publish_ready, true);
  const response = await signed(await payment());
  assert.equal(response.status, 200, await response.clone().text());
  await response.text();
  assert.equal(state.verify, 1);
  assert.equal(state.settle, 1);
  noCompilerErrors();
});

test("workerd: static validators run while dynamic evaluation is blocked", { timeout: 30000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, cf: false, workers: [{
    name: "validator-probe",
    modulesRoot: fileURLToPath(new URL("../", import.meta.url)),
    modules: ["test/validator-worker.js", "src/ajv2020-standalone.js", "src/schema-key.js", "src/generated/bazaar-validators.js"].map(path => ({
      type: "ESModule", path: fileURLToPath(new URL(`../${path}`, import.meta.url))
    })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags
  }] }));
  t.after(async () => { await mf.dispose(); });
  await mf.ready;
  for (const extension of [discovery.bazaar, bazaarResourceServerExtension.enrichDeclaration(discovery.bazaar, { method: "GET", routePattern: "/v1/reconcile", adapter: { getPath: () => "/v1/reconcile" } })]) {
    const info = { ...extension.info, input: { ...extension.info.input, method: "GET" } };
    const response = await mf.dispatchFetch("https://validator.test", { method: "POST", body: JSON.stringify({ schema: extension.schema, info }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { codeGenerationBlocked: true, valid: true, errors: null });
    info.input.queryParams = { from: "invalid", nonce: "invalid" };
    const invalid = await mf.dispatchFetch("https://validator.test", { method: "POST", body: JSON.stringify({ schema: extension.schema, info }) });
    const body = await invalid.json();
    assert.equal(body.codeGenerationBlocked, true);
    assert.equal(body.valid, false);
    assert.equal(body.errors.length, 2);
  }
  const unknown = await mf.dispatchFetch("https://validator.test", { method: "POST", body: JSON.stringify({ schema: {}, info: {} }) });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /Unknown Bazaar schema/);
});

test("workerd: production smoke verifies the exact revision without executing or settling", { timeout: 30000 }, async t => {
  const tag = "git-0123456789ab";
  const { state, fetch, noCompilerErrors } = await fixture(t, { bindings: { CF_VERSION_METADATA: { id: "fixture", tag } } });
  const result = await runReconcileSmoke({ expectedTag: tag, fetchImpl: fetch });
  assert.equal(result.reconcile_production_smoke, "passed");
  assert.equal(result.checks, 15);
  assert.equal(state.verify + state.settle + state.rpc, 0);
  noCompilerErrors();
});
