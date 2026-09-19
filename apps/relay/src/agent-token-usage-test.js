import assert from "node:assert/strict";
import test from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import app from "./canonical-entry.js";
import { EgressMeter } from "./egress-vault.js";
import billing, { CreditLedger } from "../../billing/src/index.js";
import { digestBytes } from "./core/execution-contract.js";
import { AGENT_USAGE_PATH, MAX_USAGE_TOKENS, TENANT_ALIASES, normalizeAgentUsagePayload, recordUsage } from "./core/agent-usage.js";

const KEY = "xgk_test_operator_key_0123456789";
const OTHER_KEY = "xgk_other_operator_key_0123456789";
const TENANT = "org_125646628718641154";
class Storage {
  values = new Map(); queue = Promise.resolve(); failCommit = false;
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async transaction(callback) {
    const result = this.queue.then(async () => {
      const before = structuredClone(this.values);
      try {
        const result = await callback(this);
        if (this.failCommit) throw new Error("simulated commit failure");
        return result;
      } catch (error) { this.values = before; throw error; }
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
function namespace(Class) {
  const objects = new Map();
  const ns = { idFromName: name => name, getByName: name => ns.get(name), get(name) {
    if (!objects.has(name)) { const storage = new Storage(); objects.set(name, { storage, object: new Class({ storage }) }); }
    return { fetch: (input, init) => objects.get(name).object.fetch(input instanceof Request ? input : new Request(input, init)) };
  } };
  return { ns, objects };
}
async function fixture(t) {
  const accounts = namespace(CreditLedger), meters = namespace(EgressMeter);
  const keyHash = await digestBytes(KEY), otherHash = await digestBytes(OTHER_KEY);
  const logs = [], calls = [];
  for (const hash of [keyHash, otherHash]) {
    accounts.ns.getByName(hash);
    // Matches the existing billing ledger's server-provisioned identity.
    await accounts.objects.get(hash).storage.put("record", { provisioned: true, balance: 0, restricted: false });
  }
  const env = { EGRESS_METER: meters.ns, XGUARD_BILLING_URL: "https://billing.test", XGUARD_USAGE_TENANT_BINDINGS: JSON.stringify({ [keyHash]: TENANT }) };
  const state = { authResponse: null };
  t.mock.method(console, "info", message => logs.push(JSON.parse(message)));
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    calls.push({ path: new URL(request.url).pathname, method: request.method, redirect: init.redirect });
    assert.equal(new URL(request.url).hostname, "billing.test");
    assert.equal(request.method, "GET");
    if (state.authResponse) return state.authResponse();
    return billing.fetch(request, { CREDITS: accounts.ns });
  });
  const send = (body, options = {}) => {
    const headers = { "content-type": "application/json", "cf-connecting-ip": options.ip || "203.0.113.8", ...(options.key === null ? {} : { "x-xguard-key": options.key || KEY }),
      ...(options.eventKey === null ? {} : { "idempotency-key": options.eventKey || "event-001" }), ...options.headers };
    const method = options.method || "POST";
    return app.fetch(new Request(`${options.host || "https://xguardgate.com"}${options.path || AGENT_USAGE_PATH}${options.query || ""}`, {
      method, headers, ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { body: options.raw ?? JSON.stringify(body) } : {}),
    }), env, {});
  };
  const tenantStorage = async (tenant = TENANT) => meters.objects.get(`agent-usage-tenant:${await digestBytes(tenant)}`)?.storage;
  const aggregate = async (tenant = TENANT) => [...(await tenantStorage(tenant))?.values.entries() || []].find(([key]) => key.startsWith("agent-usage:month:"))?.[1];
  return { send, env, state, meters, accounts, calls, logs, keyHash, otherHash, tenantStorage, aggregate };
}

for (const [name, body] of [
  ["camelCase", { inputTokens: 100, outputTokens: 50, totalTokens: 150 }],
  ["snake_case", { input_tokens: 100, output_tokens: 50, total_tokens: 150 }],
  ["nested provider fields", { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }],
  ["computed total", { inputTokens: 100, output_tokens: 50 }],
  ["matching aliases", { inputTokens: 100, input_tokens: 100, usage: { prompt_tokens: 100, completion_tokens: 50 } }],
]) test(`records ${name} with a real provisioned billing identity at zero balance`, async t => {
  const f = await fixture(t), response = await f.send(body, { query: `?tenantId=${TENANT}` });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 50, total_tokens: 150 });
  assert.equal(result.tenant, TENANT); assert.equal(result.duplicate, false);
  assert.equal(result.request_id, response.headers.get("x-xguard-request-id"));
  assert.deepEqual((await f.aggregate()).events, 1);
  assert.deepEqual(f.calls, [{ path: "/v1/balance", method: "GET", redirect: "manual" }]);
  assert.equal((await f.accounts.objects.get(f.keyHash).storage.get("record")).balance, 0);
});

for (const alias of TENANT_ALIASES) test(`accepts trusted ${alias} assertions in query and body`, async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ totalTokens: 0, [alias]: TENANT }, { query: `?${alias}=${TENANT}` })).status, 200);
});

test("exact production route exists on apex/API and deprecated POST alias without redirects", async t => {
  const f = await fixture(t);
  for (const host of ["https://xguardgate.com", "https://api.xguardgate.com"]) {
    for (const path of [AGENT_USAGE_PATH, `/api${AGENT_USAGE_PATH}`]) {
      const response = await f.send({ totalTokens: 1 }, { host, path, query: `?tenantId=${TENANT}`, key: null });
      assert.equal(response.status, 401); assert.equal(response.headers.get("location"), null);
      assert.equal((await response.json()).error.code, "tenant_identity_required");
    }
  }
  assert.equal(f.calls.length, 0); assert.equal(f.meters.objects.size, 0);
});

test("Bearer authentication and derived account tenant work without an organization mapping", async t => {
  const f = await fixture(t);
  delete f.env.XGUARD_USAGE_TENANT_BINDINGS;
  const response = await f.send({ totalTokens: 7 }, { key: null, headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tenant, `xgt_${f.keyHash}`);
});

test("invalid and restricted operator identities are explicitly rejected", async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ totalTokens: 1 }, { key: "xgk_unknown_operator_0123456789" })).status, 401);
  assert.equal((await f.send({ totalTokens: 1 }, { headers: { authorization: `Bearer ${OTHER_KEY}` } })).status, 401);
  assert.equal((await f.send({ totalTokens: 1 }, { key: null, headers: { authorization: "Basic ignored" } })).status, 401);
  await f.accounts.objects.get(f.keyHash).storage.put("record", { provisioned: true, balance: 20, restricted: true });
  const denied = await f.send({ totalTokens: 1 });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, "operator_restricted");
  assert.equal(await f.aggregate(), undefined);
});

test("query, body, and forged headers cannot register or spoof another organization", async t => {
  const f = await fixture(t);
  for (const options of [
    { query: "?tenantId=org_victim" }, { query: `?tenantId=${TENANT}`, key: OTHER_KEY },
    { query: "?tenantId=org_victim", headers: { "x-tenant-id": "org_victim", "x-internal-identity": "trusted", "x-organization-id": "org_victim" } },
  ]) assert.equal((await f.send({ totalTokens: 1 }, options)).status, 403);
  assert.equal((await f.send({ totalTokens: 1, organization_id: "org_victim" })).status, 403);
  assert.equal(await f.aggregate(), undefined);
});

for (const query of ["?tenantId=org_a&tenant_id=org_b", `?tenantId=${TENANT}&tenantId=org_other`, "?tenantId=", "?tenantId=../victim", `?tenantId=${"x".repeat(129)}`]) {
  test(`rejects invalid/ambiguous tenant query ${query.slice(0, 65)}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.send({ totalTokens: 1 }, { query })).status, 400);
    assert.equal(f.calls.length, 0);
  });
}
test("invalid server binding configuration fails closed", async t => {
  const f = await fixture(t); f.env.XGUARD_USAGE_TENANT_BINDINGS = "{broken";
  assert.equal((await f.send({ totalTokens: 1 })).status, 503);
  assert.equal(await f.aggregate(), undefined);
});

for (const [name, body, raw] of [
  ["negative", { inputTokens: -1 }], ["fractional", { outputTokens: 1.2 }], ["huge", { totalTokens: MAX_USAGE_TOKENS + 1 }],
  ["unsafe integer", { totalTokens: Number.MAX_SAFE_INTEGER + 1 }], ["numeric string", { totalTokens: "1" }],
  ["boolean", { totalTokens: true }], ["null count", { totalTokens: null }], ["inconsistent total", { inputTokens: 5, outputTokens: 6, totalTokens: 10 }],
  ["computed oversized total", { inputTokens: MAX_USAGE_TOKENS, outputTokens: 1 }], ["conflicting count aliases", { inputTokens: 1, usage: { prompt_tokens: 2 } }],
  ["array", []], ["scalar", 7], ["null body", null], ["empty counts", {}], ["invalid nested usage", { usage: [] }],
  ["invalid model", { totalTokens: 1, model: {} }], ["invalid agent", { totalTokens: 1, agent: "bad\nagent" }],
  ["malformed JSON", {}, '{"totalTokens":'], ["duplicate JSON property", {}, '{"totalTokens":1,"totalTokens":2}'],
  ["NaN literal", {}, '{"totalTokens":NaN}'], ["Infinity literal", {}, '{"totalTokens":Infinity}'],
  ["infinite numeric exponent", {}, '{"totalTokens":1e999}'],
]) test(`rejects ${name}`, async t => {
  const f = await fixture(t);
  const response = await f.send(body, { raw });
  assert.equal(response.status, 400); assert.equal((await response.json()).accepted, false);
  assert.equal(await f.aggregate(), undefined);
});
test("normalizer rejects non-finite JS values before JSON serialization", () => {
  for (const n of [NaN, Infinity, -Infinity]) assert.throws(() => normalizeAgentUsagePayload({ totalTokens: n }), /integer/);
});

test("enforces declared and actual body byte limits and valid UTF-8", async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ totalTokens: 1 }, { headers: { "content-length": "16385" } })).status, 413);
  assert.equal((await f.send({ totalTokens: 1, ignored: "x".repeat(16385) })).status, 413);
  const raw = new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]);
  assert.equal((await f.send({}, { raw })).status, 400);
  assert.equal(f.calls.length, 0);
});
test("zero, total-only and partial breakdown counts preserve what is known", async t => {
  const f = await fixture(t);
  for (const [body, expected] of [
    [{ inputTokens: 0, outputTokens: 0 }, { input_tokens: 0, output_tokens: 0, total_tokens: 0 }],
    [{ totalTokens: 12 }, { input_tokens: null, output_tokens: null, total_tokens: 12 }],
    [{ inputTokens: 7 }, { input_tokens: 7, output_tokens: null, total_tokens: 7 }],
  ]) {
    const response = await f.send(body, { eventKey: crypto.randomUUID() });
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).usage, expected);
  }
  assert.equal((await f.aggregate()).incomplete_breakdowns, 2);
});

for (const mode of ["Idempotency-Key", "requestId", "request_id", "X-Request-ID"]) test(`deduplicates ${mode} across retries and Worker object recreation`, async t => {
  const f = await fixture(t);
  const body = { inputTokens: 3, outputTokens: 2, ...(["requestId", "request_id"].includes(mode) ? { [mode]: "business-event-1" } : {}) };
  const options = mode === "Idempotency-Key" ? {} : { eventKey: null, ...(mode === "X-Request-ID" ? { headers: { "x-request-id": "business-event-1" } } : {}) };
  const first = await (await f.send(body, options)).json();
  for (const row of f.meters.objects.values()) row.object = new EgressMeter({ storage: row.storage });
  const second = await (await f.send(body, options)).json();
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(first.request_id, second.request_id);
  assert.equal((await f.aggregate()).events, 1);
});

test("concurrent retries are counted once and conflicting payloads return 409", async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 20 }, () => f.send({ totalTokens: 17 })));
  assert.ok(responses.every(response => response.status === 200));
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(new Set(results.map(result => result.request_id)).size, 1);
  const conflict = await f.send({ totalTokens: 18 });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "idempotency_conflict");
  assert.equal((await f.aggregate()).total_tokens, 17);
});

test("event aliases deduplicate across transports; trace changes and unknown fields are ignored", async t => {
  const f = await fixture(t);
  const first = await (await f.send({ totalTokens: 7, requestId: "business-007", ignored: "sensitive" }, { headers: { "x-request-id": "trace-first" } })).json();
  const second = await (await f.send({ total_tokens: 7, request_id: "business-007", another: 42 }, { eventKey: "changed-key", headers: { "x-request-id": "trace-second" } })).json();
  assert.equal(second.duplicate, true); assert.equal(first.request_id, second.request_id);
  assert.equal((await (await f.send({ totalTokens: 7 }, { eventKey: "changed-key" })).json()).duplicate, true);
  assert.equal((await f.aggregate()).events, 1);
  assert.equal(JSON.stringify([...(await f.tenantStorage()).values]).includes("sensitive"), false);
});
test("two independent events cannot be silently joined by conflicting aliases", async t => {
  const f = await fixture(t);
  await f.send({ totalTokens: 7 }, { eventKey: "event-a" });
  await f.send({ totalTokens: 7 }, { eventKey: "event-b" });
  assert.equal((await f.send({ totalTokens: 7, requestId: "event-b" }, { eventKey: "event-a" })).status, 409);
  assert.equal((await f.aggregate()).events, 2);
});
test("missing or malformed identifiers and conflicting request aliases are rejected", async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ totalTokens: 1 }, { eventKey: null })).status, 400);
  assert.equal((await f.send({ totalTokens: 1 }, { eventKey: "bad key" })).status, 400);
  assert.equal((await f.send({ totalTokens: 1, requestId: "a", request_id: "b" })).status, 400);
});
test("idempotency is tenant scoped and separate from existing egress statistics", async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ totalTokens: 5 })).status, 200);
  assert.equal((await f.send({ totalTokens: 9 }, { key: OTHER_KEY })).status, 200);
  assert.equal((await f.aggregate()).total_tokens, 5);
  assert.equal((await f.aggregate(`xgt_${f.otherHash}`)).total_tokens, 9);
  const stats = await f.env.EGRESS_METER.get("meter-v1").fetch("https://meter/stats");
  assert.equal((await stats.json()).attempts, 0);
});

test("IP admission limits authentication traffic; tenant limits persist across changing IPs", async t => {
  const f = await fixture(t);
  await f.send({ totalTokens: 1 });
  const ipStorage = f.meters.objects.get(`agent-usage-ingress:${await digestBytes("203.0.113.8")}`).storage;
  const bucket = Math.floor(Date.now() / 60000);
  await ipStorage.put("agent-usage:rate", { bucket, count: 120 });
  const response = await f.send({ totalTokens: 1 });
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(f.calls.length, 1);
  await (await f.tenantStorage()).put("agent-usage:rate", { bucket, count: 120 });
  assert.equal((await f.send({ totalTokens: 1 }, { ip: "203.0.113.9" })).status, 429);
  assert.equal((await f.aggregate()).events, 1);
});

test("authentication outages and malformed success replies never write usage", async t => {
  const f = await fixture(t);
  for (const authResponse of [() => Response.json({ error: "down" }, { status: 503 }), () => Response.json({ credits: 0 }, { status: 302, headers: { location: "https://untrusted.test" } }), () => Response.json({ ok: true }), () => { throw new Error("timeout including sensitive content"); }]) {
    f.state.authResponse = authResponse;
    const response = await f.send({ totalTokens: 1 });
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "usage_identity_unavailable");
  }
  assert.equal(await f.aggregate(), undefined);
});
test("durable write failure is rejected and transaction rollback permits exactly one later retry", async t => {
  const f = await fixture(t);
  const stub = f.env.EGRESS_METER.get(`agent-usage-tenant:${await digestBytes(TENANT)}`);
  const storage = await f.tenantStorage();
  const event = { tenant: TENANT, usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }, model: null, agent: null,
    request_id: `xgr_${"a".repeat(32)}`, keys: [await digestBytes("event-001")] };
  storage.failCommit = true;
  const fail = await stub.fetch("https://meter/agent-usage/record", { method: "POST", body: JSON.stringify(event) });
  assert.equal(fail.status, 503); assert.equal(storage.values.size, 0);
  storage.failCommit = false;
  assert.equal((await f.send({ inputTokens: 2, outputTokens: 1 })).status, 200);
  assert.equal((await f.aggregate()).events, 1);
});
test("aggregate integer overflow rolls back aliases and counters", async () => {
  const storage = new Storage(), month = new Date().toISOString().slice(0, 7);
  await storage.put(`agent-usage:month:${month}`, { events: 1, input_tokens: 0, output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER, incomplete_breakdowns: 1 });
  await assert.rejects(recordUsage(storage, { tenant: TENANT, request_id: `xgr_${"b".repeat(32)}`, keys: ["a".repeat(64)], model: null, agent: null,
    usage: { input_tokens: null, output_tokens: null, total_tokens: 1 } }), /capacity exceeded/);
  assert.equal(storage.values.size, 1);
});

test("CORS permits only first-party POST and advertised headers", async t => {
  const f = await fixture(t);
  const allowed = await f.send({}, { method: "OPTIONS", headers: { origin: "https://xguardgate.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, idempotency-key" } });
  assert.equal(allowed.status, 204); assert.equal(allowed.headers.get("access-control-allow-origin"), "https://xguardgate.com");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  for (const method of ["OPTIONS", "POST"]) {
    const response = await f.send({ totalTokens: 1 }, { method, headers: { origin: "https://evil.test" } });
    assert.equal(response.status, 403); assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.equal((await f.send({}, { method: "OPTIONS", headers: { origin: "https://xguardgate.com", "access-control-request-method": "DELETE" } })).status, 403);
  assert.equal((await f.send({}, { method: "GET" })).status, 405);
});
test("logs omit keys, bodies, model/agent labels, raw event identifiers and claimed tenants", async t => {
  const f = await fixture(t);
  await f.send({ totalTokens: 1, model: "sensitive-model", agent: "sensitive-agent", password: "sensitive-password" }, { eventKey: "secret-event-id" });
  await f.send({ totalTokens: 1 }, { query: "?tenantId=org_secret_victim" });
  const logs = JSON.stringify(f.logs);
  for (const secret of [KEY, "sensitive-model", "sensitive-agent", "sensitive-password", "secret-event-id", "org_secret_victim", TENANT]) assert.equal(logs.includes(secret), false);
  assert.ok(f.logs.some(log => log.event === "agent_token_usage_recorded" && log.total_tokens === 1));
  assert.ok(f.logs.some(log => log.event === "agent_token_usage_rejected"));
});

test("unknown API endpoints expose recovery; resource 404s keep their original contract", async t => {
  const f = await fixture(t);
  const missing = await f.send({}, { path: "/v1/nonexistent-usage-route", key: null });
  assert.equal(missing.status, 404);
  const body = await missing.json();
  assert.equal(body.error.code, "unsupported_endpoint"); assert.equal(body.requested_endpoint, "/v1/nonexistent-usage-route");
  assert.equal(body.recoverable, true); assert.equal(body.discovery.openapi, "https://api.xguardgate.com/openapi.json");
  const resource = await f.send({}, { path: "/v1/capabilities/missing", method: "GET", key: null });
  assert.equal(resource.status, 404); assert.equal((await resource.json()).error.code, "capability_unavailable");
});
test("runtime OpenAPI documents the real secure ingestion contract and all response codes", async () => {
  const response = await app.fetch(new Request("https://api.xguardgate.com/openapi.json"), {}, {});
  assert.equal(response.status, 200);
  const spec = await response.json(), operation = spec.paths[AGENT_USAGE_PATH].post;
  assert.equal(operation.operationId, "recordAgentTokenUsage");
  assert.equal(operation.security.length, 2); assert.equal(operation.servers.length, 2);
  for (const code of [200, 400, 401, 403, 405, 409, 413, 429, 500, 503]) assert.ok(operation.responses[code]);
  for (const name of TENANT_ALIASES) assert.ok(operation.parameters.find(parameter => parameter.name === name && parameter.in === "query"));
  assert.ok(spec.components.schemas.PublicError);
  assert.equal(spec["x-xguard-agent-usage-contract-version"], "1.0.0");
  assert.ok(spec.paths["/settle"]); assert.ok(spec.paths["/verify"]); assert.ok(spec.paths["/v1/pricing/quote"]);
  await SwaggerParser.validate(structuredClone(spec));
  assert.ok(spec["x-canonical-identity"]); assert.equal(spec.canonical_identity, undefined);
});
