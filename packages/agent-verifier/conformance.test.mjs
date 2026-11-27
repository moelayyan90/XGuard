import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPolicy, reviewOffer, reviewReceipt } from './verify.mjs';

const suite = JSON.parse(readFileSync(new URL('./conformance/v1.json', import.meta.url)));
for (const row of suite.cases) {
  test('portable profile v1 / ' + row.name, () => {
    const policy = structuredClone(suite.current.policy);
    if (row.cutoffOffset) policy.resources[0].retiredReceiptKeys[0].lastIssuedAt += row.cutoffOffset;
    const rules = loadPolicy(policy);
    const input = structuredClone((row.old ? suite.prior : suite.current)[row.action + 'Input']);
    if (row.set) {
      const [path, value] = row.set;
      const parent = path.slice(0, -1).reduce((item, k) => item[k], input);
      parent[path.at(-1)] = value;
    }
    const check = row.action === 'offer' ? reviewOffer : reviewReceipt;
    let result;
    try { result = check(rules, input, suite.clock + (row.clockOffset ?? 0)).status; }
    catch (error) { result = error.message; }
    assert.equal(result, row.want);
  });
}
