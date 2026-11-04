import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { shardOf, shardName } from "../../relay/src/live/util.ts";

const { Miniflare, Response: MFResponse, convertV4MiniflareOptions } =
  createRequire(new URL("../../relay/package.json", import.meta.url))("miniflare");
const originBundle = resolve(fileURLToPath(new URL("../../../.live-build/live-entry.js", import.meta.url)));
const gatewayBundle = fileURLToPath(new URL("../dist/xguard-gateway.js", import.meta.url));
// This is the source matching the live 0.3.0 billing contract.
const legacy = execFileSync("git", ["show", "ac6f321:apps/lemonhook/src/index.js"], { encoding: "utf8" });
const dummy = "xguard-local-billing-test-key";
const testMode = "xguard-local-testmode-license";
const site = "https://xguardgate.com";
const basePath = "/fact/npm/react/latest-version";
const paidPath = "/api/gateway/v1" + basePath;
const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
  { name: "xguard-mainnet", modules: true, modulesRoot: dirname(originBundle), scriptPath: originBundle,
    compatibilityDate: "2026-08-25", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { LIVE_SHARDS: { className: "LiveShard", useSQLite: true },
      LIVE_CONTROL: { className: "LiveControl", useSQLite: true } },
    serviceBindings: { XGUARD_SETTLEMENT: "gateway" },
    bindings: { LIVE_BOOTSTRAP: "off", LIVE_SOURCE_FETCHES: "on", MONETIZATION_MODE: "observe" },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (["cloudflare-dns.com", "one.one.one.one", "dns.google"].includes(url.hostname)) {
        return MFResponse.json({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
      }
      if (url.hostname === "registry.npmjs.org" && url.pathname === "/robots.txt") return new MFResponse("", { status: 404 });
      if (url.hostname === "registry.npmjs.org" && url.pathname === "/react/latest") return MFResponse.json({
        name: "react", version: "1.0.0", license: "MIT", engines: { node: ">=18" },
      });
      throw new Error("Unexpected origin outbound request");
    },
  },
  { name: "gateway", modules: true, modulesRoot: dirname(gatewayBundle), scriptPath: gatewayBundle,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
    durableObjects: { XGUARD_STATE: { className: "XGuardState", useSQLite: true } },
    serviceBindings: { XGUARD_ORIGIN: "xguard-mainnet", XGUARD_BILLING: "billing-transport" },
    bindings: { GATEWAY_ENABLED: "true", PUBLIC_ORIGIN: site, GATEWAY_PATH_PREFIX: "/api/gateway/v1",
      MERCHANT_ID: "xguard-live", PAY_TO: "0x" + "22".repeat(20), BASE_RPC_URL: "https://unavailable.invalid" },
    outboundService: async () => { throw new Error("Unexpected Base payment in credit-only integration test"); },
  },
  { name: "billing-transport", modules: true, compatibilityDate: "2026-07-30",
    serviceBindings: { BILLING: "billing" },
    script: 'let lost=false; export default {async fetch(request, env){const r=await env.BILLING.fetch(request);if(!lost&&r.status===200&&new URL(request.url).pathname==="/v1/assure"){lost=true;await r.body?.cancel();return Response.json({error:"lost_ack"},{status:503});}return r;}}',
  },
  { name: "billing", modules: true, compatibilityDate: "2026-08-25", script: legacy,
    durableObjects: { CREDITS: { className: "CreditLedger", useSQLite: true },
      ORDERS: { className: "OrderIndex", useSQLite: true } },
  },
] }));
try {
  await mf.ready;
  const shards = await mf.getDurableObjectNamespace("LIVE_SHARDS", "xguard-mainnet");
  const shard = shards.get(shards.idFromName(shardName(shardOf("npm/react"))));
  const rpc = async (op, value) => (await shard.fetch("https://internal/rpc", { method: "POST",
    body: JSON.stringify({ op, ...value }) })).json();
  assert.equal((await rpc("seed", { sources: [{ adapter: "npm", identifier: "react" }] })).queued, 1);
  let value;
  for (let i = 0; i < 80; i++) {
    value = await rpc("fact", { id: "npm/react/latest-version" });
    if (value?.current_value === "1.0.0") break;
    await sleep(250);
  }
  assert.equal(value?.current_value, "1.0.0");
  const ledger = await mf.getDurableObjectNamespace("CREDITS", "billing");
  const ledgerFor = k => ledger.get(ledger.idFromName(createHash("sha256").update(k).digest("hex")));
  for (const [k, test] of [[dummy, false], [testMode, true]]) {
    const seeded = await ledgerFor(k).fetch("https://ledger/provision", { method: "POST",
      body: JSON.stringify({ credits: 1, order_id: "integration-fixture", test_mode: test }) });
    assert.equal(seeded.status, 200);
  }
  const get = (path, headers) => mf.dispatchFetch(site + path, { headers });
  assert.equal((await get(basePath + "?format=json")).status, 200, "Existing facts stay free");
  const home = await get("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /href="\/api\/gateway\/v1\/checkout"/);
  assert.match(homeHtml, /href="\/pricing"/);
  const pricing = await get("/pricing");
  assert.equal(pricing.status, 200);
  const pricingHtml = await pricing.text();
  assert.match(pricingHtml, /name="robots" content="index,follow"/);
  assert.ok(pricingHtml.includes('rel="canonical" href="' + site + '/pricing"'));
  assert.match(pricingHtml, /href="\/api\/gateway\/v1\/checkout"/);
  assert.match(pricingHtml, /href="\/api\/gateway\/v1\/catalog"/);
  const sitemap = await get("/sitemaps/site.xml");
  assert.equal(sitemap.status, 200);
  assert.ok((await sitemap.text()).includes("<loc>" + site + "/pricing</loc>"));
  const refunds = await get("/refund-policy");
  assert.equal(refunds.status, 200);
  assert.match(await refunds.text(), /provider-confirmed refund/);
  const factPage = await get(basePath);
  assert.equal(factPage.status, 200);
  assert.ok((await factPage.text()).includes('/api/gateway/v1/checkout?fact=' + encodeURIComponent(basePath)));
  const catalog = await get("/api/gateway/v1/catalog");
  assert.equal(catalog.status, 200);
  const spec = await catalog.json();
  const checkout = "/api/gateway/v1/checkout";
  assert.equal(spec.checkout_url, site + checkout);
  assert.equal(spec.base_settlement_test, undefined);
  const lemon = spec.rails.find(rail => rail.name === "lemon");
  assert.equal(lemon.purchase_url, "https://credits.xguardgate.com/");
  assert.equal(lemon.invoice_issuer, "Lemon Squeezy");
  const ui = await get(checkout + "?fact=" + encodeURIComponent(basePath));
  assert.equal(ui.status, 200);
  const html = await ui.text();
  assert.match(html, /Pay 0\.001 USDC/);
  assert.match(html, /Use 1 credit/);
  assert.match(html, /href="\/refund-policy"/);
  assert.match(html, /https:\/\/credits\.xguardgate\.com\//);
  const browserScript = await get(checkout + ".js");
  assert.equal(browserScript.status, 200);
  const checkoutScript = new Script(await browserScript.text());
  const obsolete = await mf.dispatchFetch(site + "/api/gateway/v1/test-base", { redirect: "manual" });
  assert.equal(obsolete.status, 308);
  assert.equal(obsolete.headers.get("location"), checkout);
  const noProof = await get(paidPath);
  assert.equal(noProof.status, 402);
  assert.equal(JSON.parse(Buffer.from(noProof.headers.get("Payment-Required"), "base64")).accepts[0].amount, "1000");
  assert.equal((await get(paidPath, { "Payment-Signature": "malformed", "Idempotency-Key": "invalid-proof-1" })).status, 402);
  assert.equal((await get(paidPath, { Authorization: "Bearer " + testMode, "Idempotency-Key": "test-mode-credit" })).status, 402);
  const hdr = { Authorization: "Bearer " + dummy, "Idempotency-Key": "live-gateway-order-1" };
  const pending = await get(paidPath, hdr);
  assert.equal(pending.status, 503);
  assert.equal((await pending.json()).source, undefined);
  assert.equal((await (await ledgerFor(dummy).fetch("https://ledger/balance")).json()).credits, 0);
  await sleep(5200);
  const charged = await get(paidPath, hdr);
  const delivered = await charged.text();
  assert.equal(charged.status, 200, delivered);
  assert.match(charged.headers.get("X-XGuard-Billing-Receipt"), /^xga_[a-f0-9]{24}$/);
  assert.equal(charged.headers.get("X-XGuard-Billing-Unit"), "lemon-license-credit");
  assert.equal(JSON.parse(delivered).source.fact.id, "npm/react/latest-version");
  const replay = await get(paidPath, hdr);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("X-XGuard-Replayed"), "1");
  assert.equal(await replay.text(), delivered);
  assert.equal((await get(paidPath, { ...hdr, "Idempotency-Key": "live-gateway-order-2" })).status, 402);
  const record = await (await ledgerFor(dummy).fetch("https://ledger/balance")).json();
  assert.deepEqual([record.credits, record.consumed], [0, 1]);
  const buyerLicense = "xguard-local-checkout-license";
  assert.equal((await ledgerFor(buyerLicense).fetch("https://ledger/provision", { method: "POST",
    body: JSON.stringify({ credits: 1, order_id: "browser-checkout-fixture", test_mode: false }) })).status, 200);
  const elements = new Map(), handlers = new Map(), storage = new Map(), browserRequests = [];
  const selection = site + checkout + "?fact=" + encodeURIComponent(basePath);
  checkoutScript.runInNewContext({
    URL, crypto, TextEncoder, AbortSignal,
    location: new URL(selection), history: { replaceState() {} },
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: true, value: "",
        addEventListener(event, handler) { handlers.set(id + ":" + event, handler); }, removeAttribute() {} });
      return elements.get(id);
    } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key) },
    async fetch(resource, { headers }) {
      assert.equal(resource, site + paidPath);
      browserRequests.push(headers["Idempotency-Key"]);
      const response = await get(paidPath, headers);
      if (browserRequests.length === 1) { await response.body?.cancel(); throw new TypeError("Interrupted response"); }
      return response;
    },
  });
  elements.get("license").value = buyerLicense;
  await handlers.get("credit:click")();
  assert.equal(elements.get("result").hidden, true);
  assert.ok(!JSON.stringify([...storage.values()]).includes(buyerLicense));
  await handlers.get("credit:click")();
  assert.equal(browserRequests.length, 2);
  assert.equal(browserRequests[0], browserRequests[1]);
  assert.equal(elements.get("result").hidden, false);
  assert.match(elements.get("details").textContent, /xga_[a-f0-9]{24}/);
  assert.equal((await (await ledgerFor(buyerLicense).fetch("https://ledger/balance")).json()).consumed, 1);
  console.log("Production route integration: existing free routes, mandatory x402/credits, actual Lemon 0.3 contract, lost acknowledgement recovery and exactly one fixture debit verified.");
} finally { await mf.dispose(); }
