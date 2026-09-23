import test from "node:test";
import assert from "node:assert/strict";
import egress, { EgressKeyAuthority, EgressCredentialState, EgressCapabilityState, EgressTenantIndex, EgressMeter } from "./egress-vault.js";
import product, { ProofAuthority } from "./product-entry.js";
import { digestBytes, requestDigest, MAX_RESULT_BYTES } from "./core/execution-contract.js";

class Storage {
  values = new Map();
  queue = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async deleteAll() { this.values.clear(); }
  async setAlarm(at) { this.alarm = at; }
  async transaction(callback) {
    const result = this.queue.then(() => callback(this));
    this.queue = result.catch(() => {});
    return result;
  }
}

async function fixture(t, options = {}) {
  const env = { EGRESS_EXECUTION_CREDITS: "1", XGUARD_BILLING_URL: "https://billing.test" };
  const state = { bills: 0, upstreams: 0, order: [], credit: 100, upstream: options.upstream, privateDns: false, failCommit: false };
  const namespaces = new Map();
  for (const [name, Class] of Object.entries({ EGRESS_KEYS: EgressKeyAuthority, EGRESS_CREDENTIALS: EgressCredentialState, EGRESS_CAPABILITIES: EgressCapabilityState, EGRESS_TENANTS: EgressTenantIndex, EGRESS_METER: EgressMeter, PROOF_AUTHORITY: ProofAuthority })) {
    const objects = new Map();
    namespaces.set(name, objects);
    env[name] = {
      idFromName: name => name,
      get(id) {
        if (!objects.has(id)) { const storage = new Storage(); objects.set(id, { storage, object: new Class({ storage }, env) }); }
        return { fetch(input, init) {
          const request = input instanceof Request ? input : new Request(input, init);
          if (state.failCommit && new URL(request.url).pathname === "/complete") throw new Error("simulated_result_commit_failure");
          if (state.failCredential && new URL(request.url).pathname === "/use") throw new Error("credential_service_connection_refused");
          return objects.get(id).object.fetch(request);
        } };
      },
    };
  }
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) return Response.json({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: state.privateDns ? "127.0.0.1" : "93.184.216.34" }] : [] });
    if (url.hostname === "billing.test") {
      if (url.pathname === "/v1/balance") return Response.json({ credits: state.credit });
      if (url.pathname === "/v1/consume") {
        state.bills += 1;
        state.order.push("bill");
        if (options.billingFailure) return Response.json({ error: "unavailable" }, { status: 503 });
        state.credit -= JSON.parse(init.body).units;
        return Response.json({ ok: true });
      }
    }
    assert.equal(url.hostname, "api.github.com");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-upstream-secret-98765");
    assert.equal(init.redirect, "manual");
    state.upstreams += 1;
    state.order.push("upstream");
    if (state.upstream) return state.upstream(init);
    return Response.json({ id: "fixture-result", created: true }, { status: 201 });
  });
  const post = (path, body, key) => egress.fetch(new Request(`https://api.xguardgate.com${path}`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-xguard-key": key } : {}) }, body: JSON.stringify(body) }), env);
  const owner = "fixture-owner-license";
  const created = await post("/v1/egress/credentials", { provider: "github", value: "fixture-upstream-secret-98765", allowed_paths: ["/repos/acme/service"], allowed_methods: ["GET", "POST"] }, owner);
  assert.equal(created.status, 201);
  const credential = (await created.json()).credential;
  const grant = { credential_id: credential.id, target_origin: "https://api.github.com", path_prefix: "/repos/acme/service", allowed_methods: ["GET", "POST"], max_calls: 10, max_total_credits: options.budget ?? 10 };
  grant.governance = {
    version: 1, currency: "USD", minimum_net_usd_micros: "100", daily_cost_limit_usd_micros: options.dailyLimit || "100000",
    forecasts: [{ request_digest: await requestDigest("https://api.github.com/repos/acme/service/issues", "POST", new Headers({ "content-type": "application/json" }), JSON.stringify({ title: "Fixture operation" })),
      revenue_if_success_usd_micros: options.revenue || "10000", success_probability_bps: 9000, api_cost_usd_micros: "500", compute_cost_usd_micros: "100",
      payment_cost_usd_micros: "100", slippage_cost_usd_micros: "100", safety_buffer_cost_usd_micros: "100", failure_loss_usd_micros: "100",
      valid_until: new Date(Date.now() + 60000).toISOString() }],
  };
  const issued = await post("/v1/egress/capabilities", grant, owner);
  assert.equal(issued.status, 201);
  const capability = (await issued.json()).capability;
  const input = { capability, target: "https://api.github.com/repos/acme/service/issues", method: "POST", idempotency_key: "order-fulfillment-001", body_json: { title: "Fixture operation" } };
  // Existing execution tests now run through real governance. Security tests
  // explicitly request the unsigned input to exercise missing/tampered tickets.
  if (!options.governance) {
    const approval = await post("/v1/egress/authorize", input);
    assert.equal(approval.status, 200);
    input.governance_authorization = (await approval.json()).authorization;
  }
  return { env, state, namespaces, post, owner, grant, input, execute: (body = input) => post("/v1/egress/fetch", body) };
}

async function authorize(f, input = f.input) {
  const response = await f.post("/v1/egress/authorize", input);
  assert.equal(response.status, 200, await response.clone().text());
  const value = await response.json();
  return { ...input, governance_authorization: value.authorization };
}
test("operator provisioning cannot omit the mandatory governance policy", async t => {
  const f = await fixture(t, { governance: true });
  const { governance, ...withoutPolicy } = f.grant;
  const denied = await f.post("/v1/egress/capabilities", withoutPolicy, f.owner);
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).error, "governance_policy_required");
  assert.equal(f.namespaces.get("EGRESS_CAPABILITIES").size, 1);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("a persisted legacy grant fails closed even with a previously valid signed ticket", async t => {
  const f = await fixture(t);
  const entry = [...f.namespaces.get("EGRESS_CAPABILITIES").values()][0];
  const record = await entry.storage.get("record");
  // Model an actual pre-migration durable record, not a client-selectable mode.
  delete record.governance; delete record.governance_state;
  await entry.storage.put("record", record);
  for (const path of ["/v1/egress/fetch", "/v1/egress/authorize"]) {
    const denied = await f.post(path, f.input);
    assert.equal(denied.status, 412);
    assert.equal((await denied.json()).error, "governance_policy_required");
  }
  assert.equal((await entry.storage.get("record")).governance_state, "HALTED");
  entry.object = new EgressCapabilityState({ storage: entry.storage }, f.env);
  assert.equal((await f.execute()).status, 412);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("legacy migration preserves read-only recovery while refusing a fresh dispatch", async t => {
  const f = await fixture(t);
  const original = await f.execute();
  const originalBytes = await original.text();
  const entry = [...f.namespaces.get("EGRESS_CAPABILITIES").values()][0];
  const record = await entry.storage.get("record");
  delete record.governance; delete record.governance_state;
  await entry.storage.put("record", record);
  assert.equal((await f.execute()).status, 412);
  const recovered = await f.post("/v1/egress/recover", f.input);
  assert.equal(recovered.status, 201);
  assert.equal(recovered.headers.get("x-xguard-replay"), "true");
  assert.equal(await recovered.text(), originalBytes);
  assert.equal(f.state.bills, 1); assert.equal(f.state.upstreams, 1);
});
test("strict governance requires a real signed authorization and raw egress cannot bypass it", async t => {
  const f = await fixture(t, { governance: true });
  assert.equal((await f.execute()).status, 403);
  assert.equal((await f.post("/v1/egress/authorize", f.input)).status, 423);
  const entry = [...f.namespaces.get("EGRESS_CAPABILITIES").values()][0];
  entry.object = new EgressCapabilityState({ storage: entry.storage }, f.env);
  assert.equal((await f.post("/v1/egress/authorize", f.input)).status, 423);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("strict handshake exposes no credentials, authenticates before latching and records exact economics", async t => {
  const f = await fixture(t, { governance: true });
  assert.equal((await f.execute({ ...f.input, capability: f.input.capability + "invalid" })).status, 403);
  const approved = await authorize(f);
  const proof = await (await f.env.PROOF_AUTHORITY.get("proofrail-root-v1").fetch("https://proofrail/verify", { method: "POST", body: JSON.stringify({ proof: approved.governance_authorization }) })).json();
  assert.equal(proof.valid, true);
  assert.equal(proof.payload.economics.net_expected_usd_micros, "8090");
  assert.equal(JSON.stringify(proof).includes("fixture-upstream-secret"), false);
  assert.equal(proof.payload.economics.realized_profit_usd_micros, null);
  assert.equal((await f.execute(approved)).status, 201);
  assert.equal((await f.execute(approved)).headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.bills, 1); assert.equal(f.state.upstreams, 1);
});
test("strict tickets bind the request and business key; modifications halt before any billing", async t => {
  const f = await fixture(t, { governance: true });
  const approved = await authorize(f);
  assert.equal((await f.execute({ ...approved, idempotency_key: "different-business-key" })).status, 403);
  assert.equal((await f.execute(approved)).status, 423);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("tampered signature cannot authorize execution", async t => {
  const f = await fixture(t, { governance: true });
  const approved = await authorize(f);
  const [payload, signature] = approved.governance_authorization.split(".");
  const tampered = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.equal((await f.execute({ ...approved, governance_authorization: tampered })).status, 403);
  assert.equal(f.state.upstreams, 0);
});
test("an authenticated attempt to bypass through a private target latches the workload", async t => {
  const f = await fixture(t, { governance: true });
  assert.equal((await f.execute({ ...f.input, target: "https://127.0.0.1/private" })).status, 400);
  assert.equal((await f.post("/v1/egress/governance-status", { capability: f.input.capability })).status, 200);
  assert.equal((await f.post("/v1/egress/authorize", f.input)).status, 423);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("credential service transport failure stops the workload and never bills or dispatches", async t => {
  const f = await fixture(t, { governance: true });
  const approved = await authorize(f); f.state.failCredential = true;
  assert.equal((await f.execute(approved)).status, 503);
  assert.equal((await f.post("/v1/egress/authorize", f.input)).status, 423);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("expired tickets cannot start work and a fresh ticket does not bypass expired forecasts", async t => {
  const f = await fixture(t, { governance: true });
  const approved = await authorize(f), now = Date.now();
  t.mock.method(Date, "now", () => now + 31000);
  assert.equal((await f.execute(approved)).status, 412);
  const refreshed = await authorize(f);
  const entry = [...f.namespaces.get("EGRESS_CAPABILITIES").values()][0];
  const record = await entry.storage.get("record"); record.governance.forecasts[0].valid_until = new Date(now).toISOString();
  await entry.storage.put("record", record);
  assert.equal((await f.execute(refreshed)).status, 412);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("a valid signature for an execution receipt cannot be substituted for authorization", async t => {
  const f = await fixture(t, { governance: true });
  const signed = await (await f.env.PROOF_AUTHORITY.get("proofrail-root-v1").fetch("https://proofrail/sign", { method: "POST", body: JSON.stringify({ payload: { typ: "xguard-proofrail-egress" } }) })).json();
  assert.equal((await f.execute({ ...f.input, governance_authorization: signed.proof })).status, 403);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("nonpositive net expected value never authorizes; no payment is made for a forecast", async t => {
  const f = await fixture(t, { governance: true, revenue: "1000" });
  const response = await f.post("/v1/egress/authorize", f.input);
  assert.equal(response.status, 412);
  assert.equal((await response.json()).error, "net_expected_value_below_floor");
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("UTC daily exposure is shared across freshly issued capabilities for the same owner", async t => {
  const f = await fixture(t, { governance: true, dailyLimit: "1000" });
  assert.equal((await f.execute(await authorize(f))).status, 201);
  const newCap = await f.post("/v1/egress/capabilities", f.grant, f.owner);
  assert.equal(newCap.status, 201);
  const next = { ...f.input, capability: (await newCap.json()).capability, idempotency_key: "next-business-operation" };
  const refused = await f.execute(await authorize(f, next));
  assert.equal(refused.status, 412);
  assert.equal(f.state.upstreams, 1); assert.equal(f.state.bills, 1);
});
test("strict timeout latches, retains exposure, and read-only recovery cannot resubmit", async t => {
  const f = await fixture(t, { governance: true, upstream: async () => { throw new Error("connection_refused"); } });
  const approved = await authorize(f);
  assert.equal((await f.execute(approved)).status, 503);
  assert.equal((await f.post("/v1/egress/authorize", { ...f.input, idempotency_key: "next-business-operation" })).status, 423);
  const replay = await f.post("/v1/egress/recover", f.input);
  assert.equal(replay.status, 503); assert.equal(replay.headers.get("x-xguard-replay"), "true");
  assert.equal((await f.post("/v1/egress/recover", { ...f.input, idempotency_key: "never-sent-operation" })).status, 404);
  assert.equal(f.state.upstreams, 1); assert.equal(f.state.bills, 1);
});
test("explicit halt after authorization blocks dispatch and cannot be reset by an agent", async t => {
  const f = await fixture(t, { governance: true });
  const approved = await authorize(f);
  assert.equal((await f.post("/v1/egress/halt", { capability: f.input.capability })).status, 200);
  assert.equal((await f.execute(approved)).status, 423);
  assert.equal(f.state.bills, 0); assert.equal(f.state.upstreams, 0);
});
test("strict concurrent distinct jobs allow only one in-flight provider operation", async t => {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const blocking = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { governance: true, upstream: async () => { entered(); await blocking; return Response.json({ ok: true }); } });
  const one = await authorize(f), two = await authorize(f, { ...f.input, idempotency_key: "distinct-operation-key" });
  const pending = f.execute(one);
  await ready;
  assert.equal((await f.execute(two)).status, 409);
  release(); assert.equal((await pending).status, 200);
  assert.equal(f.state.upstreams, 1);
});

test("golden path: scoped credential, prepaid charge, useful outcome, valid proof and identical encrypted replay", async t => {
  const f = await fixture(t);
  const first = await f.execute();
  assert.equal(first.status, 201);
  const text = await first.text();
  assert.deepEqual(JSON.parse(text), { id: "fixture-result", created: true });
  assert.deepEqual(f.state.order, ["bill", "upstream"]);
  const proof = first.headers.get("x-xguard-proof");
  const verified = await f.env.PROOF_AUTHORITY.get("proofrail-root-v1").fetch("https://proofrail/verify", { method: "POST", body: JSON.stringify({ proof }) });
  const evidence = await verified.json();
  assert.equal(evidence.valid, true);
  assert.equal(evidence.payload.body_sha256, await digestBytes(text));
  assert.equal(evidence.payload.billed_credits, 1);
  const replay = await f.execute();
  assert.equal(replay.status, 201);
  assert.equal(await replay.text(), text);
  assert.equal(replay.headers.get("x-xguard-proof"), proof);
  assert.equal(replay.headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 1);
  const records = JSON.stringify([...f.namespaces.get("EGRESS_CAPABILITIES").values()].map(x => [...x.storage.values]));
  assert.equal(records.includes("fixture-result"), false);
  assert.equal(records.includes("fixture-upstream-secret-98765"), false);
  assert.equal(records.includes("Fixture operation"), false);
});

test("a reused business key cannot authorize changed body, URL, method or headers", async t => {
  const f = await fixture(t);
  assert.equal((await f.execute()).status, 201);
  for (const patch of [{ body_json: { title: "different" } }, { target: f.input.target + "?changed=1" }, { method: "GET", body_json: undefined }, { headers: { accept: "text/plain" } }]) {
    const response = await f.execute({ ...f.input, ...patch });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "governance_authorization_mismatch");
  }
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 1);
});

test("concurrent retries reserve a single execution and a single charge", async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { upstream: async () => { entered(); await gate; return Response.json({ done: true }); } });
  const first = f.execute();
  await ready;
  const duplicate = await f.execute();
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "execution_in_progress");
  release();
  assert.equal((await first).status, 200);
  assert.equal((await f.execute()).headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 1);
});

test("pending work and an exhausted capability budget both block a distinct operation", async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { budget: 1, upstream: async () => { entered(); await gate; return Response.json({ done: true }, { status: 201 }); } });
  const second = await authorize(f, { ...f.input, idempotency_key: "order-fulfillment-002" });
  const first = f.execute();
  await ready;
  assert.equal((await f.execute(second)).status, 409);
  release(); assert.equal((await first).status, 201);
  assert.equal((await f.execute(second)).status, 402);
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 1);
  assert.equal((await f.execute()).headers.get("x-xguard-replay"), "true");
});

test("a price increase cannot exceed the operator's per-call authorization", async t => {
  const f = await fixture(t);
  f.env.EGRESS_EXECUTION_CREDITS = "2";
  const response = await f.execute();
  assert.equal(response.status, 402);
  assert.equal((await response.json()).error, "capability_credit_budget_exceeded");
  assert.equal(f.state.bills, 0);
});

test("ambiguous billing never releases the provider credential or repeats the charge", async t => {
  const f = await fixture(t, { billingFailure: true });
  const first = await f.execute();
  assert.equal(first.status, 503);
  assert.equal(first.headers.get("x-xguard-egress-state"), "billing_ambiguous");
  assert.equal(first.headers.has("x-xguard-billed-credits"), false);
  const replay = await f.execute();
  assert.equal(replay.headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 0);
});

test("network ambiguity remains a durable outcome across retries and object restart", async t => {
  const f = await fixture(t, { upstream: async () => { throw new Error("simulated_connection_loss"); } });
  const first = await f.execute();
  assert.equal(first.status, 503);
  const proof = first.headers.get("x-xguard-proof");
  const entry = [...f.namespaces.get("EGRESS_CAPABILITIES").values()][0];
  entry.object = new EgressCapabilityState({ storage: entry.storage }, f.env);
  const replay = await f.execute();
  assert.equal(replay.status, 503);
  assert.equal(replay.headers.get("x-xguard-proof"), proof);
  assert.equal(f.state.upstreams, 1);
  assert.equal(f.state.bills, 1);
});

test("a crash after the provider responds cannot lead to automatic reexecution", async t => {
  const f = await fixture(t);
  f.state.failCommit = true;
  assert.equal((await f.execute()).status, 503);
  f.state.failCommit = false;
  assert.equal((await f.execute()).status, 409);
  assert.equal(f.state.upstreams, 1);
  assert.equal(f.state.bills, 1);
});

test("private DNS is rejected before billing and the workload remains halted", async t => {
  const f = await fixture(t, { budget: 1 });
  f.state.privateDns = true;
  assert.equal((await f.execute()).status, 403);
  assert.equal(f.state.bills, 0);
  assert.equal(f.state.upstreams, 0);
  f.state.privateDns = false;
  assert.equal((await f.post("/v1/egress/authorize", { ...f.input, idempotency_key: "different-operation-001" })).status, 423);
  assert.equal(f.state.upstreams, 0);
});

for (const [label, value] of [["oversized", "x".repeat(MAX_RESULT_BYTES + 1)], ["credential-reflecting", "fixture-upstream-secret-98765"]]) test(`${label} upstream results are withheld, halt the workload, and are never refetched`, async t => {
  const f = await fixture(t);
    f.state.upstream = async () => new Response(value);
    const first = await f.execute();
    assert.equal(first.status, 503);
    assert.equal((await first.text()).includes("fixture-upstream-secret-98765"), false);
    assert.equal((await f.execute()).headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.upstreams, 1);
  assert.equal((await f.post("/v1/egress/authorize", f.input)).status, 423);
  const meter = await (await egress.fetch(new Request("https://api.xguardgate.com/v1/egress/stats"), f.env)).json();
  assert.equal(meter.attempts, 1);
  assert.equal(meter.billed_credits, 1);
  assert.equal(meter.ambiguous, 1);
});

test("capability revocation is owner-scoped and blocks new execution and saved-result access", async t => {
  const f = await fixture(t);
  assert.equal((await f.execute()).status, 201);
  const id = [...f.namespaces.get("EGRESS_CAPABILITIES").keys()][0];
  const revoke = key => egress.fetch(new Request(`https://api.xguardgate.com/v1/egress/capabilities/${id}`, { method: "DELETE", headers: { "x-xguard-key": key } }), f.env);
  assert.equal((await revoke("different-owner-key")).status, 403);
  assert.equal((await revoke(f.owner)).status, 200);
  assert.equal((await f.execute()).status, 403);
  assert.equal((await f.execute({ ...f.input, idempotency_key: "operation-after-revocation" })).status, 403);
  assert.equal(f.state.bills, 1);
  assert.equal(f.state.upstreams, 1);
});

test("concurrent first use preserves a single encryption key and signing key across restart", async () => {
  for (const [Class, method] of [[EgressKeyAuthority, "keys"], [ProofAuthority, "keyRecord"]]) {
    const storage = new Storage();
    const object = new Class({ storage });
    const [first, second] = await Promise.all([object[method](), object[method]()]);
    assert.deepEqual(first, second);
    assert.deepEqual(await new Class({ storage })[method](), first);
  }
});

test("invalid authorization limits, missing write keys and nonstandard ports fail without billing", async t => {
  const f = await fixture(t);
  assert.equal((await f.execute({ ...f.input, idempotency_key: undefined })).status, 400);
  assert.equal((await f.execute({ ...f.input, target: "https://api.github.com:8443/repos/acme/service/issues" })).status, 400);
  for (const patch of [{ max_calls: "NaN" }, { ttl_seconds: "Infinity" }, { max_total_credits: -1 }]) assert.equal((await f.post("/v1/egress/capabilities", { ...f.grant, ...patch }, f.owner)).status, 400);
  f.env.EGRESS_EXECUTION_CREDITS = "NaN";
  assert.equal((await f.execute()).status, 503);
  assert.equal(f.state.bills, 0);
});

test("MCP preserves the status, execution identifier and stored proof for JSON responses", async t => {
  const f = await fixture(t);
  const call = () => product.fetch(new Request("https://api.xguardgate.com/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "xguard_egress_fetch", arguments: f.input } }) }), f.env);
  const first = (await (await call()).json()).result;
  assert.equal(first.isError, false);
  assert.equal(first.structuredContent.status, 201);
  assert.ok(first.structuredContent.proof);
  const replay = (await (await call()).json()).result;
  assert.equal(replay.structuredContent.proof, first.structuredContent.proof);
  assert.equal(replay.structuredContent.replay, true);
  assert.equal(f.state.upstreams, 1);
});
