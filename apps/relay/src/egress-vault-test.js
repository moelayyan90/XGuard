import test from "node:test";
import assert from "node:assert/strict";
import egress, { __test } from "./egress-vault.js";
import product from "./egress-entry.js";

test("Secretless Egress publishes the credential-broker contract", async () => {
  const response = await egress.fetch(new Request("https://xguardgate.com/api/v1/egress"), { EGRESS_EXECUTION_CREDITS: "1" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.name, "XGuard Secretless Egress");
  assert.equal(data.role, "credential broker and egress choke point for AI agents");
  assert.equal(data.credits_per_authorized_egress_attempt, 1);
  assert.ok(data.providers_supported.includes("openai"));
  assert.ok(data.providers_supported.includes("stripe"));
  assert.ok(data.controls.some(value => value.includes("never returned")));
});

test("Production wrapper publishes provider metadata", async () => {
  const response = await product.fetch(new Request("https://xguardgate.com/api/v1/egress/providers"), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.providers.openai.hosts, ["api.openai.com"]);
  assert.deepEqual(data.providers.stripe.hosts, ["api.stripe.com"]);
  assert.equal(data.providers.anthropic.injection_header, "x-api-key");
});

test("Provider presets bind credentials to known upstream hosts", () => {
  const openai = __test.providerPolicy("openai", {});
  assert.deepEqual(openai.allowed_hosts, ["api.openai.com"]);
  assert.equal(openai.injection.header, "authorization");
  assert.equal(openai.injection.prefix, "Bearer ");
  const anthropic = __test.providerPolicy("anthropic", {});
  assert.deepEqual(anthropic.allowed_hosts, ["api.anthropic.com"]);
  assert.equal(anthropic.injection.header, "x-api-key");
});

test("Custom credentials require explicit public hosts and safe headers", () => {
  const privateHostPolicy = __test.providerPolicy("custom", { header_name: "Authorization", allowed_hosts: ["127.0.0.1"] });
  assert.ok(privateHostPolicy);
  assert.equal(privateHostPolicy.allowed_hosts, null);
  assert.equal(__test.providerPolicy("custom", { header_name: "X-XGuard-Key", allowed_hosts: ["api.example.com"] }), null);
  const custom = __test.providerPolicy("custom", { header_name: "X-API-Key", allowed_hosts: ["api.example.com"], allowed_paths: ["/v1/"] });
  assert.equal(custom.injection.header, "x-api-key");
  assert.deepEqual(custom.allowed_hosts, ["api.example.com"]);
});

test("Target scope rejects private, XGuard and off-policy origins", () => {
  assert.equal(__test.safeTarget("https://127.0.0.1/admin"), null);
  assert.equal(__test.safeTarget("https://xguardgate.com/api/v1/egress"), null);
  const target = __test.safeTarget("https://api.openai.com/v1/responses");
  assert.ok(target);
  const record = { allowed_hosts: ["api.openai.com"], allowed_paths: ["/v1/"], allowed_methods: ["POST"] };
  assert.equal(__test.targetAllowed(record, target, "POST"), true);
  assert.equal(__test.targetAllowed(record, new URL("https://api.openai.com/admin"), "POST"), false);
  assert.equal(__test.targetAllowed(record, new URL("https://evil.example/v1/responses"), "POST"), false);
});

test("Capabilities are opaque scoped tokens", () => {
  const id = "a".repeat(32);
  const secret = "B".repeat(43);
  const parsed = __test.parseCapabilityToken(`xgc_${id}.${secret}`);
  assert.equal(parsed.id, id);
  assert.equal(__test.parseCapabilityToken("not-a-capability"), null);
});

test("User headers cannot override injected credentials or XGuard controls", () => {
  const headers = __test.sanitizeHeaders({ Authorization: "attacker", "X-XGuard-Key": "leak", Accept: "application/json" }, "authorization");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-xguard-key"), null);
  assert.equal(headers.get("accept"), "application/json");
});

test("Secretless Egress ignores unrelated paths", async () => {
  assert.equal(await egress.fetch(new Request("https://xguardgate.com/api/not-egress"), {}), null);
});
