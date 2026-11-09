import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createIdentity, signCommand } from '../../../sdk/financial-authority/client.mjs';
import { b64, bytes, digest, unsigned, verify } from '../src/financial-authority/crypto.js';
import { verifyReceiptOffline } from '../../../sdk/financial-authority/verify-receipt.mjs';
import { verifyAuthorityReceipt } from '../src/financial-authority/http.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = fileURLToPath(new URL('../src/authority.js', import.meta.url));
const http = fileURLToPath(new URL('../src/financial-authority/http.js', import.meta.url));
const mcpPath = fileURLToPath(new URL('../src/live/mcp.ts', import.meta.url));
const a2aPath = fileURLToPath(new URL('../src/live/a2a.ts', import.meta.url));
const proof = fileURLToPath(new URL('../src/product-entry.js', import.meta.url));
const executor = await createIdentity(), owner = await createIdentity(), parent = await createIdentity(), child = await createIdentity(), stranger = await createIdentity();
const persist = await mkdtemp(join(tmpdir(), 'xguard-authority-'));
const bundle = await build({ stdin: { resolveDir: dirname(source), contents: `
  import { AgentAuthority } from ${JSON.stringify(source)};
  export class FaultAuthority extends AgentAuthority {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/__fixture/fail') {
        const kind = await request.text();
        const when = kind === 'completion' ? "NEW.key LIKE 'op:%' AND json_extract(NEW.value,'$.state') IN ('CONFIRMED','FAILED','UNKNOWN')" : "NEW.key = 'organization'";
        this.state.storage.sql.exec("CREATE TRIGGER fixture_fault BEFORE UPDATE ON afa_records WHEN " + when + " BEGIN SELECT RAISE(ABORT,'fixture_storage_outage'); END");
        return new Response('ok');
      }
      if (path === '/__fixture/restore') { this.state.storage.sql.exec('DROP TRIGGER IF EXISTS fixture_fault'); return new Response('ok'); }
      return super.fetch(request);
    }
  }
  export { ProofAuthority } from ${JSON.stringify(proof)};
  import { financialAuthorityFetch } from ${JSON.stringify(http)};
  import { liveMcpFetch } from ${JSON.stringify(mcpPath)};
  import { liveA2aFetch } from ${JSON.stringify(a2aPath)};
  export default { async fetch(request, env) { const path = new URL(request.url).pathname; if (path === '/mcp') return liveMcpFetch(request, env, async () => new Response('no fact',{status:404})); if (path === '/a2a') return liveA2aFetch(request, env, async () => new Response('no fact',{status:404})); if (new URL(request.url).hostname === 'fixture.test') return env.AUTHORITY.get(env.AUTHORITY.idFromName('afa-v1:sandbox:organization_fixture')).fetch(request); return await financialAuthorityFetch(request,env) || new Response('not found',{status:404}); } };
` }, format: 'esm', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'workerd-node-builtins', setup(b) { b.onResolve({ filter: /^(?:node:)?url$/ }, () => ({ path: 'node:url', external: true })); } }] });
let calls = 0, checks = 0, mode = 'confirmed', mf, lastIntent;
async function adapter(request) {
  const body = await request.json(), op = body.operation, statusOnly = new URL(request.url).pathname === '/status';
  if (statusOnly) checks++; else { calls++; lastIntent = op; }
  if (mode === 'timeout') throw Error('response_lost');
  if (mode === 'crash') return new Response('unavailable', { status: 503 });
  const payload = { protocol: 'xguard-afa-settlement/1', mode: op.mode, organization_id: op.organization_id, operation_id: op.operation_id, intent_digest: op.intent_digest,
    payee: mode === 'wrong_payee' ? 'attacker' : op.payee, currency: op.currency, asset: op.asset, network: op.network, principal_atomic: op.principal_atomic, provider_fee_atomic: mode === 'fee_overrun' ? '999' : '0',
    observed_at: Date.now(), status: mode === 'failed' ? 'failed_no_effect' : mode === 'unknown' ? 'unknown' : 'confirmed', transaction: 'fixture_not_a_real_payment_' + op.operation_id };
  const signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mode === 'forged' ? stranger.privateKey : executor.privateKey, bytes(payload)));
  return Response.json({ payload, signature });
}
function create(withAdapter = true) {
  return new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, resourcePersistencePath: persist, workers: [{ name: 'authority-test', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
    bindings: { LIVE_ADMIN_KEY: 'only-local-fixture-owner-access-key', AFA_EXECUTOR_ADAPTER: 'fixture', AFA_EXECUTOR_PUBLIC_JWK: JSON.stringify(executor.publicKey) },
    durableObjects: { AUTHORITY: { className: 'FaultAuthority', useSQLite: true }, PROOF_AUTHORITY: { className: 'ProofAuthority', useSQLite: true } },
    serviceBindings: withAdapter ? { AFA_EXECUTOR: adapter } : {},
  }] }));
}
const orgId = 'organization_fixture', organizationTokens = new Map();
const policy = (value = '100') => ({ currency: 'USD', asset: 'fixture_usd', network: 'fixture:local', per_operation: value, per_period: value, lifetime: value, period_seconds: 86400, payees: ['merchant_fixture'] });
const send = async (envelope, enrollment = false) => {
  const response = await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/' + envelope.action, { method: 'POST', headers: { 'content-type': 'application/json', ...(enrollment ? { authorization: 'Bearer only-local-fixture-owner-access-key' } : { 'x-xguard-organization-token': organizationTokens.get(envelope.org_id) || '' }) }, body: JSON.stringify(envelope) });
  const body = await response.json();
  if (body.result?.organization_token) organizationTokens.set(envelope.org_id, body.result.organization_token);
  return { status: response.status, ...body };
};
const command = async (who, action, payload, options = {}) => send(await signCommand(who, options.org || orgId, action, payload, options), action === 'enroll');
let tests = [];
async function test(name, fn) { await fn(); tests.push(name); console.log('PASS ' + name); }
const op = (name, value = '10', grant = 'grant_child_001') => ({ operation_id: name, grant_id: grant, currency: 'USD', asset: 'fixture_usd', network: 'fixture:local', payee: 'merchant_fixture', principal_atomic: value,
  provider_fee_cap_atomic: '0', max_service_fee_atomic: '50000', adapter: 'fixture', task_digest: 'A'.repeat(43), expires_at: Date.now() + 120000 });
const grant = (name, key, p = null, value = '100', depth = 3) => ({ grant_id: name, parent: p, agent_key: key, policy: policy(value), not_before: Date.now() - 10000, expires_at: Date.now() + 3600000, depth_remaining: depth });
let sample, key, resourceSamples = [];
try {
  mf = create(); await mf.ready;
  await test('discovery and invalid paths cause no financial execution', async () => {
    assert.equal((await mf.dispatchFetch('https://api.xguardgate.com/v1/authority')).status, 200);
    assert.equal((await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/nope')).status, 404);
    assert.equal(calls, 0);
  });
  await test('explicit operator onboarding and owner proof are required', async () => {
    const e = await signCommand(owner, orgId, 'enroll', { owner_key: owner.publicKey, policies: [policy()], accept_price_atomic: '50000' });
    assert.equal((await send(e)).status, 403); assert.equal((await send(e, true)).status, 200);
  });
  await test('real parent and child signatures create an attenuating chain', async () => {
    const p = grant('grant_parent_001', parent.publicKey); assert.equal((await command(owner, 'grant', p)).status, 200);
    const c = grant('grant_child_001', child.publicKey, p.grant_id, '100', 2); c.expires_at = p.expires_at; c.not_before = p.not_before;
    assert.equal((await command(parent, 'grant', c)).status, 200);
  });
  await test('forged identity and signed-body tampering are rejected', async () => {
    const e = await signCommand(child, orgId, 'authorize', op('forged_operation'));
    e.payload.principal_atomic = '1'; assert.equal((await send(e)).status, 401);
    e.signer = stranger.id; assert.equal((await send(e)).status, 401);
  });
  await test('cross-tenant signed envelopes cannot access another ledger', async () => {
    assert.equal((await command(stranger, 'enroll', { owner_key: stranger.publicKey, policies: [policy()], accept_price_atomic: '50000' }, { org: 'different_organization' })).status, 200);
    assert.equal((await command(child, 'authorize', op('tenant_operation'), { org: 'different_organization' })).status, 401);
  });
  await test('subagent cannot widen payees, budget, period or delegation depth', async () => {
    for (const field of ['payees', 'per_period', 'period_seconds', 'depth_remaining']) {
      const g = grant('evil_grant_' + field, stranger.publicKey, 'grant_child_001', '100', 1);
      if (field === 'payees') g.policy.payees = ['attacker'];
      else if (field === 'per_period') { g.policy.per_period = '101'; g.policy.lifetime = '101'; }
      else if (field === 'period_seconds') g.policy.period_seconds = 3600;
      else g.depth_remaining = 2;
      assert.equal((await command(child, 'grant', g)).status, 403, field);
    }
  });
  let same;
  await test('idempotent retries reserve and dispatch once', async () => {
    same = await signCommand(child, orgId, 'authorize', op('same_operation_001'));
    const first = await send(same), replay = await send(same); assert.equal(first.status, 200); assert.equal(replay.result.replay, true);
    const changed = await command(child, 'authorize', { ...same.payload, principal_atomic: '11' }); assert.equal(changed.status, 409);
    const ex = await signCommand(child, orgId, 'execute', { operation_id: same.payload.operation_id });
    const count = calls;
    const results = await Promise.all(Array.from({ length: 12 }, () => send(ex)));
    assert.equal(calls - count, 1); assert.ok(results.every(r => r.status === 200));
    sample = await command(child, 'status', { operation_id: same.payload.operation_id }); assert.equal(sample.result.state, 'CONFIRMED');
    resourceSamples.push(first.result.measured_resources);
  });
  await test('nonce reuse with another operation is rejected', async () => {
    assert.equal((await command(child, 'authorize', op('nonce_operation'), { nonce: same.nonce })).status, 409);
  });
  await test('signed receipts verify independently and reject mutation/wrong key', async () => {
    key = await (await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/proof-key')).json();
    assert.equal((await verifyAuthorityReceipt(sample.receipt.jws, key.jwk)).valid, true);
    assert.equal(verifyReceiptOffline(sample.receipt.jws, key.jwk).valid, true);
    assert.equal((await verifyAuthorityReceipt(sample.receipt.jws, stranger.publicKey)).valid, false);
    const parts = sample.receipt.jws.split('.'); parts[1] = b64(bytes({ state: 'CONFIRMED' }));
    assert.equal((await verifyAuthorityReceipt(parts.join('.'), key.jwk)).valid, false);
    assert.equal(sample.result.service_fee.collected_usdc_atomic, '0');
    assert.equal(sample.result.service_fee.assessed_usdc_atomic, '0');
  });
  await test('MCP transports the same signed command and verified receipt', async () => {
    const envelope = await signCommand(child, orgId, 'status', { operation_id: 'same_operation_001' });
    const response = await mf.dispatchFetch('https://api.xguardgate.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'xguard.authority.command' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'xguard.authority.command', arguments: { envelope, organization_token: organizationTokens.get(orgId) }, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } }) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.result.structuredContent.result.state, 'CONFIRMED'); assert.equal(verifyReceiptOffline(data.result.structuredContent.receipt.jws, key.jwk).valid, true);
  });
  await test('A2A transports the same signed command without authority widening', async () => {
    const envelope = await signCommand(child, orgId, 'status', { operation_id: 'same_operation_001' });
    const response = await mf.dispatchFetch('https://api.xguardgate.com/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ data: { action: 'xguard.authority', envelope, organization_token: organizationTokens.get(orgId) } }] } } }) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.result.message.parts[0].data.result.state, 'CONFIRMED');
  });
  await test('concurrent siblings share all ancestor budgets', async () => {
    const requests = await Promise.all(Array.from({ length: 15 }, (_, i) => signCommand(child, orgId, 'authorize', op('race_operation_' + i))));
    const results = await Promise.all(requests.map(e => send(e)));
    assert.equal(results.filter(r => r.status === 200).length, 9, '10 spent + 9 * 10 held reaches 100 exactly');
    assert.equal(results.filter(r => r.status === 403).length, 6);
    for (let i = 0; i < results.length; i++) if (results[i].status === 200) assert.equal((await command(owner, 'cancel', { operation_id: requests[i].payload.operation_id })).status, 200);
  });
  await test('currency, payee and fee cap are bound before reservation', async () => {
    assert.equal((await command(child, 'authorize', { ...op('bad_currency'), currency: 'EUR' })).status, 403);
    assert.equal((await command(child, 'authorize', { ...op('bad_payee_001'), payee: 'attacker' })).status, 403);
    assert.equal((await command(child, 'authorize', { ...op('bad_fee_0001'), max_service_fee_atomic: '49999' })).status, 403);
  });
  await test('lost settlement response holds budget and never redispatches', async () => {
    mode = 'timeout'; const name = 'uncertain_operation'; await command(child, 'authorize', op(name));
    const start = calls, result = await command(child, 'execute', { operation_id: name });
    assert.equal(result.result.state, 'UNKNOWN');
    assert.equal((await command(child, 'execute', { operation_id: name })).result.state, 'UNKNOWN');
    assert.equal((await command(owner, 'cancel', { operation_id: name })).status, 409); assert.equal(calls - start, 1);
  });
  await test('SQLite restart preserves unknown state, replay fence and key', async () => {
    await mf.dispose(); mf = create(); await mf.ready;
    assert.equal((await command(child, 'status', { operation_id: 'uncertain_operation' })).result.state, 'UNKNOWN');
    assert.equal((await command(child, 'execute', { operation_id: 'uncertain_operation' })).result.state, 'UNKNOWN');
    assert.equal((await (await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/proof-key')).json()).jwk.x, key.jwk.x);
  });
  await test('read-only reconciliation confirms without another execute', async () => {
    mode = 'confirmed'; const count = calls, before = checks;
    assert.equal((await command(child, 'reconcile', { operation_id: 'uncertain_operation' })).result.state, 'CONFIRMED');
    assert.equal(calls, count); assert.equal(checks - before, 1);
  });
  await test('forged/wrong-payee/over-fee settlement evidence fails closed', async () => {
    for (const bad of ['forged','wrong_payee','fee_overrun']) {
      mode = bad; const name = 'evidence_' + bad; await command(child, 'authorize', op(name));
      assert.equal((await command(child, 'execute', { operation_id: name })).result.state, 'UNKNOWN');
      mode = 'failed'; assert.equal((await command(child, 'reconcile', { operation_id: name })).result.state, 'FAILED');
    }
  });
  await test('storage outage rolls back reservation and prevents dispatch', async () => {
    await mf.dispatchFetch('https://fixture.test/__fixture/fail', { method: 'POST', body: 'all' });
    const count = calls; assert.equal((await command(child, 'authorize', op('storage_outage_operation'))).status, 503); assert.equal(calls, count);
    await mf.dispatchFetch('https://fixture.test/__fixture/restore');
    assert.equal((await command(child, 'status', { operation_id: 'storage_outage_operation' })).status, 404);
  });
  await test('crash after provider execution cannot cause a repeated effect', async () => {
    mode = 'confirmed'; await command(child, 'authorize', op('crash_operation'));
    await mf.dispatchFetch('https://fixture.test/__fixture/fail', { method: 'POST', body: 'completion' });
    const count = calls; assert.equal((await command(child, 'execute', { operation_id: 'crash_operation' })).status, 503); assert.equal(calls - count, 1);
    await mf.dispatchFetch('https://fixture.test/__fixture/restore');
    assert.equal((await command(child, 'status', { operation_id: 'crash_operation' })).result.state, 'DISPATCHING');
    assert.equal((await command(child, 'execute', { operation_id: 'crash_operation' })).result.state, 'DISPATCHING'); assert.equal(calls - count, 1);
    assert.equal((await command(child, 'reconcile', { operation_id: 'crash_operation' })).result.state, 'CONFIRMED'); assert.equal(calls - count, 1);
  });
  await test('expired envelopes and private authentication keys are rejected', async () => {
    assert.equal((await command(child, 'authorize', op('expired_operation'), { now: Date.now() - 600000 })).status, 401);
    const privateJwk = await crypto.subtle.exportKey('jwk', stranger.privateKey), g = grant('private_key_grant', privateJwk, 'grant_child_001', '100', 1);
    assert.equal((await command(child, 'grant', g)).status, 400);
  });
  await test('revocation fences existing reservations and all descendants', async () => {
    mode = 'confirmed'; await command(child, 'authorize', op('revoked_operation'));
    assert.equal((await command(owner, 'revoke', { grant_id: 'grant_parent_001' })).status, 200);
    const count = calls; assert.equal((await command(child, 'execute', { operation_id: 'revoked_operation' })).status, 403); assert.equal(calls, count);
    assert.equal((await command(child, 'authorize', op('revoked_new_operation'))).status, 403);
    assert.equal((await command(owner, 'cancel', { operation_id: 'revoked_operation' })).status, 200);
  });
  await test('audit chain is hash-linked and sandbox revenue stays zero', async () => {
    const r = await command(owner, 'audit', { from: 1, limit: 100 }); assert.equal(r.status, 200);
    let previous = null;
    for (const event of r.result.events) { assert.equal(event.previous_hash, previous); const { hash, ...raw } = event; const { sha256 } = await import('viem'); assert.equal(hash, sha256(bytes(raw))); previous = hash; }
    const m = await command(owner, 'metrics', {}); assert.equal(m.result.billing.collected_usdc_atomic, '0'); assert.equal(m.result.billing.assessed_usdc_atomic, '0'); assert.equal(m.result.billing.actual_profit_usd, null);
  });
  let benchmark;
  await test('bounded load measures the whole local reserve-execute-receipt journey', async () => {
    const benchOrg = 'benchmark_organization', benchAgent = await createIdentity();
    assert.equal((await command(owner, 'enroll', { owner_key: owner.publicKey, policies: [policy('1000000')], accept_price_atomic: '50000' }, { org: benchOrg })).status, 200);
    assert.equal((await command(owner, 'grant', grant('benchmark_grant', benchAgent.publicKey, null, '1000000'), { org: benchOrg })).status, 200);
    mode = 'confirmed'; const durations = [], resources = [];
    for (let i = 0; i < 64; i++) {
      const name = 'benchmark_operation_' + i, start = performance.now();
      const a = await command(benchAgent, 'authorize', op(name, '1', 'benchmark_grant'), { org: benchOrg }); assert.equal(a.status, 200);
      const x = await command(benchAgent, 'execute', { operation_id: name }, { org: benchOrg }); assert.equal(x.result.state, 'CONFIRMED');
      assert.equal(verifyReceiptOffline(x.receipt.jws, key.jwk).valid, true);
      durations.push(performance.now() - start);
      resources.push({ reads: a.result.measured_resources.sql_rows_read + x.result.measured_resources.sql_rows_read, writes: a.result.measured_resources.sql_rows_written + x.result.measured_resources.sql_rows_written });
    }
    const wave = await Promise.all(Array.from({ length: 40 }, (_, i) => command(benchAgent, 'authorize', op('backpressure_operation_' + i, '1', 'benchmark_grant'), { org: benchOrg })));
    assert.equal(wave.filter(x => x.status === 200).length, 32); assert.equal(wave.filter(x => x.status === 429).length, 8);
    durations.sort((a,b) => a-b);
    benchmark = { samples: durations.length, concurrency_for_latency: 1, simultaneous_admissions: 40, accepted_admissions: 32, backpressure_429: 8, median_ms: durations[32], p95_ms: durations[Math.ceil(durations.length * .95)-1], max_ms: durations.at(-1), mean_rows_read: resources.reduce((a,r)=>a+r.reads,0)/resources.length, mean_rows_written: resources.reduce((a,r)=>a+r.writes,0)/resources.length, scope: 'In-process workerd SQLite plus real ProofRail signing and an attested mock executor. Excludes internet latency, real settlement, external buyer and production billing.' };
    resourceSamples.push(benchmark);
  });
  await test('unconfigured executor rejects before committing dispatch', async () => {
    await mf.dispose(); mf = create(false); await mf.ready;
    // A fresh organization avoids the intentional parent revocation above.
    const freshOrg = 'unconfigured_org', agent = await createIdentity();
    assert.equal((await command(owner, 'enroll', { owner_key: owner.publicKey, policies: [policy()], accept_price_atomic: '50000' }, { org: freshOrg })).status, 200);
    assert.equal((await command(owner, 'grant', grant('grant_no_adapter', agent.publicKey), { org: freshOrg })).status, 200);
    await command(agent, 'authorize', op('no_adapter_operation', '10', 'grant_no_adapter'), { org: freshOrg });
    const result = await command(agent, 'execute', { operation_id: 'no_adapter_operation' }, { org: freshOrg }); assert.equal(result.status, 503);
    assert.equal((await command(agent, 'status', { operation_id: 'no_adapter_operation' }, { org: freshOrg })).result.state, 'RESERVED');
  });
  if (process.env.AFA_EVIDENCE_DIR) {
    const out = process.env.AFA_EVIDENCE_DIR; await mkdir(out, { recursive: true });
    await writeFile(join(out, 'sample-sandbox-receipt.json'), JSON.stringify(sample.receipt, null, 2) + '\n');
    await writeFile(join(out, 'sample-sandbox-public-key.json'), JSON.stringify(key, null, 2) + '\n');
    await writeFile(join(out, 'runtime-security.json'), JSON.stringify({ generated_at: new Date().toISOString(), tests_passed: tests.length, tests, benchmark, resources: resourceSamples, real_money_moved: false, live_signing_key_created: false, independent_security_audit: false }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ workerd_authority: 'passed', tests: tests.length, execution_calls: calls, read_only_status_checks: checks, measured_resources: resourceSamples }));
} finally { if (mf) await mf.dispose(); await rm(persist, { recursive: true, force: true }); }
