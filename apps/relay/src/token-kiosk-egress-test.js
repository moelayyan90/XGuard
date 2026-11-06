// Controlled upstream fixtures only. These tests never contact GAIB or spend credit.
import test from "node:test";
import assert from "node:assert/strict";
import egress, { __test, EgressKeyAuthority, EgressCredentialState, EgressCapabilityState, EgressTenantIndex, EgressMeter } from "./egress-vault.js";
import { ProofAuthority } from "./product-entry.js";
import { digestBytes, credentialVariants, MAX_RESULT_BYTES } from "./core/execution-contract.js";

const ORIGIN = "https://api-token-kiosk.gaib.ai";
const SECRET = "fixture-token-kiosk-secret/plus+=";
const encoder = new TextEncoder();

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
  const state = { bills: 0, upstreams: 0, upstream: options.upstream, logs: [] };
  const namespaces = new Map();
  for (const [name, Class] of Object.entries({ EGRESS_KEYS: EgressKeyAuthority, EGRESS_CREDENTIALS: EgressCredentialState, EGRESS_CAPABILITIES: EgressCapabilityState, EGRESS_TENANTS: EgressTenantIndex, EGRESS_METER: EgressMeter, PROOF_AUTHORITY: ProofAuthority })) {
    const objects = new Map();
    namespaces.set(name, objects);
    env[name] = { idFromName: name => name, get(id) {
      if (!objects.has(id)) {
        const storage = new Storage();
        objects.set(id, { storage, object: new Class({ storage }, env) });
      }
      return { fetch(input, init) { return objects.get(id).object.fetch(input instanceof Request ? input : new Request(input, init)); } };
    } };
  }
  for (const name of ["log", "info", "warn", "error", "debug"]) t.mock.method(console, name, (...args) => state.logs.push(args));
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (["one.one.one.one", "cloudflare-dns.com", "dns.google"].includes(url.hostname)) return Response.json({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
    if (url.hostname === "billing.test") {
      if (url.pathname === "/v1/balance") return Response.json({ credits: 100 });
      if (url.pathname === "/v1/consume") { state.bills++; return Response.json({ ok: true }); }
    }
    assert.equal(url.origin, ORIGIN, "fixture must never contact another origin");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${SECRET}`);
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    state.upstreams++;
    if (state.upstream) return state.upstream(url, init);
    return Response.json({ id: "fixture-completion", model: "fixture-model", choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 } });
  });
  const post = (path, body, key) => egress.fetch(new Request(`https://api.xguardgate.com${path}`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-xguard-key": key } : {}) }, body: JSON.stringify(body) }), env);
  const owner = "fixture-token-kiosk-operator";
  const created = await post("/v1/egress/credentials", { provider: "token_kiosk", value: SECRET }, owner);
  assert.equal(created.status, 201);
  const publicCredential = await created.json();
  const grant = { credential_id: publicCredential.credential.id, target_origin: ORIGIN, path_prefix: "/v1/chat/completions", allowed_methods: ["POST"], ttl_seconds: 300, max_calls: 30, max_total_credits: 30 };
  const issued = await post("/v1/egress/capabilities", grant, owner);
  assert.equal(issued.status, 201);
  const capabilityResponse = await issued.json();
  const input = { capability: capabilityResponse.capability, target: `${ORIGIN}/v1/chat/completions`, method: "POST", idempotency_key: "token-kiosk-fixture-0001", body_json: { model: "fixture-model", messages: [{ role: "user", content: "Reply OK only." }], max_tokens: 8, stream: false } };
  return { env, state, namespaces, post, owner, grant, publicCredential, capabilityResponse, input, execute: (body = input) => post("/v1/egress/fetch", body) };
}

function assertSecretless(...values) {
  const text = JSON.stringify(values);
  for (const variant of credentialVariants(SECRET)) assert.equal(text.includes(variant), false, "fixture credential must stay server-side");
}

test("Token Kiosk fixture: preset pins Bearer injection, host and exact method/path pairs", async () => {
  const policy = __test.providerPolicy("token_kiosk", { allowed_hosts: ["untrusted.example"], header_name: "x-api-key" });
  assert.deepEqual(policy.allowed_hosts, ["api-token-kiosk.gaib.ai"]);
  assert.deepEqual(policy.injection, { header: "authorization", prefix: "Bearer " });
  for (const [path, method, allowed] of [["/v1/models", "GET", true], ["/v1/chat/completions", "POST", true], ["/v1/models", "POST", false], ["/v1/chat/completions", "GET", false], ["/v1/models/extra", "GET", false], ["/v1/auth/keys", "POST", false]]) {
    assert.equal(__test.targetAllowed(policy, new URL(ORIGIN + path), method), allowed);
  }
  assert.equal(__test.providerPolicy("token_kiosk", { allowed_paths: ["/"] }), null);
  assert.equal(__test.providerPolicy("token_kiosk", { allowed_methods: ["DELETE"] }), null);
  const response = await egress.fetch(new Request("https://api.xguardgate.com/v1/egress/providers"), {});
  assert.equal((await response.json()).providers.token_kiosk.exact_routes.length, 2);
});

test("Token Kiosk fixture: agent request, response, headers, logs and encrypted records exclude the credential; ProofRail verifies", async t => {
  const f = await fixture(t);
  const first = await f.execute();
  assert.equal(first.status, 200);
  const body = await first.text();
  assert.equal(JSON.parse(body).choices[0].message.content, "OK");
  const verification = await f.env.PROOF_AUTHORITY.get("proofrail-root-v1").fetch("https://proofrail/verify", { method: "POST", body: JSON.stringify({ proof: first.headers.get("x-xguard-proof") }) });
  const evidence = await verification.json();
  assert.equal(evidence.valid, true);
  assert.equal(evidence.payload.body_sha256, await digestBytes(body));
  assert.equal(evidence.payload.target_origin, ORIGIN);
  const stored = ["EGRESS_CREDENTIALS", "EGRESS_CAPABILITIES", "EGRESS_METER"].map(name => [...f.namespaces.get(name).values()].map(x => [...x.storage.values]));
  assertSecretless(f.publicCredential, f.capabilityResponse, f.input, body, [...first.headers], evidence, f.state.logs, stored);
});

test("Token Kiosk fixture: off-host, off-path, encoded traversal and wrong-method escapes send zero upstream calls", async t => {
  const f = await fixture(t);
  const attacks = [
    { target: "https://untrusted.example/v1/chat/completions" },
    { target: "https://api-token-kiosk.gaib.ai.untrusted.example/v1/chat/completions" },
    { target: ORIGIN + "/v1/auth/keys" },
    { target: ORIGIN + "/v1/chat/completions/extra" },
    { target: ORIGIN + "/v1/%2e%2e/auth/keys" },
    { target: ORIGIN + "/v1/chat/completions/../../auth/keys" },
    { target: ORIGIN + "/v1/chat/completions", method: "DELETE" },
    { method: "GET", body_json: undefined },
    { method: "OPTIONS", body_json: undefined },
    { target: "http://api-token-kiosk.gaib.ai/v1/chat/completions" },
    { target: "https://api-token-kiosk.gaib.ai:8443/v1/chat/completions" },
  ];
  for (const [index, attack] of attacks.entries()) {
    const response = await f.execute({ ...f.input, ...attack, idempotency_key: `token-kiosk-escape-${index}` });
    assert.ok(response.status >= 400 && response.status < 500);
    assertSecretless(await response.text(), [...response.headers]);
  }
  assert.equal(f.state.upstreams, 0);
  assert.equal(f.state.bills, 0);
});

test("Token Kiosk fixture: capabilities cannot widen the exact route or combine GET and POST", async t => {
  const f = await fixture(t);
  for (const patch of [{ path_prefix: "/v1/chat/completions/extra" }, { allowed_methods: ["GET", "POST"] }, { path_prefix: "/v1/models", allowed_methods: ["POST"] }]) {
    assert.equal((await f.post("/v1/egress/capabilities", { ...f.grant, ...patch }, f.owner)).status, 403);
  }
  const issued = await f.post("/v1/egress/capabilities", { ...f.grant, path_prefix: "/v1/models", allowed_methods: ["GET"] }, f.owner);
  assert.equal(issued.status, 201);
  f.state.upstream = async () => Response.json({ data: [{ id: "fixture-model" }] });
  const response = await f.execute({ capability: (await issued.json()).capability, target: ORIGIN + "/v1/models", method: "GET" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].id, "fixture-model");
});

test("Token Kiosk fixture: header overrides cannot replace the operator credential", async t => {
  const f = await fixture(t);
  const response = await f.execute({ ...f.input, headers: { Authorization: "Bearer attacker-value", "X-XGuard-Key": "attacker-key" } });
  assert.equal(response.status, 200);
  assert.equal(f.state.upstreams, 1);
});

test("Token Kiosk fixture: cross-origin redirects are returned without following or forwarding credentials", async t => {
  const f = await fixture(t, { upstream: async () => new Response(null, { status: 302, headers: { location: "https://untrusted.example/collect", "x-echo-secret": SECRET } }) });
  const response = await f.execute();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://untrusted.example/collect");
  assert.equal(f.state.upstreams, 1);
  assertSecretless([...response.headers], await response.text(), f.state.logs);
});

test("Token Kiosk fixture: reflected credential variants, including split chunks, are withheld and never re-executed", async t => {
  const f = await fixture(t);
  for (const [index, variant] of [...new Set(credentialVariants(SECRET))].entries()) {
    f.state.upstream = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(variant.slice(0, 8))); controller.enqueue(encoder.encode(variant.slice(8))); controller.close(); } }));
    const input = { ...f.input, idempotency_key: `token-kiosk-reflection-${index}` };
    const response = await f.execute(input);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.reason, "credential_reflected_by_upstream");
    assertSecretless(body, [...response.headers], f.state.logs);
    assert.equal((await f.execute(input)).headers.get("x-xguard-replay"), "true");
    assert.equal(f.state.upstreams, index + 1);
  }
});

test("Token Kiosk fixture: response headers suppress reusable auth and any reflected secret", async t => {
  const f = await fixture(t, { upstream: async () => Response.json({ ok: true }, { headers: { authorization: SECRET, "x-api-key": SECRET, "set-cookie": "fixture-session", "x-reflection": btoa(SECRET), "x-provider-request-id": "fixture-public-id" } }) });
  const response = await f.execute();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("x-api-key"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-reflection"), null);
  assert.equal(response.headers.get("x-provider-request-id"), "fixture-public-id");
  assertSecretless([...response.headers]);
});

test("Token Kiosk fixture: duplicate and changed retries preserve exactly one upstream execution", async t => {
  const f = await fixture(t);
  const first = await f.execute();
  const body = await first.text();
  const replay = await f.execute();
  assert.equal(await replay.text(), body);
  assert.equal(replay.headers.get("x-xguard-proof"), first.headers.get("x-xguard-proof"));
  assert.equal(replay.headers.get("x-xguard-replay"), "true");
  const conflict = await f.execute({ ...f.input, body_json: { ...f.input.body_json, max_tokens: 9 } });
  assert.equal(conflict.status, 409);
  assert.equal(f.state.upstreams, 1);
  assert.equal(f.state.bills, 1);
});

test("Token Kiosk fixture: transport timeout messages cannot leak credentials or cause re-execution", async t => {
  const f = await fixture(t, { upstream: async () => { throw new DOMException(`fixture timeout ${SECRET}`, "TimeoutError"); } });
  const response = await f.execute();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.reason, "upstream_transport_failed");
  assertSecretless(body, [...response.headers], f.state.logs);
  assert.equal((await f.execute()).headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.upstreams, 1);
});

test("Token Kiosk fixture: response size limits fail closed and preserve the durable outcome", async t => {
  const f = await fixture(t, { upstream: async () => new Response("x".repeat(MAX_RESULT_BYTES + 1)) });
  const response = await f.execute();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "response_too_large");
  assert.equal((await f.execute()).headers.get("x-xguard-replay"), "true");
  assert.equal(f.state.upstreams, 1);
});

test("Token Kiosk fixture: upstream error bodies and statuses survive without retry", async t => {
  const f = await fixture(t);
  for (const status of [400, 401, 429, 502, 504]) {
    const body = { error: "FIXTURE_ERROR", message: "Fixture provider error" };
    f.state.upstream = async () => Response.json(body, { status });
    const response = await f.execute({ ...f.input, idempotency_key: `token-kiosk-status-${status}` });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
  assert.equal(f.state.upstreams, 5);
});

test("Token Kiosk fixture: tool-call SSE bytes survive but the existing gateway buffers until stream completion", async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const end = new Promise(resolve => { release = resolve; });
  const events = ['data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"fixture-tool","type":"function","function":{"name":"add","arguments":"{\\\"a\\\":2,"}}]}}]}\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"b\\\":3}"}}]}}]}\n\ndata: [DONE]\n\n'];
  const f = await fixture(t, { upstream: async () => new Response(new ReadableStream({ async start(controller) { controller.enqueue(encoder.encode(events[0])); entered(); await end; controller.enqueue(encoder.encode(events[1])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }) });
  let completed = false;
  const pending = f.execute({ ...f.input, body_json: { ...f.input.body_json, stream: true, tools: [{ type: "function", function: { name: "add", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } } }] } }).then(response => { completed = true; return response; });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, "the gateway has not delivered the first SSE bytes");
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), events.join(""));
  assert.equal(response.headers.get("content-type"), "text/event-stream");
});
