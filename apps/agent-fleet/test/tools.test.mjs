import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetTools, ToolError } from '../tools.mjs';

const hash = content => createHash('sha256').update(content).digest('hex');
const isCode = expected => error => error instanceof ToolError && error.code === expected;
const context = (jobId = 'job-one', allowedTools = ['write_file', 'read_file', 'web_get']) => ({ jobId, agentId: 'agent-000001', allowedTools });

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'xguard-fleet-tools-'));
  const root = join(directory, 'artifacts');
  const calls = [], lookups = [];
  const fetchImpl = options.fetchImpl ?? (async (url, init) => { calls.push({ url, init }); return new Response('verified public fixture', { status: 200 }); });
  const lookupImpl = options.lookupImpl ?? (async (hostname, init) => { lookups.push({ hostname, init }); return [{ address: '93.184.216.34', family: 4 }]; });
  const tools = new FleetTools({ root, allowedDomains: ['docs.example.com'], fetchImpl, lookupImpl, ...options });
  t.after(() => { tools.close(); rmSync(directory, { recursive: true, force: true }); });
  return { tools, root, directory, calls, lookups, fetchImpl, lookupImpl };
}

test('real artifact writes are private, digest-verified, reusable and confined to one job', async t => {
  const { tools, root } = fixture(t);
  const content = 'تقرير موثق\nNo sale or revenue has been established.\n';
  const action = { action: 'write_file', path: 'reports/evidence.txt', content };
  const first = await tools.execute(action, context());
  assert.equal(first.sha256, hash(content)); assert.equal(first.bytes, Buffer.byteLength(content));
  const physical = join(root, 'job-one', 'reports', 'evidence.txt');
  assert.equal(readFileSync(physical, 'utf8'), content);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, 'tool-usage.sqlite')).mode & 0o777, 0o600);
  assert.equal(statSync(physical).mode & 0o777, 0o600);
  assert.equal((await tools.execute(action, context())).reused, true);
  assert.deepEqual(await tools.execute({ action: 'read_file', path: action.path }, context()), { path: action.path, content, sha256: hash(content) });
  await assert.rejects(() => tools.execute({ action: 'read_file', path: action.path }, context('job-two')), error => error.code === 'ENOENT');
  await assert.rejects(() => tools.execute({ action: 'read_file', path: '../job-one/reports/evidence.txt' }, context('job-two')), isCode('unsafe_path'));
});

test('traversal, absolute paths, hidden paths, Windows forms and invalid job ids are rejected', async t => {
  const { tools, directory } = fixture(t);
  for (const path of ['../escape.txt', 'a/../../escape.txt', '/tmp/escape.txt', '.secret', 'a/.secret', 'a//b', 'C:\\escape.txt', 'a\\b', 'a:b', 'a\0b', 'a/b/c/d/e/f']) {
    await assert.rejects(() => tools.execute({ action: 'write_file', path, content: 'blocked' }, context()), isCode('unsafe_path'), path);
  }
  for (const jobId of ['../job-other', '', 'job-../outside', '/job-one']) {
    await assert.rejects(() => tools.execute({ action: 'write_file', path: 'file.txt', content: 'blocked' }, context(jobId)), isCode('unsafe_job_id'));
  }
  assert.equal(existsSync(join(directory, 'escape.txt')), false);
});

test('symbolic link workspaces, parent directories and target files cannot escape the job', async t => {
  const { tools, root, directory } = fixture(t);
  const outside = join(directory, 'outside'); mkdirSync(outside);
  const secret = join(outside, 'secret.txt'); writeFileSync(secret, 'outside private fixture');
  const job = join(root, 'job-one'); mkdirSync(job, { recursive: true });
  symlinkSync(secret, join(job, 'linked-file.txt'));
  symlinkSync(outside, join(job, 'linked-directory'));
  for (const path of ['linked-file.txt', 'linked-directory/secret.txt']) {
    await assert.rejects(() => tools.execute({ action: 'read_file', path }, context()), isCode('unsafe_path'));
    await assert.rejects(() => tools.execute({ action: 'write_file', path, content: 'replace' }, context()), isCode('unsafe_path'));
  }
  assert.equal(readFileSync(secret, 'utf8'), 'outside private fixture');
  const linkedRoot = join(directory, 'linked-root'); symlinkSync(root, linkedRoot);
  assert.throws(() => new FleetTools({ root: linkedRoot, fetchImpl: async () => { throw new Error('Unexpected network'); }, lookupImpl: async () => [] }), isCode('unsafe_path'));
});

test('existing hard links cannot be used to replace another file', async t => {
  const { tools, root, directory } = fixture(t);
  const victim = join(directory, 'victim.txt'); writeFileSync(victim, 'keep this exact data');
  const job = join(root, 'job-one'); mkdirSync(job, { recursive: true });
  const target = join(job, 'hard-linked.txt'); linkSync(victim, target);
  await assert.rejects(() => tools.execute({ action: 'write_file', path: 'hard-linked.txt', content: 'replacement data' }, context()), isCode('artifact_conflict'));
  assert.equal(readFileSync(victim, 'utf8'), 'keep this exact data');
  assert.equal(readFileSync(target, 'utf8'), 'keep this exact data');
});

test('competing asynchronous writes publish one complete artifact and never overwrite the winner', async t => {
  const { tools, root } = fixture(t);
  const contents = Array.from({ length: 8 }, (_, i) => `writer ${i}\n${String(i).repeat(60000)}`);
  const results = await Promise.allSettled(contents.map(content => tools.execute({ action: 'write_file', path: 'race.txt', content }, context())));
  const success = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ index, value: result.value }] : []);
  assert.equal(success.length, 1);
  for (const result of results.filter(result => result.status === 'rejected')) assert.ok(isCode('artifact_conflict')(result.reason));
  const actual = readFileSync(join(root, 'job-one', 'race.txt'), 'utf8');
  assert.equal(actual, contents[success[0].index]);
  assert.equal(success[0].value.sha256, hash(actual));
  assert.deepEqual(readdirSync(join(root, 'job-one')), ['race.txt']);
});

test('tool permissions and artifact size limits are checked by the implementation', async t => {
  const { tools, calls, lookups } = fixture(t);
  await assert.rejects(() => tools.execute({ action: 'web_get', url: 'https://docs.example.com/' }, context('job-one', ['read_file', 'write_file'])), isCode('tool_not_allowed'));
  await assert.rejects(() => tools.execute({ action: 'shell', command: 'not executed' }, context()), isCode('tool_not_allowed'));
  await assert.rejects(() => tools.execute({ action: 'write_file', path: 'too-big.txt', content: 'x'.repeat(65537) }, context()), isCode('artifact_too_large'));
  await assert.rejects(() => tools.execute({ action: 'read_file', path: 'file.txt' }, { ...context(), agentId: 'not-an-agent' }), isCode('invalid_agent'));
  assert.equal(calls.length, 0); assert.equal(lookups.length, 0);
});

test('web reads require exact allowlisted public HTTPS URLs without credentials or secret parameters', async t => {
  const { tools, calls, lookups } = fixture(t);
  for (const url of [
    'http://docs.example.com/', 'https://sub.docs.example.com/', 'https://docs.example.com.evil.test/',
    'https://user:password@docs.example.com/', 'https://docs.example.com:8443/', 'https://docs.example.com/#private',
    'https://127.0.0.1/', 'https://docs.example.com/?api_key=fixture', 'https://docs.example.com/?access_token=fixture',
    'https://docs.example.com/?Authorization=fixture',
  ]) await assert.rejects(() => tools.execute({ action: 'web_get', url }, context()), isCode('web_domain_not_allowed'), url);
  assert.equal(calls.length, 0); assert.equal(lookups.length, 0);
  assert.throws(() => new FleetTools({ root: join(tools.root, 'invalid-domain'), allowedDomains: ['*.example.com'], fetchImpl: async () => {}, lookupImpl: async () => [] }), isCode('invalid_domains'));
  assert.throws(() => new FleetTools({ root: join(tools.root, 'invalid-budget'), maxWebCallsPerDay: 101, fetchImpl: async () => {}, lookupImpl: async () => [] }), isCode('invalid_web_budget'));
});

test('private, reserved and mixed public/private DNS answers are rejected before HTTP', async t => {
  const { tools, calls } = fixture(t);
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', 'fd00::1']) {
    tools.lookupImpl = async () => [{ address, family: address.includes(':') ? 6 : 4 }];
    await assert.rejects(() => tools.execute({ action: 'web_get', url: `https://docs.example.com/${encodeURIComponent(address)}` }, context(`job-case-${address.replace(/[^a-z0-9]/gi, '-')}`)), isCode('private_network_blocked'), address);
  }
  tools.lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(() => tools.execute({ action: 'web_get', url: 'https://docs.example.com/mixed' }, context('job-mixed')), isCode('private_network_blocked'));
  assert.equal(calls.length, 0);
});

test('redirects are not followed, including redirects to metadata services', async t => {
  let calls = 0;
  const { tools, lookups } = fixture(t, { fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  } });
  await assert.rejects(() => tools.execute({ action: 'web_get', url: 'https://docs.example.com/redirect' }, context()), isCode('redirect_blocked'));
  assert.equal(calls, 1);
  assert.deepEqual(lookups[0], { hostname: 'docs.example.com', init: { family: 4, all: true } });
});

test('streamed web responses have a 256 KiB ceiling and returned data remains untrusted', async t => {
  const { tools } = fixture(t, { fetchImpl: async url => {
    const length = url.endsWith('/at-limit') ? 262144 : 262145;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(131072).fill(65));
      controller.enqueue(new Uint8Array(length - 131072).fill(65)); controller.close();
    } }), { status: 200 });
  } });
  const result = await tools.execute({ action: 'web_get', url: 'https://docs.example.com/at-limit' }, context());
  assert.equal(result.status, 200); assert.equal(result.untrusted, true);
  assert.equal(result.text.length, 32768); assert.equal(result.sha256, hash('A'.repeat(262144)));
  await assert.rejects(() => tools.execute({ action: 'web_get', url: 'https://docs.example.com/over-limit' }, context()), isCode('web_response_too_large'));
});

test('per-job three-read limit persists even when cached and after reopening the tools store', async t => {
  const f = fixture(t);
  const action = { action: 'web_get', url: 'https://docs.example.com/same' };
  await f.tools.execute(action, context());
  assert.equal((await f.tools.execute(action, context())).cached, true);
  assert.equal((await f.tools.execute(action, context())).cached, true);
  await assert.rejects(() => f.tools.execute(action, context()), isCode('job_web_limit'));
  assert.equal(f.calls.length, 1);
  const reopened = new FleetTools({ root: f.root, allowedDomains: ['docs.example.com'], fetchImpl: f.fetchImpl, lookupImpl: f.lookupImpl });
  try { await assert.rejects(() => reopened.execute(action, context()), isCode('job_web_limit')); }
  finally { reopened.close(); }
});

test('daily physical-read budget persists across independent tools connections', async t => {
  const f = fixture(t, { maxWebCallsPerDay: 2 });
  await f.tools.execute({ action: 'web_get', url: 'https://docs.example.com/first' }, context('job-first'));
  const reopened = new FleetTools({ root: f.root, maxWebCallsPerDay: 2, allowedDomains: ['docs.example.com'], fetchImpl: f.fetchImpl, lookupImpl: f.lookupImpl });
  try {
    await reopened.execute({ action: 'web_get', url: 'https://docs.example.com/second' }, context('job-second'));
    await assert.rejects(() => f.tools.execute({ action: 'web_get', url: 'https://docs.example.com/third' }, context('job-third')), isCode('daily_web_limit'));
    assert.equal(f.calls.length, 2);
  } finally { reopened.close(); }
});

test('singleflight shares one lookup/fetch and one daily reservation across concurrent jobs', async t => {
  let resolveResponse, fetchCalls = 0;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const f = fixture(t, { maxWebCallsPerDay: 1, fetchImpl: async () => { fetchCalls++; return response; } });
  const reads = Array.from({ length: 8 }, (_, i) => f.tools.execute({ action: 'web_get', url: 'https://docs.example.com/one' }, context(`job-reader-${i}`)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCalls, 1); assert.equal(f.lookups.length, 1);
  resolveResponse(new Response('shared immutable fixture'));
  const results = await Promise.all(reads);
  assert.ok(results.every(result => result.text === 'shared immutable fixture' && result.sha256 === hash('shared immutable fixture')));
  await assert.rejects(() => f.tools.execute({ action: 'web_get', url: 'https://docs.example.com/two' }, context('job-next')), isCode('daily_web_limit'));
});

test('pre-cancelled execution performs no file or network work', async t => {
  const { tools, calls, root } = fixture(t);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => tools.execute({ action: 'write_file', path: 'cancelled.txt', content: 'never written' }, { ...context(), signal: abort.signal }), isCode('cancelled'));
  await assert.rejects(() => tools.execute({ action: 'web_get', url: 'https://docs.example.com/' }, { ...context(), signal: abort.signal }), isCode('cancelled'));
  assert.equal(existsSync(join(root, 'job-one')), false); assert.equal(calls.length, 0);
});
