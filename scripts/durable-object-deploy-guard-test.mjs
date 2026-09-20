import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "./durable-object-deploy-guard.mjs";

const config = (migrations) => `{
  // A URL must survive JSONC comment removal.
  "vars": { "ORIGIN": "https://api.xguardgate.com" },
  "durable_objects": { "bindings": [{ "name": "STATE", "class_name": "State" }] },
  "migrations": ${JSON.stringify(migrations)}
}`;

test("allows rollback when the Durable Object lifecycle is identical", () => {
  const migrations = [{ tag: "v1", new_sqlite_classes: ["State"] }];
  const result = evaluate(config(migrations), config(migrations), ["apps/relay/src/index.js"]);
  assert.equal(result.rollbackAllowed, true);
  assert.equal(result.lifecycleChanged, false);
  assert.equal(result.isolated, true);
});

test("permits an isolated migration and forbids rollback", () => {
  const before = config([{ tag: "v1", new_sqlite_classes: ["State"] }]);
  const after = config([{ tag: "v1", new_sqlite_classes: ["State"] }, { tag: "v2", new_sqlite_classes: ["Ledger"] }]);
  const result = evaluate(before, after, ["apps/relay/wrangler.jsonc", "docs/migrations.md"]);
  assert.equal(result.rollbackAllowed, false);
  assert.equal(result.lifecycleChanged, true);
  assert.equal(result.isolated, true);
});

test("blocks a migration bundled with runtime code changes", () => {
  const before = config([{ tag: "v1", new_sqlite_classes: ["State"] }]);
  const after = config([{ tag: "v1", new_sqlite_classes: ["State"] }, { tag: "v2", new_sqlite_classes: ["Ledger"] }]);
  const result = evaluate(before, after, ["apps/relay/wrangler.jsonc", "apps/relay/src/index.js"]);
  assert.equal(result.rollbackAllowed, false);
  assert.equal(result.isolated, false);
  assert.deepEqual(result.runtimeChanges, ["apps/relay/src/index.js"]);
});

test("new payment state permits forward deployment but forbids rollback even without DO migrations", () => {
  const current = config([{ tag: "v1", new_sqlite_classes: ["State"] }]);
  const result = evaluate(current, current, ["apps/relay/src/paid-agent-entry.js"], { previous: 0, current: 1 });
  assert.equal(result.lifecycleChanged, false);
  assert.equal(result.isolated, true);
  assert.equal(result.rollbackAllowed, false);
  assert.equal(result.reason, "payment_state_forward_recovery_required");
  assert.equal(evaluate(current, current, [], { previous: 1, current: 1 }).rollbackAllowed, true);
});

test("blocks a deployment that removes durable payment state safeguards", () => {
  const current = config([{ tag: "v1", new_sqlite_classes: ["State"] }]);
  const result = evaluate(current, current, [], { previous: 1, current: 0 });
  assert.equal(result.isolated, false);
  assert.equal(result.rollbackAllowed, false);
  assert.equal(result.reason, "payment_state_downgrade_forbidden");
});
