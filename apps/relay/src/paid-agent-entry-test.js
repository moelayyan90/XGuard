import test from "node:test";
import assert from "node:assert/strict";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import app, { PaidGatewayState, ProofAuthority } from "./paid-agent-entry.js";
import canonicalApp from "./canonical-entry.js";

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarm = null; }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(value) { this.alarm = value; }
}

function namespaceFor(Class, env) {
  const objects = new Map();
  return {
    idFromName(name) { return name; },
    get(id) {
      if (!objects.has(id)) objects.set(id, new Class({ storage: new MemoryStorage() }, env));
      const object = objects.get(id);
      return { fetch(input, init) { return object.fetch(input instanceof Request ? input : new Request(input, init)); } };
    },
  };
}

function environment() {
  const env = {
    XGUARD_PAYMENT_ENVIRONMENT: "production",
    XGUARD_PAID_FACILITATOR: "https://facilitator.test",
    XGUARD_TESTNET_FACILITATOR: "https://facilitator.test",
    XGUARD_TREASURY_USDC_ADDRESS: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_TESTNET_PAY_TO: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
    XGUARD_WEB_FETCH_PRICE_ATOMIC: "1000",
    XGUARD_MARGIN_USD_MICROS: "1000",
    XGUARD_TESTNET_WEB_FETCH_PRICE_ATOMIC: "1000",
    XGUARD_TESTNET_MARGIN_USD_MICROS: "1000",
  };
  env.PROOF_AUTHORITY = namespaceFor(ProofAuthority, env);
  env.PAID_GATEWAY = namespaceFor(PaidGatewayState, env);
  return env;
}

const target = "https://example.com/data.json";
const payer = "0x1111111111111111111111111111111111111111";
const transaction = `0x${"2".repeat(64)}`;

async function signedQuote(env) {
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target, testnet: true }),
  }), env, {});
  assert.equal(response.status, 200);
  return response.json();
}

test("paid discovery advertises only the real enabled connector", async () => {
  const env = environment();
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/capabilities"), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, "5.1.0");
  assert.equal(body.tools.find(tool => tool.id === "xguard.web.fetch")?.available, true);
  assert.equal(body.tools.find(tool => tool.id === "xguard.web.search")?.available, false);
  assert.equal(body.tools.find(tool => tool.id === "xguard.ai.generate")?.unavailable_reason?.code, "connector_not_configured");
  const mcp = await app.fetch(new Request("https://api.xguardgate.com/mcp"), env, {});
  assert.equal(mcp.status, 200);
  assert.ok((await mcp.json()).tools.some(tool => tool.name === "xguard.pricing.quote"));
  const toolsManifest = await app.fetch(new Request("https://api.xguardgate.com/.well-known/xguard-tools.json"), env, {});
  assert.equal(toolsManifest.status, 200);
  const manifestBody = await toolsManifest.json();
  assert.deepEqual(manifestBody.recommended_order, ["xguard.web.fetch"]);
  assert.deepEqual(manifestBody.optional_preparation, ["xguard.capabilities", "xguard.preflight", "xguard.pricing.quote"]);
  assert.equal(manifestBody.execution_chokepoint.settlement_before_execution, true);
});

test("modern MCP discovery, routing headers, caching metadata, and JSON-RPC validation are enforced", async () => {
  const env = environment();
  const discover = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "discover-1", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }),
  }), env, {});
  assert.equal(discover.status, 200);
  assert.equal(discover.headers.get("mcp-method"), "server/discover");
  const discovered = await discover.json();
  assert.deepEqual(discovered.result.supportedVersions, ["2026-07-28", "2025-11-25"]);
  assert.equal(discovered.result.cacheScope, "public");
  assert.equal(discovered.result._meta["io.modelcontextprotocol/serverInfo"].version, "5.1.0");

  const listed = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }), env, {});
  assert.equal(listed.status, 200);
  const list = await listed.json();
  assert.equal(list.result.resultType, "complete");
  assert.equal(list.result.ttlMs, 60000);
  assert.equal(list.result.cacheScope, "public");
  assert.ok(list.result.tools.some(tool => tool.name === "xguard.web.fetch"));
  assert.ok(list.result.tools.some(tool => tool.name === "xguard_egress_fetch"));
  const preflightTool = list.result.tools.find(tool => tool.name === "xguard.preflight");
  assert.ok(preflightTool);
  assert.equal(preflightTool._meta["xguard/next"].first_status, 402);
  const quoteTool = list.result.tools.find(tool => tool.name === "xguard.pricing.quote");
  const paidTool = list.result.tools.find(tool => tool.name === "xguard.web.fetch");
  assert.ok(Array.isArray(quoteTool.inputSchema.oneOf));
  assert.equal(quoteTool._meta["xguard/next"].first_status, 402);
  assert.equal(paidTool._meta["xguard/payment"].required, true);
  assert.equal(paidTool._meta["xguard/payment"].settlement_before_execution, true);

  const mismatched = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": "wrong" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
  }), env, {});
  assert.equal(mismatched.status, 400);
  assert.equal((await mismatched.json()).error.code, -32600);

  const invalid = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 4, method: "tools/list" }),
  }), env, {});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, -32600);
});

test("MCP, A2A, pricing, and OpenAPI publish the same canonical quote and mandatory payment flow", async () => {
  const env = environment();
  const pricing = await (await app.fetch(new Request("https://api.xguardgate.com/v1/pricing"), env, {})).json();
  assert.equal(pricing.quote_request.canonical_shape.url, "https://example.com/");
  assert.match(pricing.paid_flow.first_response, /automatically created signed quote/);

  const card = await (await canonicalApp.fetch(new Request("https://api.xguardgate.com/.well-known/agent-card.json"), env, {})).json();
  const extension = card.capabilities.extensions.find(item => item.uri.endsWith("/.well-known/payment-manifest"));
  assert.equal(extension.params.canonical_quote_body.url, "https://example.com/");
  assert.equal(extension.params.challenge_status, 402);
  assert.equal(extension.params.settlement_before_execution, true);
  assert.ok(card.skills.some(skill => skill.id === "xguard-preflight"));
  const serverCard = await (await canonicalApp.fetch(new Request("https://xguardgate.com/.well-known/mcp/server-card.json"), env, {})).json();
  assert.ok(serverCard.tools.some(tool => tool.name === "xguard.preflight"));

  const openapi = await (await canonicalApp.fetch(new Request("https://api.xguardgate.com/openapi.json"), env, {})).json();
  const quote = openapi.paths["/v1/pricing/quote"].post;
  assert.ok(Array.isArray(quote.requestBody.content["application/json"].schema.oneOf));
  assert.equal(quote["x-xguard-payment-flow"].payment_required, true);
  assert.equal(openapi.paths["/v1/tools/web.fetch"].post["x-xguard-payment-flow"].settlement_before_execution, true);
  assert.ok(openapi.paths["/v1/preflight"].post);
});

test("readiness accepts the official facilitator supported shape", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "facilitator.test" && url.pathname === "/supported") {
      return new Response(JSON.stringify({ kinds: ["eip155:8453", "eip155:84532"].map(network => ({ x402Version: 2, scheme: "exact", network })) }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/ready"), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.deepEqual(body.checks, { proof_authority: true, paid_state: true, mainnet_config: true, facilitator: true, testnet_config: true, testnet_facilitator: true });
  assert.equal(body.production_payment_ready, true);
  assert.equal(body.test_payment_ready, true);
});

test("quote issuance rejects private, local, metadata, and XGuard-owned targets", async () => {
  const env = environment();
  for (const url of [
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://metadata.google.internal/",
    "https://api.xguardgate.com/identity",
    "https://localhost/",
  ]) {
    const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, testnet: true }),
    }), env, {});
    assert.equal(response.status, 403, url);
    assert.equal((await response.json()).error.code, "target_not_public");
  }
});

test("pricing quote accepts common AI-agent envelopes and returns one canonical next step", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const variants = [
    { url: target, testnet: true },
    { tool: "xguard.web.fetch", input: { target_url: target, timeoutMs: 5000 }, testnet: true },
    { name: "xguard.web.fetch", arguments: { uri: target, maxBytes: 4096 }, environment: "testnet" },
    { tool_name: "xguard.web.fetch", parameters: { target, method: "head" }, network: "base-sepolia" },
    { function: { name: "xguard.web.fetch", arguments: JSON.stringify({ url: target, mode: "json" }) }, chain: "eip155:84532" },
    { capability: "fetch", resource: target, testnet: true },
    { action: { toolName: "web.fetch", input: { endpoint: target } }, testnet: true },
    { operation: { name: "xguard_web_fetch", arguments: { href: target } }, testnet: true },
    { command: `curl ${target}`, testnet: true },
  ];
  for (const body of variants) {
    const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), env, {});
    assert.equal(response.status, 200, JSON.stringify(body));
    const quote = await response.json();
    assert.equal(quote.network, "eip155:84532");
    assert.equal(quote.payment_environment, "test");
    assert.equal(quote.payment_rail, "x402:eip155:84532:exact");
    assert.equal(quote.amount, "1000");
    assert.equal(quote.input.url, target);
    assert.equal(quote.next.execution_url, "https://api.xguardgate.com/v1/tools/web.fetch/testnet");
    assert.equal(quote.next.expected_first_status, 402);
    assert.equal(quote.next.payment.challenge_header, "Payment-Required");
    assert.equal(quote.next.payment.retry_header, "Payment-Signature");
  }
});

test("free preflight returns an allow decision and one executable next step", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  let targetCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/json" } });
    }
    targetCalls += 1;
    throw new Error(`preflight must not contact target: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool: "xguard.web.fetch", input: { targetUrl: target, timeoutMs: 5000 }, testnet: true }),
  }), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.decision, "allow");
  assert.equal(body.target_contacted, false);
  assert.equal(body.normalized_input.url, target);
  assert.equal(body.network, "eip155:84532");
  assert.equal(body.next.execution_url, "https://api.xguardgate.com/v1/tools/web.fetch/testnet");
  assert.equal(body.next.quote_url_optional, "https://api.xguardgate.com/v1/pricing/quote");
  assert.equal(body.next.expected_status, 402);
  assert.equal(body.next.body.testnet, true);
  assert.equal(targetCalls, 0);
});

test("preflight blocks SSRF targets before DNS or payment", async () => {
  const env = environment();
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://169.254.169.254/latest/meta-data/", testnet: true }),
  }), env, {});
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "target_not_public");
  assert.equal(body.error.details.target_contacted, false);
});

test("preflight validation explains the exact retry shape", async () => {
  const env = environment();
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "xguard.web.fetch", arguments: { method: "POST" } }),
  }), env, {});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_input");
  assert.equal(body.error.details.retry.endpoint, "https://api.xguardgate.com/v1/preflight");
  assert.ok(body.error.details.issues.some(issue => issue.path === "url"));
});

test("pricing validation tells an agent exactly how to retry", async () => {
  const env = environment();
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "xguard.web.fetch", arguments: { method: "POST", timeout_ms: 20 } }),
  }), env, {});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_input");
  assert.equal(body.error.retryable, false);
  assert.ok(body.error.details.issues.some(issue => issue.path === "url" && issue.code === "required"));
  assert.ok(body.error.details.issues.some(issue => issue.path === "method" && issue.code === "unsupported_value"));
  assert.equal(body.error.details.retry.canonical_shape.url, "https://example.com/");
  assert.deepEqual(body.error.details.retry.optional.method.accepted, ["GET", "HEAD"]);
  assert.ok(body.error.details.retry.accepted_shapes.some(shape => shape.name === "mcp_arguments"));

  const mcp = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "xguard.pricing.quote", arguments: { method: "POST" } } }),
  }), env, {});
  assert.equal(mcp.status, 200);
  const rpc = await mcp.json();
  assert.equal(rpc.id, 44);
  assert.equal(rpc.result.isError, true);
  assert.equal(rpc.result.structuredContent.error.code, "invalid_input");
  assert.equal(rpc.result.structuredContent.error.details.retry.canonical_shape.url, "https://example.com/");
});

test("temporary DNS validator outage is retryable 503, not misleading 422", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("resolver unavailable"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target, testnet: true }),
  }), env, {});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "dns_unavailable");
  assert.equal(body.error.retryable, true);
  assert.equal(body.error.details.retry.method, "POST");
});

test("definitive DNS name failure remains a descriptive non-retryable 422", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ Status: 3 }), { headers: { "content-type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://does-not-exist.invalid/", testnet: true }),
  }), env, {});
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, "dns_unresolved");
  assert.equal(body.error.retryable, false);
  assert.ok(body.error.details.issues[0].message.includes("no public"));
});

test("signed quote produces an official x402 v2 challenge", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "cloudflare-dns.com") return new Response(JSON.stringify({ Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/dns-json" } });
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const quoted = await signedQuote(env);
  assert.match(quoted.quote, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(quoted.network, "eip155:84532");
  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xguard-quote": quoted.quote },
    body: JSON.stringify({ url: target }),
  }), env, {});
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("payment-required"));
  const required = await response.json();
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].network, "eip155:84532");
  assert.equal(required.accepts[0].amount, "1000");
  assert.equal(required.extensions["payment-identifier"].info.required, true);
  assert.equal(required.extensions["payment-identifier"].info.id, quoted.payment_identifier);
  assert.ok(required.extensions["offer-receipt"].info.offers[0].signature);

  const mcpResponse = await app.fetch(new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "xguard.web.fetch", arguments: { url: target, quote: quoted.quote } } }),
  }), env, {});
  assert.equal(mcpResponse.status, 402);
  assert.equal((await mcpResponse.json()).accepts[0].network, "eip155:84532");
});

test("one direct paid call creates a signed quote and returns 402 without upstream execution", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/dns-json" } });
    }
    upstreamCalls += 1;
    throw new Error(`upstream contacted before settlement: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xguard-traffic-class": "synthetic" },
    body: JSON.stringify({ url: target, testnet: true }),
  }), env, {});
  assert.equal(response.status, 402);
  assert.equal(upstreamCalls, 0);
  assert.ok(response.headers.get("payment-required"));
  assert.match(response.headers.get("x-xguard-quote") || "", /^[^.]+\.[^.]+\.[^.]+$/);
  const required = await response.json();
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].network, "eip155:84532");
  assert.equal(required.extensions.xguard.quote, response.headers.get("x-xguard-quote"));
  assert.equal(required.extensions.xguard.paymentIdentifier, response.headers.get("x-xguard-payment-identifier"));
  assert.equal(required.extensions.xguard.next.action, "sign_and_retry");
});

test("DNS validation uses an independent resolver when the primary is unavailable", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  const queried = [];
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    queried.push(`${url.hostname}:${url.searchParams.get("type")}`);
    if (url.hostname === "cloudflare-dns.com" || url.hostname === "one.one.one.one") throw new Error("primary resolver unavailable");
    if (url.hostname === "dns.google") {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
      }), { headers: { "content-type": "application/dns-json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target, testnet: true }),
  }), env, {});
  assert.equal(response.status, 200);
  for (const expected of ["one.one.one.one:A", "cloudflare-dns.com:A", "dns.google:A", "one.one.one.one:AAAA", "cloudflare-dns.com:AAAA", "dns.google:AAAA"]) {
    assert.ok(queried.includes(expected), expected);
  }
});

test("settlement precedes execution and an exact retry does not settle twice", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  let verifyCalls = 0;
  let settleCalls = 0;
  let upstreamCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      return new Response(JSON.stringify({ Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/dns-json" } });
    }
    if (url.hostname === "facilitator.test" && url.pathname === "/verify") {
      verifyCalls += 1;
      return new Response(JSON.stringify({ isValid: true, payer }), { headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "facilitator.test" && url.pathname === "/settle") {
      settleCalls += 1;
      return new Response(JSON.stringify({ success: true, payer, transaction, network: "eip155:84532" }), { headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "example.com") {
      upstreamCalls += 1;
      assert.equal(settleCalls, 1, "upstream must not execute before settlement succeeds");
      return new Response(JSON.stringify({ source: "test-upstream" }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const quoted = await signedQuote(env);
  const challengeResponse = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-xguard-quote": quoted.quote },
    body: JSON.stringify({ url: target }),
  }), env, {});
  const challenge = await challengeResponse.json();
  const paymentPayload = {
    x402Version: 2,
    resource: challenge.resource,
    accepted: challenge.accepts[0],
    payload: {
      signature: `0x${"1".repeat(130)}`,
      authorization: {
        from: payer,
        to: challenge.accepts[0].payTo,
        value: challenge.accepts[0].amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${"3".repeat(64)}`,
      },
    },
    extensions: { "payment-identifier": { info: { id: quoted.payment_identifier } } },
  };
  const execute = () => app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-xguard-quote": quoted.quote,
      "payment-signature": encodePaymentSignatureHeader(paymentPayload),
    },
    body: JSON.stringify({ url: target }),
  }), env, {});

  const first = await execute();
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.status, "succeeded");
  assert.equal(firstBody.replay, false);
  assert.equal(firstBody.accounting.gross_revenue_usd_micros, 0);
  assert.equal(firstBody.accounting.net_profit_usd_micros, 0);
  assert.equal(firstBody.accounting.revenue_source, "test_settlement_non_revenue");
  assert.ok(firstBody.receipt.signature);
  assert.ok(firstBody.proofrail.proof);
  const verifiedProof = await app.fetch(new Request("https://api.xguardgate.com/v1/proofs/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof: firstBody.proofrail.proof }),
  }), env, {});
  assert.equal(verifiedProof.status, 200);
  const proofResult = await verifiedProof.json();
  assert.equal(proofResult.valid, true);
  assert.equal(proofResult.payload.transaction, transaction);

  const status = await app.fetch(new Request(`https://api.xguardgate.com/v1/operations/${quoted.payment_identifier}`), env, {});
  assert.equal(status.status, 200);
  const operation = await status.json();
  assert.equal(operation.status, "succeeded");
  assert.equal(operation.transaction, transaction);
  assert.equal(operation.gross_revenue_usd_micros, 0);

  const replay = await execute();
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-xguard-replay"), "true");
  assert.equal((await replay.json()).replay, true);
  assert.equal(verifyCalls, 1);
  assert.equal(settleCalls, 1);
  assert.equal(upstreamCalls, 1);

  const metrics = await app.fetch(new Request("https://api.xguardgate.com/v1/metrics"), env, {});
  const observed = await metrics.json();
  for (const stage of ["quote_attempt", "quote_success", "payment_required", "payment_attempt", "payment_verified", "settlement_success"]) {
    assert.ok(observed.events[stage] >= 1, stage);
  }
  assert.equal(observed.settled_usd_micros, 0, "testnet settlement is never revenue");
});

test("synthetic production probes are labeled in logs and excluded from journey metrics", async t => {
  const env = environment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const headers = { "content-type": "application/json", "x-xguard-traffic-class": "synthetic" };
  const quoteResponse = await app.fetch(new Request("https://api.xguardgate.com/v1/pricing/quote", { method: "POST", headers, body: JSON.stringify({ url: target, testnet: true }) }), env, {});
  const quote = await quoteResponse.json();
  const challenge = await app.fetch(new Request("https://api.xguardgate.com/v1/tools/web.fetch/testnet", { method: "POST", headers: { ...headers, "x-xguard-quote": quote.quote }, body: JSON.stringify({ url: target }) }), env, {});
  assert.equal(challenge.status, 402);
  const metrics = await app.fetch(new Request("https://api.xguardgate.com/v1/metrics"), env, {});
  const body = await metrics.json();
  assert.deepEqual(body.events, {});
  assert.equal(body.settled_usd_micros, 0);
});

test("pending, verified, and ambiguous states never record revenue", async () => {
  const env = environment();
  const object = new PaidGatewayState({ storage: new MemoryStorage() }, env);
  const post = (path, body) => object.fetch(new Request(`https://paid-gateway${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  await post("/operation/begin", { request_id: "xgr_financial_test", payment_identifier: "pay_12345678901234567890123456789012", authorization_fingerprint: "a".repeat(64), request_digest: "b".repeat(64), customer_price_usd_micros: 1000, maximum_upstream_cost_usd_micros: 0, environment: "production", traffic_class: "external", network: "eip155:8453" });
  for (const status of ["verified", "ambiguous"]) {
    const response = await post("/operation/transition", { status, patch: {} });
    assert.equal(response.status, 200);
    const record = (await response.json()).record;
    assert.equal(record.gross_revenue_usd_micros, 0);
    assert.equal(record.net_profit_usd_micros, 0);
    assert.equal(record.revenue_source, null);
  }
  const settled = await post("/operation/transition", { status: "settled", patch: { transaction, network: "eip155:8453" } });
  assert.equal(settled.status, 200);
  const settledRecord = (await settled.json()).record;
  assert.equal(settledRecord.gross_revenue_usd_micros, 1000);
  assert.equal(settledRecord.net_profit_usd_micros, 1000);
  assert.equal(settledRecord.revenue_source, "external_production_x402_settlement");
});
