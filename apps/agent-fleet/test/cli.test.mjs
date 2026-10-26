import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseArgs } from '../cli.mjs';
import { FleetStore } from '../store.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

test('CLI parses explicit combined-model flags and preserves task text as data', () => {
  assert.deepEqual(parseArgs([]), { command: 'help', flags: {} });
  assert.deepEqual(parseArgs(['serve', '--with-model', '--watch', '--concurrency', '4', '--port', '8790']), {
    command: 'serve', flags: { 'with-model': true, watch: true, concurrency: '4', port: '8790' },
  });
  const instruction = 'اكتب نصًا عن $TOTAL و`literal` دون تنفيذ أوامر.';
  assert.equal(parseArgs(['assign', '--task', instruction, '--limit', '2', '--key', 'fixture-key']).flags.task, instruction);
});

test('CLI rejects unknown, repeated, missing-value and positional options', () => {
  for (const args of [
    ['run', '--concurency', '4'],
    ['run', '--concurrency', '2', '--concurrency', '4'],
    ['enqueue', '--task'],
    ['assign', '--task', '--limit', '2'],
    ['serve', '--watch', 'true'],
    ['run', 'unexpected'],
  ]) assert.throws(() => parseArgs(args));
});

test('real CLI persists 2000 profiles and idempotently assigns two filtered jobs without inference', t => {
  const root = mkdtempSync(join(tmpdir(), 'xguard-cli-test-'));
  const state = join(root, 'state');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function invoke(args, { success = true } = {}) {
    const result = spawnSync(process.execPath, [CLI, ...args, '--state', state], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH ?? '', FLEET_STATE_DIR: join(root, 'unused-default') },
    });
    assert.ifError(result.error);
    if (success) {
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    }
    assert.notEqual(result.status, 0);
    return result;
  }

  assert.deepEqual(invoke(['init', '--count', '2000']), { inserted: 2000, existing: 0, total: 2000 });
  assert.deepEqual(invoke(['init', '--count', '2000']), { inserted: 0, existing: 2000, total: 2000 });
  const initial = invoke(['status']);
  assert.equal(initial.agents, 2000);
  assert.equal(initial.jobs, 0);
  assert.equal(initial.modelCallsToday, 0);
  assert.equal(initial.revenue_usdc, null);
  assert.equal(initial.sale_proven, false);

  const task = 'Prepare a print-production quality checklist from the supplied specification.';
  const assignment = ['assign', '--task', task, '--limit', '2', '--role', 'software_builder',
    '--sector', 'print_production', '--max-steps', '3', '--max-output-tokens', '128', '--key', 'cli-assignment-1'];
  assert.equal(invoke(assignment).assigned, 2);
  assert.equal(invoke(assignment).assigned, 2);
  const status = invoke(['status']);
  assert.equal(status.agents, 2000);
  assert.equal(status.jobs, 2);
  assert.equal(status.queued, 2);
  assert.equal(status.completed, 0);
  assert.equal(status.modelCallsToday, 0);

  const store = new FleetStore(join(state, 'fleet.sqlite'));
  try {
    const jobs = store.listJobs();
    assert.equal(new Set(jobs.map(job => job.agentId)).size, 2);
    for (const job of jobs) {
      assert.equal(job.instruction, task);
      assert.equal(job.maxSteps, 3);
      assert.equal(job.maxOutputTokens, 128);
      assert.equal(job.result, null);
      assert.equal(store.agent(job.agentId).role, 'software_builder');
      assert.equal(store.agent(job.agentId).sector, 'print_production');
    }
  } finally { store.close(); }

  const changed = [...assignment]; changed[changed.indexOf('--task') + 1] = 'A different task must not reuse this key.';
  assert.match(invoke(changed, { success: false }).stderr, /idempotency_conflict/);
  invoke(['assign', '--task', 'Invalid oversized step setting', '--limit', '2', '--max-steps', '9'], { success: false });
  const final = invoke(['status']);
  assert.equal(final.jobs, 2);
  assert.equal(final.modelCallsToday, 0);
  assert.equal(final.revenue_usdc, null);
});
