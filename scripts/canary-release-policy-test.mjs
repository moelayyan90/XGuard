import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCanary } from './canary-release-policy.mjs';

test('compatible checkout and public-read fixes receive a canary despite settlement fixture changes', () => {
  for (const source of ['apps/relay/src/action/paypal.js', 'apps/relay/src/live/objects.ts']) {
    assert.deepEqual(selectCanary([source, 'apps/settlement-gateway/test/production-integration.mjs'], true), { gradual: true, live_recovery: false });
  }
});
test('settlement runtime, bindings, billing and incompatible financial state require coordinated deployment', () => {
  const source = 'apps/relay/src/action/paypal.js';
  for (const boundary of ['apps/settlement-gateway/src/worker.js', 'apps/settlement-gateway/package-lock.json', 'apps/settlement-gateway/wrangler.jsonc', 'apps/relay/wrangler.jsonc', 'apps/billing/src/ledger.js']) {
    assert.equal(selectCanary([source, boundary], true).gradual, false);
  }
  assert.equal(selectCanary([source], false).gradual, false);
});
test('sensitive recovery keeps stricter preflight and rejects coordinated or incompatible changes before deployment', () => {
  const source = 'apps/relay/src/live/paid-data.ts';
  assert.deepEqual(selectCanary([source], true), { gradual: true, live_recovery: true });
  assert.throws(() => selectCanary([source], false), /No deployment was attempted/);
  assert.throws(() => selectCanary([source, 'apps/billing/src/ledger.js'], true), /No deployment was attempted/);
});
test('documentation and test-only releases do not upload a canary', () => {
  assert.deepEqual(selectCanary(['docs/readme.md', 'apps/relay/test/action-cloud.test.mjs'], true), { gradual: false, live_recovery: false });
});
