import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { canonicalize } from "@x402/extensions/offer-receipt";
import app, { PaidGatewayState, ProofAuthority } from "./canonical-entry.js";
import { normalizeOutcome } from "./outcome-catalog.js";
import { extractFeed, extractDocument, extractOffers } from "./outcome-engine.js";
import { digestBytes } from "./core/execution-contract.js";
import { createXGuardOutcomeClient } from "../../../sdk/outcomes.js";

// These tests cross a real HTTP socket into production handlers and use real
// quote/receipt cryptography. DNS, source responses, facilitator and storage are
// controlled fixtures. A successful simulated settlement is NOT a blockchain payment.
class Storage {
  values = new Map();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k, v) { this.values.set(k, structuredClone(v)); }
  async delete(k) { return this.values.delete(k); }
  async setAlarm(v) { this.alarm = v; }
  async transaction(fn) { return fn(this); }
}
function namespace(Class, env) {
  const objects = new Map();
  return { idFromName: n => n, get(id) {
    if (!objects.has(id)) {
      const object = new Class({ storage: new Storage() }, env);
      let pending = Promise.resolve();
      objects.set(id, { fetch(input, init) {
        const next = pending.then(() => object.fetch(input instanceof Request ? input : new Request(input, init)));
        pending = next.catch(() => {}); return next;
      } });
    }
    return objects.get(id);
  } };
}
const PAYEE = "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07";
const PAYER = "0x1111111111111111111111111111111111111111";
const JSON_HEADERS = { "content-type": "application/json" };
const fixture = (price = "12.50", currency = "USD", gtin = "0123456789012") => `<html><head><title>Field notebook</title><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Field notebook", gtin13: gtin, offers: { "@type": "Offer", price, priceCurrency: currency } })}</script></head><body><nav>Ignore menu</nav><main><h1>Field notebook</h1><p>Recycled paper.</p></main></body></html>`;
const rss = `<rss version="2.0"><channel><title>News</title><item><title>New release</title><link>https://example.org/release?utm_source=feed</link><pubDate>Wed, 09 Sep 2026 05:00:00 GMT</pubDate><description>A public release.</description></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>New release</title><link href="https://example.org/release"/><updated>2026-09-09T05:00:00Z</updated><summary>A public release.</summary></entry><entry><title>Another update</title><link href="https://example.org/other"/><published>2026-09-08T04:00:00Z</published></entry></feed>`;

async function harness(t, options = {}) {
  const env = { XGUARD_PAYMENT_ENVIRONMENT: "production", XGUARD_PAID_FACILITATOR: "https://facilitator.test",
    XGUARD_TESTNET_FACILITATOR: "https://facilitator.test", XGUARD_TREASURY_USDC_ADDRESS: PAYEE, XGUARD_TESTNET_PAY_TO: PAYEE,
    XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: "100", XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: "0", XGUARD_MIN_CONTRIBUTION_BPS: "2000" };
  env.PROOF_AUTHORITY = namespace(ProofAuthority, env); env.PAID_GATEWAY = namespace(PaidGatewayState, env);
  const counts = { verify: 0, settle: 0, upstream: 0, posts: 0 };
  const original = globalThis.fetch;
  const originals = { log: console.log };
  const logs = [];
  console.log = (...x) => logs.push(x.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return original(input, init);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: options.privateDns ? "127.0.0.1" : "93.184.216.34" }] : [] }), { headers: JSON_HEADERS });
    if (url.hostname === "facilitator.test") {
      const body = JSON.parse(init.body);
      if (url.pathname === "/verify") { counts.verify++; return new Response(JSON.stringify({ isValid: !options.rejectPayment, payer: PAYER }), { headers: JSON_HEADERS }); }
      counts.settle++;
      return new Response(JSON.stringify({ success: true, payer: PAYER, transaction: `0x${"2".repeat(64)}`, network: body.paymentRequirements.network }), { headers: JSON_HEADERS });
    }
    counts.upstream++; assert.ok(counts.settle > 0, "No paid source access before a verified settlement");
    if (options.source) return options.source(url, init);
    if (url.hostname === "failed.example.org") return new Response("Temporary failure", { status: 503, headers: { "content-type": "text/plain" } });
    if (url.pathname.endsWith(".rss")) return new Response(rss, { headers: { "content-type": "application/rss+xml" } });
    if (url.pathname.endsWith(".atom")) return new Response(atom, { headers: { "content-type": "application/atom+xml" } });
    return new Response(fixture(url.hostname === "backup.example.org" ? "10.00" : "12.50"), { headers: { "content-type": "text/html", "cache-control": "private, no-store" } });
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const b of req) chunks.push(b);
      const headers = new Headers(req.headers);
      const host = headers.get("x-test-site") === "site" ? "xguardgate.com" : "api.xguardgate.com";
      const request = new Request(`https://${host}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await app.fetch(request, env, {});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500, JSON_HEADERS); res.end(JSON.stringify({ error: error.stack })); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { globalThis.fetch = original; console.log = originals.log; await new Promise(r => server.close(r)); });
  const request = (path, body, headers = {}) => original(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...JSON_HEADERS, "x-xguard-traffic-class": "synthetic", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let nonce = 0;
  const payload = challenge => ({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0],
    payload: { signature: `0x${"1".repeat(130)}`, authorization: { from: PAYER, to: challenge.accepts[0].payTo, value: challenge.accepts[0].amount,
      validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${(++nonce).toString(16).padStart(64, "0")}` } }, extensions: challenge.extensions });
  const buy = async body => {
    const challengeResponse = await request("/v1/execute", body); const challenge = await challengeResponse.json();
    assert.equal(challengeResponse.status, 402, JSON.stringify(challenge));
    const quote = challengeResponse.headers.get("x-xguard-quote");
    const proof = payload(challenge);
    const headers = { "x-xguard-quote": quote, "payment-signature": encodePaymentSignatureHeader(proof) };
    return { response: await request("/v1/execute", body, headers), quote, proof, headers, challenge };
  };
  return { env, counts, request, payload, buy, base, logs };
}

test("FLOW 1 and 7: anonymous root discovery reaches a free useful extraction in two HTTP requests", async t => {
  const h = await harness(t);
  const root = await (await h.request("/")).json();
  assert.equal(root.first_result.url, "https://api.xguardgate.com/v1/execute");
  const result = await (await h.request(new URL(root.first_result.url).pathname, root.first_result.body)).json();
  assert.equal(result.ok, true); assert.equal(result.cost.amount_atomic, "0"); assert.equal(result.result.network_calls, 0);
  assert.match(result.result.document.text, /Field|Sample/); assert.ok(result.result.offers.length);
  const catalog = await (await h.request("/v1/capabilities")).json();
  assert.deepEqual(catalog.capabilities.map(x => x.id), ["extract-preview", "web-extraction", "product-offers", "feed-digest"]);
  for (const item of catalog.capabilities) { assert.equal(item.availability, "live"); assert.ok(item.input_schema); assert.ok(item.output_schema); assert.ok(item.pricing.amount_atomic); }
  assert.equal(h.counts.upstream, 0); assert.equal(h.counts.settle, 0);
});

test("FLOW 2: automatic price/payment/retry produces a signed aggregate; exact replay and recovery do not charge again", async t => {
  const h = await harness(t);
  const client = createXGuardOutcomeClient({ baseUrl: h.base, maxAmountAtomic: "6000", headers: { "x-xguard-traffic-class": "synthetic" }, payer: { createPaymentPayload: async c => h.payload(c) } });
  const result = await client.execute({ intent: "Compare product offers", urls: ["https://source.example.org/item", "https://backup.example.org/item"] });
  assert.equal(result.ok, true); assert.equal(result.result.offers.length, 2);
  assert.equal(result.result.comparable_groups[0].lowest_observed_price, "10.00");
  assert.equal(result.verification.content_truth_verified, false);
  assert.equal(result.verification.result_sha256, await digestBytes(canonicalize(result.result)));
  assert.ok(result.receipt.signature); assert.ok(result.verification.signed_proof);
  const verified = await (await h.request("/v1/proofs/verify", { proof: result.verification.signed_proof })).json();
  assert.equal(verified.valid, true);
  const recovered = await client.getResult(result.recovery);
  assert.equal(recovered.replay, true); assert.deepEqual(recovered.result, result.result);
  assert.equal(h.counts.settle, 1); assert.equal(h.counts.upstream, 2);
  const unauthorized = await h.request(`/v1/results/${result.payment_identifier}`); assert.equal(unauthorized.status, 403);
  const metrics = await (await h.request("/v1/metrics")).json(); assert.equal(metrics.real_revenue_usd_micros, 0);
});

test("FLOW 3: malformed intent supplies a machine repair which succeeds; supported envelopes normalize equivalently", async t => {
  const h = await harness(t);
  const invalid = await h.request("/v1/execute", {}); assert.equal(invalid.status, 422);
  const problem = await invalid.json(); const repaired = await h.request("/v1/execute", problem.repair.suggested_request);
  assert.equal(repaired.status, 200);
  const expected = normalizeOutcome({ intent: "Extract page", url: "https://example.org/" }).input;
  for (const raw of ["Extract https://example.org/", { intent: { action: "extract", url: "https://example.org/" } },
    { operation: { method: "GET", url: "https://example.org/", action: "extract" } },
    { name: "xguard_execute", arguments: { intent: "Extract page", url: "https://example.org/" } },
    { task: { message: { parts: [{ text: "Extract https://example.org/" }] } } },
    { http: { method: "GET", url: "https://example.org/", action: "extract" } }, { command: "curl -X GET 'https://example.org/'" }]) assert.deepEqual(normalizeOutcome(raw).input, expected);
  for (const raw of [{ intent: "extract", url: "https://127.0.0.1/" }, { intent: "extract", url: "https://example.org:8443/" },
    { intent: "extract", url: "https://example.org/", method: "POST" }, { command: "curl https://example.org/; whoami" },
    { intent: "extract", input: {}, arguments: {} }, { capability: "imaginary-tool" }]) assert.equal(normalizeOutcome(raw).ok, false);
});

test("FLOW 4: source A failure selects B; subsequent routing uses measured success instead of repeating the failed primary", async t => {
  const h = await harness(t);
  const body = { intent: "Extract page", sources: [{ url: "https://failed.example.org/", fallbacks: ["https://backup.example.org/"] }] };
  const first = await h.buy(body); assert.equal(first.response.status, 200, await first.response.clone().text());
  const one = await first.response.json(); assert.equal(one.result.sources[0].used_fallback, true); assert.equal(one.result.routing.attempts.length, 2);
  const second = await h.buy(body); const two = await second.response.json();
  assert.equal(two.result.routing.attempts.length, 1); assert.equal(two.result.sources[0].url, "https://backup.example.org/");
});

test("FLOW 5: wrong amount/network/asset/recipient/intent and replayed authorization never authorize a different execution", async t => {
  const h = await harness(t); const body = { intent: "Extract page", url: "https://source.example.org/" };
  const challengeResponse = await h.request("/v1/execute", body); const challenge = await challengeResponse.json();
  const quote = challengeResponse.headers.get("x-xguard-quote"); const payload = h.payload(challenge);
  for (const [field, wrong] of [["amount", "1"], ["network", "eip155:1"], ["payTo", PAYER], ["asset", PAYER]]) {
    const broken = structuredClone(payload); broken.accepted[field] = wrong;
    const response = await h.request("/v1/execute", body, { "x-xguard-quote": quote, "payment-signature": encodePaymentSignatureHeader(broken) });
    assert.equal(response.status, 400); assert.equal(h.counts.upstream, 0); assert.equal(h.counts.settle, 0);
  }
  const headers = { "x-xguard-quote": quote, "payment-signature": encodePaymentSignatureHeader(payload) };
  for (const [field, wrong] of [["value", "1"], ["to", PAYER], ["validBefore", "1"], ["validAfter", "9999999999"]]) {
    const broken = structuredClone(payload); broken.payload.authorization[field] = wrong;
    const response = await h.request("/v1/execute", body, { "x-xguard-quote": quote, "payment-signature": encodePaymentSignatureHeader(broken) });
    assert.equal(response.status, 400); assert.equal(h.counts.settle, 0);
  }
  const environmentSwitch = await h.request("/v1/execute", { ...body, testnet: true }, headers); assert.equal(environmentSwitch.status, 400);
  const wrongIntent = await h.request("/v1/execute", { ...body, capability: "product-offers" }, headers); assert.equal(wrongIntent.status, 400);
  const changedFreshness = await h.request("/v1/execute", { ...body, max_age_seconds: 60 }, headers); assert.equal(changedFreshness.status, 400);
  const paid = await h.request("/v1/execute", body, headers); assert.equal(paid.status, 200, await paid.clone().text());
  const replay = await h.request("/v1/execute", body, headers); assert.equal(replay.status, 200); assert.equal((await replay.json()).replay, true);
  const other = { ...body, url: "https://source.example.org/another" };
  const challengeTwoResponse = await h.request("/v1/execute", other); const challengeTwo = await challengeTwoResponse.json();
  const nonceReplay = h.payload(challengeTwo); nonceReplay.payload.authorization.nonce = payload.payload.authorization.nonce;
  const rejected = await h.request("/v1/execute", other, { "x-xguard-quote": challengeTwoResponse.headers.get("x-xguard-quote"), "payment-signature": encodePaymentSignatureHeader(nonceReplay) });
  assert.equal(rejected.status, 409); assert.equal(h.counts.settle, 1); assert.equal(h.counts.upstream, 1);
});

test("FLOW 6: public capability pages, OpenAPI, MCP and A2A are linked to the same live outcomes", async t => {
  const h = await harness(t);
  const home = await h.request("/", undefined, { "x-test-site": "site" }); const html = await home.text();
  assert.match(html, /Three sources/); assert.match(html, /\/v1\/execute/);
  const catalog = await (await h.request("/v1/capabilities")).json();
  for (const item of catalog.capabilities) { const page = await h.request(new URL(item.url).pathname, undefined, { "x-test-site": "site" }); assert.equal(page.status, 200); const text = await page.text(); assert.match(text, /rel="canonical"/); assert.ok(text.includes(item.id)); }
  const text = await (await h.request("/agent.txt")).text(); assert.match(text, /X-XGuard-Quote/);
  const openapi = await (await h.request("/openapi.json")).json(); assert.equal(openapi.paths["/v1/execute"].post.operationId, "xguardExecute");
  const listed = await (await h.request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  assert.deepEqual(listed.result.tools.map(x => x.name), ["xguard_discover", "xguard_execute", "xguard_get_result"]);
  const mcp = await (await h.request("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "xguard_execute", arguments: { intent: "demo" } } })).json(); assert.equal(mcp.result.structuredContent.ok, true);
  const a2a = await (await h.request("/a2a", { jsonrpc: "2.0", id: 3, method: "SendMessage", params: { message: { messageId: "a2a-1", role: "ROLE_USER", parts: [{ text: "demo" }] } } })).json(); assert.equal(a2a.result.message.parts[0].data.ok, true);
  const card = await (await h.request("/.well-known/agent-card.json")).json(); assert.deepEqual(card.skills.map(x => x.id), catalog.capabilities.map(x => x.id));
  const sitemap = await (await h.request("/sitemap.xml")).text(); for (const item of catalog.capabilities) assert.ok(sitemap.includes(item.url));
});

test("feed normalization deduplicates RSS/Atom links and product grouping never mixes currencies", async t => {
  const h = await harness(t);
  const result = await h.buy({ intent: "Merge feeds", urls: ["https://source.example.org/news.rss", "https://source.example.org/news.atom"] });
  assert.equal(result.response.status, 200, await result.response.clone().text());
  const data = await result.response.json(); assert.equal(data.result.entries.length, 2); assert.equal(data.result.deduplicated, 1);
  assert.equal(extractFeed(atom, "https://example.org/").length, 2);
  assert.throws(() => extractFeed('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><rss/>', "https://example.org/"), /feed_entities/);
  const doc = extractDocument(fixture("bad", "USD"), "https://example.org/"); assert.equal(extractOffers(doc.structured, "https://example.org/").offers.length, 0);
});

test("the payment helper never signs beyond its budget and private DNS blocks egress after payment with a credit", async t => {
  const h = await harness(t, { privateDns: true }); let signed = 0;
  const client = createXGuardOutcomeClient({ baseUrl: h.base, maxAmountAtomic: "100", payer: { createPaymentPayload: async c => { signed++; return h.payload(c); } } });
  await assert.rejects(client.execute({ intent: "Extract page", url: "https://source.example.org/" }), /budget/); assert.equal(signed, 0);
  const result = await h.buy({ intent: "Extract page", url: "https://source.example.org/" }); assert.equal(result.response.status, 502);
  assert.ok((await result.response.json()).error.details.execution_credit); assert.equal(h.counts.upstream, 0);
});

test("failed paid outcomes redeem once and retain a canonical signed result for credit replay and read-only recovery", async t => {
  let working = false;
  const h = await harness(t, { source: () => working ? new Response(fixture(), { headers: { "content-type": "text/html" } }) : new Response("Unavailable", { status: 503 }) });
  const body = { intent: "Extract page", url: "https://source.example.org/" };
  const first = await h.buy(body); assert.equal(first.response.status, 502);
  const credit = (await first.response.json()).error.details.execution_credit;
  working = true;
  const headers = { "x-xguard-quote": first.quote, "x-xguard-credit": credit };
  const deliveredResponse = await h.request("/v1/execute", body, headers);
  assert.equal(deliveredResponse.status, 200, await deliveredResponse.clone().text());
  const delivered = await deliveredResponse.json();
  assert.equal(delivered.ok, true); assert.equal(delivered.used_execution_credit, true);
  assert.equal(delivered.cost.new_charge, false); assert.ok(delivered.receipt.signature);
  const recovered = await (await h.request(`/v1/results/${delivered.payment_identifier}`, undefined, { "x-xguard-quote": first.quote })).json();
  assert.deepEqual(recovered.result, delivered.result); assert.equal(recovered.replay, true);
  assert.equal((await (await h.request("/v1/execute", body, headers)).json()).replay, true);
  assert.equal((await (await h.request("/v1/execute", body, first.headers)).json()).replay, true);
  assert.equal(h.counts.settle, 1); assert.equal(h.counts.upstream, 2);
});
