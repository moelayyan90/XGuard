import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import StandaloneAjv2020 from "../src/ajv2020-standalone.js";
import discovery from "../src/discovery.js";

const options = { strict: false, allErrors: true };
const declared = discovery.bazaar;
const enriched = bazaarResourceServerExtension.enrichDeclaration(declared, {
  method: "GET", routePattern: "/v1/reconcile", adapter: { getPath: () => "/v1/reconcile" }
});

for (const [name, extension] of Object.entries({ declared, enriched })) {
  test(`standalone ${name} validator preserves Ajv decisions and errors`, () => {
    const original = new Ajv2020(options).compile(extension.schema);
    const standalone = new StandaloneAjv2020(options).compile(extension.schema);
    const valid = { ...extension.info, input: { ...extension.info.input, method: "GET" } };
    const cases = [valid, null, {}, { input: [] }, ...[
      input => { delete input.method; },
      input => { input.method = "POST"; },
      input => { input.method = "HEAD"; },
      input => { input.type = "mcp"; },
      input => { input.queryParams.from = "invalid"; },
      input => { input.queryParams.nonce = "0x1234"; },
      input => { delete input.queryParams.from; },
      input => { delete input.queryParams.nonce; },
      input => { input.unexpected = true; },
    ].map(mutate => { const value = structuredClone(valid); mutate(value.input); return value; })];
    for (const value of cases) {
      assert.equal(standalone(value), original(value), JSON.stringify(value));
      assert.deepEqual(standalone.errors, original.errors);
    }
    // SDK enrichment/reconstruction need not retain object key order.
    const reordered = Object.fromEntries(Object.entries(extension.schema).reverse());
    assert.equal(new StandaloneAjv2020(options).compile(reordered)(valid), true);
  });
}

test("unknown or weakened schemas and changed Ajv options are rejected", () => {
  const ajv = new StandaloneAjv2020(options);
  for (const schema of [true, false, {}, { type: "object" }]) assert.throws(() => ajv.compile(schema), /Unknown Bazaar schema/);
  const changed = structuredClone(declared.schema);
  changed.properties.input.properties.queryParams.required = [];
  assert.throws(() => ajv.compile(changed), /Unknown Bazaar schema/);
  assert.throws(() => new StandaloneAjv2020({ strict: false, allErrors: false }), /Unsupported Ajv options/);
});

test("generated validators contain no dynamic evaluation or Ajv compiler dependency", async () => {
  const code = await readFile(new URL("../src/generated/bazaar-validators.js", import.meta.url), "utf8");
  assert.doesNotMatch(code, /\bnew\s+Function\s*\(|\beval\s*\(|ajv\/dist\/compile/);
});
