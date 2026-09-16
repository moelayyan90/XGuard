// Production probes never create a valid payment authorization or settle funds.
import assert from "node:assert/strict";
const API = "https://api.xguardgate.com";
const headers = { "content-type": "application/json", "x-xguard-traffic-class": "synthetic",
  "user-agent": "XGuard-Public-Contract-Verifier/1.0", "cache-control": "no-cache" };
async function call(path, body, extra = {}, raw = false) {
  const response = await fetch(API + path, { method: body === undefined ? "GET" : "POST", headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(20000), redirect: "manual" });
  return { response, body: await response.json() };
}
for (const [input, code] of [["", "empty_body"], ['{"payment":', "invalid_json"], ['{"payment":{},"payment":{}}', "duplicate_json_key"]]) {
  const result = await call("/verify", input, { "content-type": "text/plain" }, true);
  assert.equal(result.response.status, 400); assert.equal(result.body.error.code, code);
  assert.equal(result.body.next.path, "/verify"); assert.equal(result.body.request_id, result.response.headers.get("x-xguard-request-id"));
}
const pricing = (await call("/v1/pricing")).body.capabilities;
let version;
for (const input of [{ tool_id: "feed-digest" }, { name: "xguard_execute", arguments: { capability: "feed-digest" } }]) {
  const quoteResult = await call("/v1/pricing/quote", input), quote = quoteResult.body;
  assert.equal(quoteResult.response.status, 200); assert.equal(quote.amount, pricing.find(x => x.id === "feed-digest").amount_atomic);
  const next = new URL(quote.next.execution_url); assert.equal(next.origin, API); assert.equal(next.pathname, "/v1/execute");
  assert.equal(quote.next.quote.header, "X-XGuard-Quote");
  const challenge = await call(next.pathname, quote.next.body, { "X-XGuard-Quote": quote.quote });
  assert.equal(challenge.response.status, 402); assert.equal(challenge.body.accepts[0].amount, quote.amount);
  assert.equal(challenge.body.accepts[0].network, quote.network); assert.equal(challenge.body.target_contacted, false);
  assert.ok(challenge.response.headers.get("payment-required"));
  version = challenge.response.headers.get("x-xguard-worker-version-tag");
}
const conflict = await call("/v1/pricing/quote", { tool: "feed-digest", tool_id: "web-extraction" });
assert.equal(conflict.response.status, 422); assert.equal(conflict.body.error.code, "ambiguous_intent");
const manifest = await call("/.well-known/payment-manifest");
assert.equal(manifest.body.outcome_execution.capabilities.find(x => x.id === "feed-digest").amount_atomic, pricing.find(x => x.id === "feed-digest").amount_atomic);
const directory = await call("/.well-known/agent-directory.json"); assert.equal(directory.body.agents[0].card, API + "/.well-known/agent-card.json");
const demo = await call("/api/v1/execute", { intent: "demo" }); assert.equal(demo.response.status, 200); assert.equal(demo.body.result.network_calls, 0);
console.log(JSON.stringify({ ok: true, observed_at: new Date().toISOString(), worker_version: version,
  malformed_requests_actionable: true, aliases_quote_current_outcomes: true, quote_next_request_executable: true,
  conflicting_instructions_rejected: true, pricing_consistent: true, free_demo_works: true, real_payment_performed: false }));
