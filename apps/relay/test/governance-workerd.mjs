import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requestDigest } from '../src/core/execution-contract.js';

const modulePath = process.env.XGUARD_MINIFLARE_MODULE || process.env.PATH.split(delimiter).map(p => resolve(p, '../miniflare/dist/src/index.js')).find(existsSync);
if (!modulePath) throw Error('Run using npm exec --package=wrangler@4.130.0 or supply XGUARD_MINIFLARE_MODULE.');
const { Miniflare, convertV4MiniflareOptions, Response: MFResponse } = await import(pathToFileURL(modulePath));
const bundle = process.env.XGUARD_WORKER_BUNDLE || '/tmp/xguard-governance-worker/canonical-entry.js';
const calls = { bills: 0, providers: 0 };
const bindings = { EGRESS_EXECUTION_CREDITS: '1', XGUARD_BILLING_URL: 'https://billing.fixture' };
const classes = { EGRESS_KEYS: 'EgressKeyAuthority', EGRESS_CREDENTIALS: 'EgressCredentialState', EGRESS_CAPABILITIES: 'EgressCapabilityState', EGRESS_TENANTS: 'EgressTenantIndex', EGRESS_METER: 'EgressMeter', PROOF_AUTHORITY: 'ProofAuthority' };
const options = { modulesRoot: dirname(resolve(bundle)), modules: true, scriptPath: bundle, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'], bindings,
  durableObjects: Object.fromEntries(Object.entries(classes).map(([name, className]) => [name, { className, useSQLite: true }])),
  outboundService: async request => {
    const url = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) return MFResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (url.hostname === 'billing.fixture' && url.pathname === '/v1/balance') return MFResponse.json({ credits: 100 });
    if (url.hostname === 'billing.fixture' && url.pathname === '/v1/consume') { calls.bills++; return MFResponse.json({ ok: true }); }
    if (url.hostname === 'api.github.com') {
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-provider-key');
      calls.providers++;
      return MFResponse.json({ accepted: true, request: await request.json() }, { status: 201 });
    }
    throw Error(`Unexpected fixture egress: ${url.hostname}`);
  },
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
const post = (path, body, headers = {}) => mf.dispatchFetch(`https://api.xguardgate.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const directory = mkdtempSync(resolve(tmpdir(), 'xguard-governance-'));
let server;
try {
  const owner = { 'x-xguard-key': 'fixture-owner-key' };
  const response = await post('/v1/egress/credentials', { provider: 'github', value: 'fixture-provider-key', allowed_paths: ['/repos/acme/service'], allowed_methods: ['POST'] }, owner);
  assert.equal(response.status, 201, await response.clone().text());
  const credential = (await response.json()).credential;
  const input = { target: 'https://api.github.com/repos/acme/service/issues', method: 'POST', body_json: { title: 'مهمة مأذونة' } };
  const forecast = { request_digest: await requestDigest(input.target, input.method, new Headers({ 'content-type': 'application/json' }), JSON.stringify(input.body_json)),
    revenue_if_success_usd_micros: '10000', success_probability_bps: 9000, failure_loss_usd_micros: '100',
    api_cost_usd_micros: '500', compute_cost_usd_micros: '100', payment_cost_usd_micros: '100', slippage_cost_usd_micros: '100', safety_buffer_cost_usd_micros: '100', valid_until: new Date(Date.now() + 600000).toISOString() };
  const grant = { credential_id: credential.id, allowed_methods: ['POST'], max_calls: 10, max_total_credits: 10,
    governance: { version: 1, currency: 'USD', minimum_net_usd_micros: '100', daily_cost_limit_usd_micros: '2000', forecasts: [forecast] } };
  const issued = await post('/v1/egress/capabilities', grant, owner);
  assert.equal(issued.status, 201, await issued.clone().text());
  const capability = (await issued.json()).capability;
  const publicKey = await (await mf.dispatchFetch('https://api.xguardgate.com/.well-known/xguard-proof-key.json')).json();
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${directory}/key.pem`, '-out', `${directory}/cert.pem`, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(`${directory}/key.pem`), cert: readFileSync(`${directory}/cert.pem`) }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const response = await post(req.url, JSON.parse(body));
      let bytes = Buffer.from(await response.arrayBuffer());
      if (req.url === '/v1/egress/fetch' && JSON.parse(body).idempotency_key === 'tampered-result-001' && response.ok) bytes = Buffer.from('{"forged":true}');
      const headers = Object.fromEntries(response.headers); delete headers['content-length'];
      res.writeHead(response.status, headers); res.end(bytes);
    } catch { res.writeHead(500); res.end('fixture_error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn('python3', ['sdk/test_governance_integration.py'], { cwd: process.cwd(), env: { ...process.env, SSL_CERT_FILE: `${directory}/cert.pem`, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  child.stdin.end(JSON.stringify({ capability, public_key: publicKey.jwk, api: `https://127.0.0.1:${server.address().port}`, journal: `${directory}/agent.sqlite`, input }));
  const exit = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(exit, 0, errors); assert.match(output, /python_governance_verified/);
  assert.deepEqual(calls, { bills: 2, providers: 2 });
  const state = await (await post('/v1/egress/governance-status', { capability })).json();
  assert.equal(state.state, 'HALTED');
  // Reprovisioning under the same owner must not reset the daily ledger.
  const second = await (await post('/v1/egress/capabilities', grant, owner)).json();
  const next = { ...input, capability: second.capability, idempotency_key: 'over-shared-budget-001' };
  const auth = await (await post('/v1/egress/authorize', next)).json();
  const denied = await post('/v1/egress/fetch', { ...next, governance_authorization: auth.authorization });
  assert.equal(denied.status, 412); assert.deepEqual(calls, { bills: 2, providers: 2 });
  console.log(JSON.stringify({ ok: true, runtime: 'workerd SQLite Durable Objects', python_tls_and_pinned_es256: true, unicode_digest_interop: true, tampered_result_halted: true, recovery_resubmitted: false, shared_daily_budget_enforced: true, calls, real_payments: false }));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await mf.dispose(); rmSync(directory, { recursive: true, force: true });
}
