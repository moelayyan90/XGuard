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
