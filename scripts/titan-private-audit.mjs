import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';

const account = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/[\r\n]/g, '').trim()
  .replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
const adminKey = (process.env.LIVE_ADMIN_KEY || '').trim();
const publicKey = readFileSync(new URL('./titan-audit-recipient.pem', import.meta.url));
const periods = [
  ['before', '2026-10-20T00:00:00Z', '2026-10-27T00:00:00Z'],
  ['after', '2026-10-27T00:00:00Z', '2026-11-03T00:00:00Z'],
];

async function readJson(url, headers, query) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...headers, ...(query ? { 'content-type': 'application/json' } : {}) },
      ...(query ? { method: 'POST', body: JSON.stringify({ query }) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch { return { status: 'network_unavailable', body: null }; }
}

function diagnostic(result) {
  const message = String(result.body?.errors?.[0]?.message || '').toLowerCase();
  if (result.status === 401 || result.status === 403 || /unauthori[sz]ed|permission|access denied|not authorized|not allowed to access|do not have access/.test(message)) return 'access_denied';
  if (/time range|data older|history limit/.test(message)) return 'date_range_unavailable';
  if (/cannot query field|unknown argument|unknown field|does not exist/.test(message)) return 'schema_unavailable';
  if (result.body?.errors?.length) return 'graphql_error';
  return result.status === 200 ? 'ok' : 'request_failed';
}

async function cloudflare() {
  if (!token || !/^[a-f0-9]{32}$/i.test(account)) return { status: 'credential_unavailable' };
  const base = 'https://api.cloudflare.com/client/v4/';
  const headers = { authorization: 'Bearer ' + token };
  const request = (path, query) => readJson(base + path, headers, query);
  const gql = query => request('graphql', query);
  const zones = await request('zones?name=xguardgate.com');
  const zone = Array.isArray(zones.body?.result)
    ? zones.body.result.find(z => z.name === 'xguardgate.com' && z.account?.id === account)?.id : null;
  const result = { zoneLookup: zones.status, traffic: {}, workers: {} };

  async function traffic(start, end) {
    if (!/^[a-f0-9]{32}$/i.test(zone || '')) return { status: 'zone_unavailable' };
    const filter = `datetime_geq:"${start}",datetime_lt:"${end}"`;
    const edge = await gql(`{viewer{zones(filter:{zoneTag:"${zone}"}){httpRequestsAdaptiveGroups(limit:1000,filter:{${filter}}){count dimensions{clientRequestHTTPHost edgeResponseStatus}}}}}`);
    return { http: edge.status, status: diagnostic(edge), groups: edge.body?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? null };
  }
  async function workers(start, end) {
    const metrics = await gql(`{viewer{accounts(filter:{accountTag:"${account}"}){workersInvocationsAdaptive(limit:1,filter:{scriptName:"xguard-mainnet",datetime_geq:"${start}",datetime_lt:"${end}"}){sum{requests errors}}}}}`);
    return { http: metrics.status, status: diagnostic(metrics), counts: metrics.body?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum ?? null };
  }
  for (const [label, start, end] of periods) {
    [result.traffic[label], result.workers[label]] = await Promise.all([traffic(start, end), workers(start, end)]);
  }
  const fields = await gql('{__type(name:"Account"){fields{name}}}');
  result.storage = {
    status: diagnostic(fields),
    relatedDatasets: fields.body?.data?.__type?.fields?.map(field => field.name).filter(name => /durable|sqlite/i.test(name)) ?? null,
  };
  return result;
}

async function paid() {
  if (adminKey.length < 24) return { status: 'credential_unavailable' };
  const result = await readJson('https://xguardgate.com/admin/paid-revenue', {
    authorization: 'Bearer ' + adminKey,
    'x-xguard-traffic-class': 'synthetic',
    'user-agent': 'XGuardTitanAudit/1.0',
  });
  const body = result.body;
  const fields = ['payment_attempts', 'verified_authorizations', 'settlement_success_events', 'signed_results_delivered',
    'confirmed_cash_usdc_atomic', 'recognized_revenue_usdc_atomic', 'unfulfilled_usdc_atomic', 'actual_cost_usd',
    'net_profit_usd', 'payout_due_usd'];
  const metrics = Object.fromEntries(fields.map(field => [field, typeof body?.[field] === 'number' ? body[field] : null]));
  return { http: result.status, status: body?.status === 'UNKNOWN' ? 'ledger_unavailable' : diagnostic(result), metrics };
}

const [provider, revenue] = await Promise.all([cloudflare(), paid()]);
const plaintext = Buffer.from(JSON.stringify({ at: new Date().toISOString(), periods, provider, revenue }));
const key = randomBytes(32);
const nonce = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, nonce);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
const sealed = [wrapped, nonce, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.');
console.log('TITAN_AUDIT_V1=' + sealed);
