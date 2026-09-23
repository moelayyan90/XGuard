import test from "node:test";
import assert from "node:assert/strict";
import app, { EgressKeyAuthority, EgressCredentialState, EgressCapabilityState, EgressTenantIndex, EgressMeter, ProofAuthority, PaidGatewayState } from "./canonical-entry.js";
import { compileOperation, operationCatalog, validateOperationPolicy } from "./core/provider-operations.js";
import { advanceLifecycle } from "./core/payment-lifecycle.js";
import { recordPaymentHealth, paymentHealthSnapshot } from "./core/payment-health.js";
import { recordTelemetry, telemetrySnapshot } from "./core/execution-telemetry.js";
import { normalizeSecretless } from "./execution-entry.js";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";

class Storage {
  values = new Map(); queue = Promise.resolve();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k, v) { this.values.set(k, structuredClone(v)); }
  async delete(k) { this.values.delete(k); }
  async list({prefix = "", startAfter = "", limit = 1000} = {}) { return new Map([...this.values].filter(([k]) => k.startsWith(prefix) && k > startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)); }
  async deleteAll() { this.values.clear(); }
  async setAlarm(at) { this.alarm = at; }
  async transaction(fn) { const task = this.queue.then(() => fn(this)); this.queue = task.catch(() => {}); return task; }
}
function fixture() {
  const env = { EGRESS_EXECUTION_CREDITS: "1", XGUARD_BILLING_URL: "https://billing.test" }, namespaces = {};
  for (const [name, Class] of Object.entries({ EGRESS_KEYS: EgressKeyAuthority, EGRESS_CREDENTIALS: EgressCredentialState, EGRESS_CAPABILITIES: EgressCapabilityState, EGRESS_TENANTS: EgressTenantIndex, EGRESS_METER: EgressMeter, PROOF_AUTHORITY: ProofAuthority, PAID_GATEWAY: PaidGatewayState })) {
    const objects = namespaces[name] = new Map();
    env[name] = { idFromName: n => n, get(id) {
      if (!objects.has(id)) { const storage = new Storage(); objects.set(id, { storage, object: new Class({ storage }, env) }); }
      return { fetch(input, init) { return objects.get(id).object.fetch(input instanceof Request ? input : new Request(input, init)); } };
    } };
  }
  const tasks = [], ctx = { waitUntil: task => tasks.push(task) };
  const call = (path, body, headers = {}, method = body === undefined ? "GET" : "POST") => app.fetch(new Request(`https://api.xguardgate.com${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, ctx);
  return { env, namespaces, call, tasks };
}
// Explicit test-only forecasts exercise the real policy gate, not a legacy mode.
function forecastPolicy(digest) {
  return { version: 1, currency: "USD", minimum_net_usd_micros: "100", daily_cost_limit_usd_micros: "10000", forecasts: [{
    request_digest: digest, revenue_if_success_usd_micros: "10000", success_probability_bps: 9000,
    api_cost_usd_micros: "500", compute_cost_usd_micros: "100", payment_cost_usd_micros: "100",
    slippage_cost_usd_micros: "100", safety_buffer_cost_usd_micros: "100", failure_loss_usd_micros: "100",
    valid_until: new Date(Date.now() + 60000).toISOString(),
  }] };
}

test("MCP initialization and tool listing remain local when every storage service hangs", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("discovery must not contact an external service"); });
  const hanging = { idFromName: n => n, get: () => ({ fetch: () => new Promise(() => {}) }) };
  const env = { PAID_GATEWAY: hanging, EGRESS_METER: hanging, PROOF_AUTHORITY: hanging };
  for (const method of ["initialize", "tools/list", "resources/list", "prompts/list"]) {
    const response = await app.fetch(new Request("https://api.xguardgate.com/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) }), env, { waitUntil() {} });
    assert.equal(response.status, 200); const body = await response.json(); assert.ok(body.result);
    if (method === "tools/list") assert.ok(body.result.tools.some(t => t.name === "xguard_secretless_call"));
  }
});

test("controlled Secretless demo authenticates, rejects scope escape, replays once, and verifies real proof without outbound traffic", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", () => { throw new Error("controlled demo cannot contact billing or an external provider"); });
  const grantResponse = await f.call("/v1/demo/secretless", {});
  assert.equal(grantResponse.status, 201); const grant = await grantResponse.json();
  const input = { capability: grant.capability, target: grant.target, method: "GET", idempotency_key: grant.idempotency_key };
  const first = await f.call("/v1/secretless/call", input); assert.equal(first.status, 200);
  const result = await first.json(); assert.equal(result.ok, true); assert.equal(result.result.authenticated, true); assert.equal(result.result.secret_returned, false);
  assert.equal(result.receipt.billed_credits, 0); assert.ok(result.proof);
  const replay = await (await f.call("/v1/secretless/call", input)).json();
  assert.equal(replay.request_id, result.request_id); assert.equal(replay.receipt.replay, true); assert.equal(replay.proof, result.proof);
  const forbidden = await f.call("/v1/secretless/call", { ...input, method: "DELETE" }); assert.equal(forbidden.status, 403);
  const escaped = await f.call("/v1/secretless/call", { ...input, target: "https://api.github.com/repos/moelayyan90/XGuard" }); assert.equal(escaped.status, 403);
  const proof = await (await f.call("/v1/receipts/verify", { proof: result.proof, result_sha256: result.receipt.result_sha256 })).json();
  assert.equal(proof.valid, true); assert.equal(proof.payload.demo, true); assert.equal(proof.payload.revenue, false);
  assert.equal((await f.call("/v1/receipts/verify", { proof: result.proof, result_sha256: "f".repeat(64) })).status, 422);
  const capability = [...f.namespaces.EGRESS_CAPABILITIES.values()][0].storage.values.get("record");
  assert.equal(capability.used_calls, 1); assert.equal(capability.reserved_credits, 0);
  assert.equal(JSON.stringify(result).includes(capability.token_hash), false);
  await Promise.all(f.tasks);
});

test("provider operation restrictions cannot be bypassed through raw egress; billing precedes a single external write", async t => {
  const f = fixture(), owner = "fixture-operator-key", secret = "fixture-provider-secret-12345", order = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) return Response.json({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
    if (url.hostname === "billing.test") { if (url.pathname === "/v1/balance") return Response.json({ credits: 10 }); order.push("billing"); return Response.json({ ok: true }); }
    assert.equal(url.href, "https://api.github.com/repos/acme/service/issues");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${secret}`); assert.equal(init.redirect, "manual"); order.push("provider");
    return Response.json({ id: 1, number: 2 }, { status: 201 });
  });
  const credential = await (await f.call("/v1/egress/credentials", { provider: "github", value: secret, allowed_paths: ["/repos/acme/service"], allowed_methods: ["GET", "POST"] }, { "x-xguard-key": owner })).json();
  const operationInput = { owner: "acme", repo: "service", title: "Fixture", body: "Test" };
  const plan = await (await f.call("/v1/providers/plan", { operation: "github.issue.create", input: operationInput })).json();
  const granted = await f.call("/v1/egress/capabilities", { credential_id: credential.credential.id, target_origin: "https://api.github.com", path_prefix: "/repos/acme/service", allowed_methods: ["GET", "POST"], allowed_operations: ["github.issue.create"], operation_limits: { resources: ["acme/service"] }, max_calls: 2, max_total_credits: 2, governance: forecastPolicy(plan.request_digest) }, { "x-xguard-key": owner });
  assert.equal(granted.status, 201); const grant = await granted.json();
  const input = { capability: grant.capability, operation: "github.issue.create", input: { owner: "acme", repo: "service", title: "Fixture", body: "Test" }, idempotency_key: "operation-issue-001" };
  assert.equal((await f.call("/v1/preflight", input)).status, 200); assert.deepEqual(order, []);
  const approval = await f.call("/v1/secretless/authorize", input);
  assert.equal(approval.status, 200);
  input.governance_authorization = (await approval.json()).authorization;
  const first = await f.call("/v1/secretless/call", input); assert.equal(first.status, 201);
  const result = await first.json(); assert.equal(result.ok, true); assert.deepEqual(order, ["billing", "provider"]);
  const replay = await (await f.call("/v1/execute", input)).json(); assert.equal(replay.request_id, result.request_id); assert.equal(order.length, 2);
  assert.equal((await f.call("/v1/egress/fetch", { capability: grant.capability, target: "https://api.github.com/repos/acme/service/issues", method: "POST", body_json: { title: "escape" }, idempotency_key: "escape-001" })).status, 403);
  assert.equal((await f.call("/v1/secretless/call", { ...input, input: { ...input.input, title: "Changed" } })).status, 403);
  assert.equal((await f.call("/v1/secretless/call", { ...input, operation: "github.repository.read", input: { owner: "acme", repo: "service" } })).status, 403);
  assert.equal((await f.call(`/v1/egress/capabilities/${grant.capability_id}`, undefined, { "x-xguard-key": owner }, "DELETE")).status, 200);
  assert.equal((await f.call("/v1/secretless/call", input)).status, 403);
  assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(JSON.stringify(result).includes(owner), false);
  await Promise.all(f.tasks);
  const observed = await (await f.call("/v1/status")).json();
  assert.equal(observed.observed.groups["provider_execution:unattributed:github.issue.create"].successes, 1);
  assert.equal(observed.observed.groups["provider_replay:unattributed:github.issue.create"].requests, 1);
  assert.equal(observed.observed.groups["preflight:unattributed:github.issue.create"].requests, 1);
});

test("adapters reject ambiguous mutation, path traversal, unknown fields, arbitrary models and unbounded output", () => {
  assert.equal(operationCatalog().length, 16);
  for (const raw of [
    { operation: "delete everything", input: {} },
    { operation: "github.repository.read", input: { owner: "a", repo: ".." } },
    { operation: "openai.response.create", input: { model: "model", prompt: "test", max_output_tokens: 999999 } },
    { operation: "slack.message.send", input: { channel: "C123", text: "Hi", token: "secret" } },
    { provider: "github", action: "issue.create", operation: "github.repository.read", input: {} },
  ]) assert.throws(() => normalizeSecretless(raw));
  assert.throws(() => validateOperationPolicy(["openai.response.create"], { resources: ["*"] }, "openai"));
  assert.throws(() => validateOperationPolicy(["stripe.refund.create"], { resources: ["cus_1"] }, "stripe"));
  const plan = compileOperation("slack.message.send", { channel: "C123", text: "Hello" }); assert.equal(plan.body_json.unfurl_links, false);
});

test("canonical payment lifecycle prevents execution without settlement and a second settlement after ambiguity", () => {
  let record = { lifecycle_version: 1, lifecycle_state: "PAYMENT_PRESENTED", request_id: "xgr_test" };
  assert.throws(() => advanceLifecycle(record, "EXECUTION_STARTED"));
  for (const next of ["VERIFIED", "SETTLEMENT_RESERVED", "SETTLEMENT_PENDING", "SETTLEMENT_AMBIGUOUS", "RECONCILIATION_REQUIRED"]) record = advanceLifecycle(record, next);
  assert.throws(() => advanceLifecycle(record, "SETTLEMENT_PENDING"));
  for (const next of ["SETTLED", "EXECUTION_STARTED", "EXECUTED", "RECEIPT_ISSUED"]) record = advanceLifecycle(record, next);
  assert.equal(record.lifecycle_events.length, 9); assert.throws(() => advanceLifecycle(record, "EXECUTION_STARTED"));
});

test("durable health circuit and observed latency are based on real samples and expire", async () => {
  const storage = new Storage(), now = Date.now();
  for (let i = 0; i < 3; i++) {
    await recordPaymentHealth(storage, { url: "https://facilitator.test", network: "eip155:8453", phase: "verify", ok: true, latency_ms: 10 }, now + i);
    await recordPaymentHealth(storage, { url: "https://facilitator.test", network: "eip155:8453", phase: "settle", ok: false, transport_failure: true, ambiguous: true, latency_ms: 5000 }, now + i);
  }
  let snapshot = await paymentHealthSnapshot(storage, now + 3); assert.equal(snapshot.facilitators[0].circuit, "open"); assert.equal(snapshot.facilitators[0].settle.ambiguous_attempts, 3);
  snapshot = await paymentHealthSnapshot(storage, now + 3700000); assert.equal(snapshot.facilitators[0].settle.success_rate, null);
  assert.deepEqual((await telemetrySnapshot(storage)).groups, {});
  await recordTelemetry(storage, { event: "mcp_initialize", traffic_class: "synthetic", ok: true, latency_ms: 12 }, now);
  const metric = (await telemetrySnapshot(storage, now)).groups["mcp_initialize:synthetic:all"];
  assert.equal(metric.success_rate, 1); assert.equal(metric.latency_ms.p95, 12);
  assert.deepEqual((await telemetrySnapshot(storage, now + 25 * 3600000)).groups, {});
});

test("operator onboarding and demo scripts parse, use safe text output and contain no browser secret persistence", async () => {
  for (const path of ["/", "/operators", "/demo/secretless", "/connect", "/status"]) {
    const response = await app.fetch(new Request(`https://xguardgate.com${path}`), {}, {}); assert.equal(response.status, 200);
    const html = await response.text(); const { document } = parseHTML(html);
    assert.ok(document.querySelector('link[rel="canonical"]'));
    for (const script of document.querySelectorAll("script")) { assert.doesNotThrow(() => new Function(script.textContent)); assert.ok(script.getAttribute("nonce")); }
    assert.doesNotMatch(html, /localStorage|sessionStorage|\.innerHTML\s*=/);
  }
});


test("hosted demo button completes its actual API flow and operator form constructs an isolated agent request", async t => {
  const f = fixture(), secret = "ui-fixture-provider-key", key = "ui-fixture-operator-key";
  let debits = 0, writes = 0;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) return Response.json({Status:0,Answer:url.searchParams.get("type") === "A" ? [{type:1,data:"93.184.216.34"}] : []});
    if (url.hostname === "billing.test") { if (url.pathname === "/v1/balance") return Response.json({credits:10}); debits++; return Response.json({ok:true}); }
    assert.equal(url.href, "https://api.github.com/repos/moelayyan90/XGuard"); assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${secret}`); writes++; return Response.json({name:"XGuard"});
  });
  const load = async path => {
    const response = await app.fetch(new Request(`https://xguardgate.com${path}`), f.env, {});
    const {document} = parseHTML(await response.text());
    runInNewContext(document.querySelector("script").textContent, {document,crypto,navigator:{clipboard:{writeText:async()=>{}}}, fetch:async(url, init) => {
      const headers = new Headers(init.headers); headers.set("origin","https://xguardgate.com");
      const response = await app.fetch(new Request(url,{...init,headers}),f.env,{waitUntil:task=>f.tasks.push(task)});
      assert.equal(response.headers.get("access-control-allow-origin"),"https://xguardgate.com"); return response;
    }});
    return id=>document.getElementById(id);
  };
  const demo = await load("/demo/secretless"); await demo("run").onclick();
  const demoResult = JSON.parse(demo("result").textContent); assert.equal(demoResult.proof_valid,true);assert.equal(demoResult.out_of_scope_blocked,true);assert.equal(debits,0);assert.equal(writes,0);
  const ui = await load("/operators"); ui("key").value=key;ui("secret").value=secret;
  Object.defineProperty(ui("operation"),"value",{value:"github.repository.read"});
  // Blank forecasts refuse issuance before storing credentials or billing.
  await ui("create").onclick();
  assert.equal(f.namespaces.EGRESS_CREDENTIALS.size, 1); // Internal demo only.
  assert.equal(debits, 0); assert.equal(writes, 0);
  ui("governance").value = JSON.stringify(forecastPolicy("0".repeat(64)));
  await ui("create").onclick();
  const request=JSON.parse(ui("request").textContent); assert.ok(request.capability.startsWith("xgc_")); assert.equal(ui("secret").value,""); assert.equal(ui("request").textContent.includes(secret),false);assert.equal(ui("request").textContent.includes(key),false);
  await ui("execute").onclick();assert.equal(JSON.parse(ui("result").textContent).ok,true);
  await ui("execute").onclick();assert.equal(JSON.parse(ui("result").textContent).receipt.replay,true);assert.equal(debits,1);assert.equal(writes,1);
  await ui("revoke").onclick();assert.equal(ui("execute").disabled,true);assert.equal((await f.call("/v1/secretless/call",request)).status,403);
  await Promise.all(f.tasks);
});
