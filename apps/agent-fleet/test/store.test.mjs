import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { setTimeout as pause } from 'node:timers/promises';
import { AGENT_CATALOG, createAgentCatalog, MARKETS, ROLES, SECTORS } from '../catalog.mjs';
import { FleetError, FleetStore } from '../store.mjs';

const moduleUrl = new URL('../store.mjs', import.meta.url).href;
const code = expected => error => error instanceof FleetError && error.code === expected;

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'xguard-fleet-store-'));
  const path = join(directory, 'private', 'fleet.sqlite');
  const store = new FleetStore(path, options);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, path, directory };
}

function enqueue(store, index, agentIndex = index, extra = {}) {
  return store.createJob({ agentId: `agent-${String(agentIndex + 1).padStart(6, '0')}`, instruction: `Produce a verified local artifact ${index}`, idempotencyKey: `request-${index}`, ...extra });
}

async function parallelWorkers(path, count, operation) {
  const workers = Array.from({ length: count }, (_, i) => {
    let readyResolve, resultResolve, resultReject;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { FleetStore } = await import(workerData.moduleUrl);
        const store = new FleetStore(workerData.path);
        parentPort.postMessage({ type: 'ready' });
        parentPort.once('message', () => {
          try {
            const job = store.claim('parallel-' + workerData.index);
            let reserved = null, error = null;
            if (job && workerData.operation === 'reserve') {
              try { reserved = store.reserveModelCall(job.id, job.leaseToken); }
              catch (failure) { error = failure.code || failure.message; }
            }
            store.close();
            parentPort.postMessage({ type: 'result', job, reserved, error });
          } catch (error) {
            store.close();
            parentPort.postMessage({ type: 'fatal', message: error.message, code: error.code });
          }
        });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { path, moduleUrl, index: i, operation } });
    worker.on('message', message => {
      if (message.type === 'ready') readyResolve();
      else if (message.type === 'result') resultResolve(message);
      else resultReject(new Error(JSON.stringify(message)));
    });
    worker.on('error', error => { readyResolve(); resultReject(error); });
    const exit = new Promise((resolve, reject) => worker.on('exit', status => status === 0 ? resolve() : reject(new Error(`Worker exited ${status}`))));
    return { worker, ready, result, exit };
  });
  await Promise.all(workers.map(worker => worker.ready));
  workers.forEach(worker => worker.worker.postMessage('go'));
  const results = await Promise.all(workers.map(worker => worker.result));
  await Promise.all(workers.map(worker => worker.exit));
  return results;
}

test('catalog produces 2000 distinct specialist combinations with bounded real tool permissions', () => {
  assert.equal(AGENT_CATALOG.length, 2000);
  assert.equal(ROLES.length, 20); assert.equal(SECTORS.length, 20); assert.equal(MARKETS.length, 5);
  assert.equal(new Set(AGENT_CATALOG.map(agent => agent.id)).size, 2000);
  assert.equal(new Set(AGENT_CATALOG.map(agent => `${agent.role}/${agent.sector}/${agent.market}`)).size, 2000);
  assert.equal(AGENT_CATALOG[0].id, 'agent-000001');
  assert.equal(AGENT_CATALOG.at(-1).id, 'agent-002000');
  for (const agent of AGENT_CATALOG) {
    assert.ok(agent.instructions.includes(agent.id));
    assert.ok(agent.instructions.includes(agent.sector));
    assert.ok(agent.instructions.includes(agent.market));
    assert.ok(agent.allowedTools.includes('read_file'));
    assert.ok(agent.allowedTools.includes('write_file'));
    assert.ok(agent.allowedTools.every(tool => ['read_file', 'write_file', 'web_get'].includes(tool)));
    assert.equal(agent.allowedTools.includes('web_get'), ROLES.find(role => role.id === agent.role).research);
  }
  assert.equal(createAgentCatalog(10000).at(-1).id, 'agent-010000');
  assert.deepEqual(createAgentCatalog(1)[0], AGENT_CATALOG[0]);
  for (const invalid of [0, -1, 10001, 2.5, '2000']) assert.throws(() => createAgentCatalog(invalid), RangeError);
});

test('seeding is persistent and idempotent, conflicts roll back and database files are private', t => {
  const { store, path } = fixture(t);
  assert.deepEqual(store.seed(AGENT_CATALOG), { inserted: 2000, existing: 0, total: 2000 });
  assert.deepEqual(store.seed(AGENT_CATALOG), { inserted: 0, existing: 2000, total: 2000 });
  assert.equal(store.listAgents({ role: 'software_builder', limit: 1000 }).length, 100);
  assert.equal(store.listAgents({ limit: 3, offset: 100 })[0].id, 'agent-000101');
  const second = new FleetStore(path);
  try {
    assert.equal(second.stats().agents, 2000);
    assert.deepEqual(second.agent('agent-000001'), AGENT_CATALOG[0]);
    assert.throws(() => second.seed([{ ...AGENT_CATALOG[0], instructions: 'A changed profile' }]), code('agent_definition_conflict'));
    assert.deepEqual(second.agent('agent-000001'), AGENT_CATALOG[0]);
  } finally { second.close(); }
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
  assert.equal(store.stats().revenue_usdc, null);
  assert.equal(store.stats().sale_proven, false);
});

test('job idempotency survives a second connection and rejects different work for the same key', t => {
  const { store, path } = fixture(t);
  store.seed(createAgentCatalog(2));
  const original = enqueue(store, 1, 0);
  const second = new FleetStore(path);
  try {
    assert.equal(enqueue(second, 1, 0).id, original.id);
    assert.throws(() => enqueue(second, 1, 1), code('idempotency_conflict'));
    assert.throws(() => enqueue(second, 2, 99), code('unknown_agent'));
    assert.equal(second.stats().jobs, 1);
  } finally { second.close(); }
  assert.throws(() => enqueue(store, 3, 0, { instruction: 'ش'.repeat(18000) }), code('input_too_large'));
  for (const [key, value] of [['maxSteps', 9], ['maxOutputTokens', 31], ['maxOutputTokens', 1025]]) {
    assert.throws(() => enqueue(store, 4, 0, { [key]: value }), code('invalid_input'));
  }
});

test('separate worker connections enforce global concurrency and one live job per agent', async t => {
  const { store, path } = fixture(t, { maxConcurrency: 2 });
  store.seed(createAgentCatalog(3));
  enqueue(store, 0, 0); enqueue(store, 1, 0); enqueue(store, 2, 1); enqueue(store, 3, 2);
  const results = await parallelWorkers(path, 6, 'claim');
  const claimed = results.map(result => result.job).filter(Boolean);
  assert.equal(claimed.length, 2);
  assert.equal(new Set(claimed.map(job => job.agentId)).size, 2);
  assert.equal(store.stats().running, 2);
  assert.equal(store.claim('additional-worker'), null);
  assert.throws(() => new FleetStore(path, { maxConcurrency: 4 }), code('persistent_limits_mismatch'));
  store.complete(claimed[0].id, claimed[0].leaseToken, { artifact: 'verified.txt' });
  assert.ok(store.claim('replacement-worker'));
  assert.equal(store.stats().running, 2);
});

test('daily call reservations are atomic across concurrent worker connections and persist', async t => {
  const { store, path } = fixture(t, { maxConcurrency: 4, maxCallsPerDay: 3 });
  store.seed(createAgentCatalog(4));
  for (let i = 0; i < 4; i++) enqueue(store, i);
  const results = await parallelWorkers(path, 4, 'reserve');
  assert.equal(results.filter(result => result.reserved?.reserved).length, 3);
  assert.equal(results.filter(result => result.error === 'daily_model_call_limit').length, 1);
  const reopened = new FleetStore(path);
  try {
    assert.equal(reopened.stats().modelCallsToday, 3);
    const blockedByBudget = results.find(result => result.error === 'daily_model_call_limit').job;
    assert.throws(() => reopened.reserveModelCall(blockedByBudget.id, blockedByBudget.leaseToken), code('daily_model_call_limit'));
    assert.equal(reopened.getJob(blockedByBudget.id).modelCalls, 0);
    assert.equal(reopened.stats().modelCallsToday, 3);
  } finally { reopened.close(); }
});

test('expired lease recovery fences old workers and preserves consumed model calls', async t => {
  const { store } = fixture(t);
  store.seed(createAgentCatalog(1));
  const queued = enqueue(store, 0);
  const old = store.claim('crashed-worker', { leaseMs: 30 });
  store.reserveModelCall(old.id, old.leaseToken);
  await pause(45);
  assert.deepEqual(store.recoverExpired(), { recovered: 1, requeued: 1, failed: 0 });
  const resumed = store.claim('resumed-worker');
  assert.equal(resumed.id, queued.id);
  assert.notEqual(resumed.leaseToken, old.leaseToken);
  assert.equal(resumed.attempts, 2); assert.equal(resumed.modelCalls, 1);
  for (const attempt of [
    () => store.complete(old.id, old.leaseToken, { counterfeit: true }),
    () => store.renew(old.id, old.leaseToken),
    () => store.reserveModelCall(old.id, old.leaseToken),
    () => store.fail(old.id, old.leaseToken, 'late failure'),
    () => store.block(old.id, old.leaseToken, 'late block'),
  ]) assert.throws(attempt, code('stale_lease'));
  assert.ok(store.renew(resumed.id, resumed.leaseToken).leaseExpiresAt > Date.now());
  assert.equal(store.complete(resumed.id, resumed.leaseToken, { artifact: 'recovered.txt' }).status, 'done');
});

test('a job cannot be done without an explicit JSON result and completion rejects duplicate stale tokens', t => {
  const { store } = fixture(t);
  store.seed(createAgentCatalog(1)); enqueue(store, 0);
  const job = store.claim('worker');
  for (const invalid of [undefined, null, 'done', [], 123]) assert.throws(() => store.complete(job.id, job.leaseToken, invalid), code('invalid_result'));
  assert.throws(() => store.complete(job.id, job.leaseToken, { bad: undefined }), code('invalid_input'));
  assert.throws(() => store.complete(job.id, job.leaseToken, { text: 'x'.repeat(33000) }), code('input_too_large'));
  assert.equal(store.getJob(job.id).status, 'running');
  const result = { artifact: 'result.json', verified: false, missingEvidence: ['customer payment'] };
  assert.deepEqual(store.complete(job.id, job.leaseToken, result).result, result);
  assert.equal(store.stats().done, 1);
  assert.throws(() => store.complete(job.id, job.leaseToken, { counterfeit: true }), code('stale_lease'));
  assert.equal(store.stats().sale_proven, false);
});

test('retry limits and step reservations cannot be reset by retrying a failed or blocked job', t => {
  const { store } = fixture(t);
  store.seed(createAgentCatalog(2)); enqueue(store, 0, 0, { maxSteps: 8 });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = store.claim(`worker-${attempt}`);
    assert.equal(job.attempts, attempt);
    const failed = store.fail(job.id, job.leaseToken, new Error('transient'), { retryable: true });
    assert.equal(failed.status, attempt === 3 ? 'failed' : 'queued');
  }
  const exhausted = store.listJobs()[0];
  assert.throws(() => store.retry(exhausted.id), code('retry_limit'));
  enqueue(store, 1, 1, { maxSteps: 1 });
  const limited = store.claim('single-step');
  store.reserveModelCall(limited.id, limited.leaseToken);
  assert.throws(() => store.reserveModelCall(limited.id, limited.leaseToken), code('step_limit'));
  assert.equal(store.block(limited.id, limited.leaseToken, { code: 'provider_missing', message: 'No provider configured' }).status, 'blocked');
  assert.throws(() => store.retry(limited.id), code('step_limit'));
  assert.equal(store.stats().modelCallsToday, 1);
});

test('blocked work can be retried without changing its identity or pretending it was completed', t => {
  const { store } = fixture(t);
  store.seed(createAgentCatalog(1)); enqueue(store, 0);
  const job = store.claim('no-model');
  store.block(job.id, job.leaseToken, { code: 'model_missing', message: 'No model available' });
  assert.equal(store.stats().blocked, 1);
  assert.equal(store.stats().done, 0);
  const retry = store.retry(job.id);
  assert.equal(retry.id, job.id); assert.equal(retry.attempts, 1); assert.equal(retry.status, 'queued');
  const resumed = store.claim('model-present');
  assert.equal(resumed.attempts, 2);
  store.addEvent(job.id, 'artifact_written', { path: 'local/result.txt', bytes: 20 });
  assert.throws(() => store.addEvent('unknown', 'test', {}), code('unknown_job'));
  store.complete(resumed.id, resumed.leaseToken, { artifact: 'local/result.txt' });
  assert.equal(store.stats().revenue_usdc, null);
});

test('zero daily budget stays closed and persists on reopening', t => {
  const { store, path } = fixture(t, { maxCallsPerDay: 0 });
  store.seed(createAgentCatalog(1)); enqueue(store, 0);
  const job = store.claim('worker');
  assert.throws(() => store.reserveModelCall(job.id, job.leaseToken), code('daily_model_call_limit'));
  const reopened = new FleetStore(path);
  try {
    assert.equal(reopened.limits.maxCallsPerDay, 0);
    assert.throws(() => reopened.reserveModelCall(job.id, job.leaseToken), code('daily_model_call_limit'));
  } finally { reopened.close(); }
  assert.throws(() => new FleetStore(path, { maxConcurrency: 5 }), code('invalid_input'));
});
