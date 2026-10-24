import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import StaticAjv from '../src/ajv-static.js';
import { discovery } from '../src/index.js';

test('precompiled discovery validation matches the exact upstream Ajv schema and errors', () => {
  const schema = discovery.bazaar.schema;
  const reference = new Ajv({ strict: false, allErrors: true }).compile(schema);
  const actual = new StaticAjv({ strict: false, allErrors: true }).compile(structuredClone(schema));
  const valid = { ...discovery.bazaar.info, input: { ...discovery.bazaar.info.input, method: 'GET' } };
  const cases = [valid, {}, null, [], { ...valid, input: {} }, { ...valid, input: { ...valid.input, method: 'INVALID' } }];
  for (const from of ['', 3, null, '0x123', '0x' + 'f'.repeat(40)]) for (const nonce of ['', null, '0x123', '0x' + 'a'.repeat(64)]) cases.push({ ...valid, input: { ...valid.input, queryParams: { from, nonce } } });
  for (const value of cases) {
    assert.equal(actual(value), reference(value), JSON.stringify(value));
    assert.deepEqual(actual.errors, reference.errors);
  }
  assert.equal(actual(valid), true);
});

test('unknown or weakened runtime schemas fail closed without compiling code', () => {
  const compiler = new StaticAjv({ strict: false, allErrors: true });
  assert.throws(() => compiler.compile({}), /schema_not_precompiled/);
  const changed = structuredClone(discovery.bazaar.schema); changed.required = [];
  assert.throws(() => compiler.compile(changed), /schema_not_precompiled/);
  assert.throws(() => new StaticAjv({ allErrors: false }), /unsupported_static_validator_options/);
  const reordered = Object.fromEntries(Object.entries(discovery.bazaar.schema).reverse());
  assert.equal(typeof compiler.compile(reordered), 'function');
});
