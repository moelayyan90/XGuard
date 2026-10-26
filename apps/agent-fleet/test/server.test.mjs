import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { setText } from '../public/app.mjs';

function fakeStore() {
  const agents = [
    { id: 'research-0001', name: 'باحث 1', role: 'researcher', status: 'registered' },
    { id: 'writer-0002', name: 'كاتب 2', role: 'writer', status: 'registered' },
    { id: 'research-0003', name: '<img src=x onerror=alert(1)>', role: 'researcher', status: 'registered' },
  ];
  const jobs = []; const keys = new Map();
  return {
    jobs,
    stats: async () => ({ registeredAgents: agents.length, runningAgents: 0, completedJobs: jobs.filter(job => job.status === 'completed').length, queuedJobs: jobs.filter(job => job.status === 'queued').length }),
    listAgents: async ({ limit, offset, role }) => { const selected = agents.filter(agent => !role || agent.role === role); return { items: selected.slice(offset, offset + limit), total: selected.length }; },
    listJobs: async ({ limit, offset }) => ({ items: [...jobs].reverse().slice(offset, offset + limit), total: jobs.length }),
    getJob: async id => jobs.find(job => job.id === id) ?? null,
    createJob: async input => {
      if (keys.has(input.idempotencyKey)) return keys.get(input.idempotencyKey);
      const job = { id: `job-${jobs.length + 1}`, ...input, status: 'queued' }; jobs.push(job); keys.set(input.idempotencyKey, job); return job;
    },
    retry: async id => { const job = jobs.find(item => item.id === id); job.status = 'queued'; return job; },
    agent: async id => agents.find(agent => agent.id === id) ?? null,
  };
}

async function fixture(t, overrides = {}) {
  const store = fakeStore(); const calls = { run: [], pause: 0 };
  const app = await startServer({
    store,
    runBatch: async args => { calls.run.push(args); return { completed: 0 }; },
    pause: async () => { calls.pause++; },
    ...overrides,
  });
  t.after(() => app.close());
  const call = async (path, { method = 'GET', data, headers = {} } = {}) => {
    const response = await fetch(app.url + path, {
      method,
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(data === undefined ? {} : { body: typeof data === 'string' ? data : JSON.stringify(data) }),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { response, status: response.status, body, text };
  };
  return { ...app, store, calls, call };
}

function raw(url, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test timed out')));
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function until(read, predicate) {
  for (let i = 0; i < 50; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('State did not converge');
}

const task = (extra = {}) => ({ agentId: 'research-0001', instruction: 'تحقق من البيانات العامة وأعد نتيجة قابلة للمراجعة.', idempotencyKey: 'test-order-0001', ...extra });

test('binds only to IPv4 loopback; rejects public addresses and invalid ports', async () => {
  const store = fakeStore(); const callbacks = { store, runBatch: async () => ({}), pause: async () => {} };
  for (const host of ['0.0.0.0', '::', '192.168.1.4', '127.0.0.2', 'localhost.evil.test']) {
    await assert.rejects(startServer({ ...callbacks, host }), /bind/);
  }
  for (const port of [-1, 65536, '8790', 1.5, NaN]) await assert.rejects(startServer({ ...callbacks, port }), /port/);
  const app = await startServer({ ...callbacks, host: 'localhost' });
  try { assert.equal(app.server.address().address, '127.0.0.1'); } finally { await app.close(); }
});

test('requires an exact permitted Host and the actual bound port', async t => {
  const app = await fixture(t); const port = app.server.address().port;
  for (const host of ['evil.test', '127.0.0.1', `127.0.0.1:${port + 1}`, `localhost.evil.test:${port}`]) {
    assert.equal((await raw(app.url + '/api/status', { headers: { host } })).status, 403);
  }
  assert.equal((await raw(app.url + '/api/status', { headers: { host: `localhost:${port}` } })).status, 200);
});

test('rejects external and null origins before any state mutation', async t => {
  const app = await fixture(t); const port = app.server.address().port;
  for (const origin of ['https://evil.test', 'null', `http://localhost:${port + 1}`, `https://localhost:${port}`]) {
    const response = await app.call('/api/jobs', { method: 'POST', data: task(), headers: { origin } });
    assert.equal(response.status, 403);
    assert.equal(response.response.headers.has('access-control-allow-origin'), false);
  }
  assert.equal(app.store.jobs.length, 0);
  assert.equal((await app.call('/api/jobs', { method: 'POST', data: task(), headers: { origin: `http://localhost:${port}` } })).status, 201);
  assert.equal((await app.call('/api/jobs', { method: 'POST', data: task({ idempotencyKey: 'cli-task-0002' }) })).status, 201);
});

test('GET, HEAD, and preflight requests cannot start, pause, retry, or create work', async t => {
  const app = await fixture(t);
  for (const path of ['/api/run', '/api/pause', '/api/jobs/not-a-job/retry']) assert.equal((await app.call(path)).status, 405);
  assert.equal((await app.call('/api/run', { method: 'HEAD' })).status, 405);
  assert.equal((await app.call('/api/run', { method: 'OPTIONS' })).status, 405);
  assert.deepEqual(app.calls, { run: [], pause: 0 }); assert.equal(app.store.jobs.length, 0);
});

test('requires JSON objects and rejects undeclared fields and malformed input', async t => {
  const app = await fixture(t);
  assert.equal((await app.call('/api/jobs', { method: 'POST', data: task(), headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const data of ['{broken', 'null', '[]', JSON.stringify(task({ unsafe: true }))]) {
    assert.equal((await app.call('/api/jobs', { method: 'POST', data })).status, 400);
  }
  assert.equal((await app.call('/api/jobs', { method: 'POST', data: task(), headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 201);
});

test('enforces the 32 KiB body cap for declared lengths and streamed chunks', async t => {
  const app = await fixture(t);
  const content = JSON.stringify(task({ instruction: 'x'.repeat(40_000) }));
  assert.equal((await raw(app.url + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(content) }, chunks: [content] })).status, 413);
  assert.equal((await raw(app.url + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, chunks: [content.slice(0, 16_000), content.slice(16_000)] })).status, 413);
  assert.equal(app.store.jobs.length, 0);
});

test('bounds job creation and batch resources to the actual runner limits', async t => {
  const app = await fixture(t);
  for (const extra of [
    { instruction: '' }, { instruction: 'x'.repeat(12_001) }, { agentId: '../unsafe' },
    { idempotencyKey: 'short' }, { maxSteps: 9 }, { maxSteps: 0 }, { maxOutputTokens: 1025 }, { maxOutputTokens: 31 },
  ]) assert.equal((await app.call('/api/jobs', { method: 'POST', data: task(extra) })).status, 400);
  for (const data of [{ limit: 0 }, { limit: 2001 }, { concurrency: 5 }, { concurrency: 1.5 }, { spend: 1 }]) {
    assert.equal((await app.call('/api/run', { method: 'POST', data })).status, 400);
  }
  assert.equal(app.store.jobs.length, 0); assert.equal(app.calls.run.length, 0);
});

test('creates a bounded job without starting a model and preserves store idempotency', async t => {
  const app = await fixture(t);
  const first = await app.call('/api/jobs', { method: 'POST', data: task() });
  const second = await app.call('/api/jobs', { method: 'POST', data: task() });
  assert.equal(first.status, 201); assert.equal(first.body.job.maxSteps, 4); assert.equal(first.body.job.maxOutputTokens, 256);
  assert.equal(second.body.job.id, first.body.job.id); assert.equal(app.store.jobs.length, 1); assert.equal(app.calls.run.length, 0);
  assert.equal((await app.call('/api/jobs', { method: 'POST', data: task({ agentId: 'missing-agent' }) })).status, 404);
});

test('filters and paginates agents; lists jobs and resolves individual jobs', async t => {
  const app = await fixture(t);
  const agents = await app.call('/api/agents?role=researcher&limit=1&offset=1');
  assert.equal(agents.status, 200); assert.equal(agents.body.total, 2); assert.equal(agents.body.items[0].id, 'research-0003');
  assert.equal(agents.body.limit, 1); assert.equal(agents.body.offset, 1);
  const created = (await app.call('/api/jobs', { method: 'POST', data: task() })).body.job;
  assert.equal((await app.call('/api/jobs')).body.total, 1);
  assert.equal((await app.call(`/api/jobs/${created.id}`)).body.job.id, created.id);
  assert.equal((await app.call('/api/jobs/not-found')).status, 404);
});

test('rejects duplicate, unknown, unsafe, and unbounded query arguments', async t => {
  const app = await fixture(t);
  for (const path of [
    '/api/agents?limit=101', '/api/agents?limit=1&limit=2', '/api/agents?offset=-1',
    '/api/agents?role=%3Cscript%3E', '/api/agents?secret=1', '/api/jobs?limit=0', '/api/status?debug=1',
  ]) assert.equal((await app.call(path)).status, 400, path);
});

test('runBatch stays in the background and a pause remains distinguishable from in-flight work', async t => {
  let release; let pauseCalls = 0; const calls = [];
  const deferred = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { runBatch: async args => { calls.push(args); return deferred; }, pause: async () => { pauseCalls++; } });
  t.after(() => release({ completed: 1 }));
  const start = await app.call('/api/run', { method: 'POST', data: { limit: 1, concurrency: 2 } });
  assert.equal(start.status, 202); assert.equal(start.body.runner.running, true);
  const status = await app.call('/api/status'); assert.equal(status.status, 200); assert.equal(status.body.runner.running, true);
  await until(async () => calls, calls => calls.length === 1); assert.deepEqual(calls[0], { limit: 1, concurrency: 2 });
  assert.equal((await app.call('/api/run', { method: 'POST', data: {} })).status, 409);
  const paused = await app.call('/api/pause', { method: 'POST', data: {} });
  assert.equal(paused.body.paused, true); assert.equal(paused.body.running, true); assert.equal(pauseCalls, 1);
  release({ completed: 1 });
  const finished = await until(async () => (await app.call('/api/status')).body.runner, runner => !runner.running);
  assert.equal(finished.paused, true); assert.deepEqual(finished.lastResult, { completed: 1 }); assert.ok(finished.finishedAt);
});

test('background errors appear in status without crashing the HTTP server or leaking common credentials', async t => {
  const app = await fixture(t, { runBatch: async () => { throw new Error('Provider failed Bearer unsafe-provider-token sk-secretvalue123456'); } });
  assert.equal((await app.call('/api/run', { method: 'POST', data: {} })).status, 202);
  const runner = await until(async () => (await app.call('/api/status')).body.runner, runner => !runner.running && runner.lastError);
  assert.match(runner.lastError, /Provider failed/); assert.doesNotMatch(runner.lastError, /unsafe-provider-token|sk-secretvalue123456/);
  assert.equal((await app.call('/api/agents')).status, 200);
});

test('retry is an explicit bounded POST and unknown jobs remain absent', async t => {
  const app = await fixture(t);
  const job = (await app.call('/api/jobs', { method: 'POST', data: task() })).body.job;
  app.store.jobs[0].status = 'failed';
  assert.equal((await app.call(`/api/jobs/${job.id}/retry`, { method: 'POST', data: {} })).body.job.status, 'queued');
  assert.equal((await app.call('/api/jobs/unknown/retry', { method: 'POST', data: {} })).status, 404);
  assert.equal((await app.call(`/api/jobs/${job.id}/retry`, { method: 'POST', data: { payment: true } })).status, 400);
});

test('serves only fixed assets with strict browser headers, without reading arbitrary paths', async t => {
  const app = await fixture(t);
  const home = await app.call('/');
  assert.equal(home.status, 200); assert.match(home.text, /lang="ar" dir="rtl"/);
  assert.match(home.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.doesNotMatch(home.response.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
  assert.equal(home.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.response.headers.get('cache-control'), 'no-store');
  for (const path of ['/server.mjs', '/.env', '/store.sqlite', '/..%2f..%2fetc/passwd', '/artifacts/../../.env']) assert.equal((await app.call(path)).status, 404, path);
  assert.equal((await app.call('/api/jobs/%2Fetc%2Fpasswd')).status, 400);
  assert.equal((await app.call('/style.css')).status, 200); assert.equal((await app.call('/app.mjs')).status, 200);
});

test('untrusted agent names and instructions stay JSON/text rather than executable HTML', async t => {
  const app = await fixture(t);
  const payload = '<script>globalThis.stolen=true</script><img src=x onerror=alert(1)>';
  const created = await app.call('/api/jobs', { method: 'POST', data: task({ instruction: payload }) });
  assert.equal(created.status, 201); assert.equal(created.body.job.instruction, payload);
  assert.match(created.response.headers.get('content-type'), /^application\/json/);
  const agents = await app.call('/api/agents'); assert.match(agents.body.items[2].name, /<img/);
  const node = { textContent: '', set innerHTML(_) { throw new Error('HTML insertion is prohibited'); } };
  setText(node, payload); assert.equal(node.textContent, payload);
  const code = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /\binnerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(/);
  assert.equal((await app.call('/')).text.includes(payload), false);
});

test('status never labels model work or task counts as proven revenue', async t => {
  const app = await fixture(t);
  await app.call('/api/jobs', { method: 'POST', data: task() }); app.store.jobs[0].status = 'completed';
  const status = (await app.call('/api/status')).body;
  assert.equal(status.stats.completedJobs, 1); assert.deepEqual(status.revenue, { status: 'unproven', label: 'غير مثبت' });
});
