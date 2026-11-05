// Read-only inventory. The report is encrypted before leaving the runner.
import { readFileSync } from 'node:fs';
import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
if (!token || !/^[a-f0-9]{32}$/i.test(account)) throw new Error('Inventory credentials unavailable');
const api = async path => {
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/' + path, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const b = await r.json(); return { status: r.status, result: b.result ?? null, errors: b.errors?.map(x => ({ code: x.code, message: x.message })) };
  } catch { return { status: 'unavailable' }; }
};
const report = { at: new Date().toISOString(), mutation_count: 0, workers: {}, probes: [] };
await Promise.all(['xguard-mainnet', 'xguard-settlement-gateway', 'xguard-reconcile', 'xguard-lemonhook'].map(async name => {
  const prefix = `accounts/${account}/workers/scripts/${name}`;
  const [settings, deployments, schedules, secrets] = await Promise.all([api(prefix + '/settings'), api(prefix + '/deployments'), api(prefix + '/schedules'), api(prefix + '/secrets')]);
  report.workers[name] = { settings, deployments, schedules, secrets };
}));
report.custom_domains = await api(`accounts/${account}/workers/domains`);
report.durable_objects = await api(`accounts/${account}/workers/durable_objects/namespaces?per_page=100`);
const zones = await api('zones?name=xguardgate.com');
report.zones = zones;
const zone = zones.result?.find?.(x => x.name === 'xguardgate.com');
if (zone?.id) {
  [report.dns, report.routes] = await Promise.all([api(`zones/${zone.id}/dns_records?per_page=100`), api(`zones/${zone.id}/workers/routes`)]);
}
const origin = 'https://xguardgate.com';
async function probe(url, extra = {}) {
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { accept: 'application/json', 'user-agent': 'XGuardLiveAudit/1.0', 'x-xguard-traffic-class': 'synthetic', ...extra }, signal: AbortSignal.timeout(20000) });
    const body = await r.text(); const result = { url, status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => ['content-type', 'location', 'x-xguard-worker-version-id', 'x-xguard-worker-version-tag', 'payment-required', 'link', 'x-robots-tag'].includes(k))), body: body.slice(0, 18000) };
    report.probes.push(result); return result;
  } catch { const result = { url, status: 'network_unavailable' }; report.probes.push(result); return result; }
}
await Promise.all(['/healthz', '/robots.txt', '/sitemap.xml', '/.well-known/x402', '/fact/npm/react/latest-version?format=json', '/history/npm/react/latest-version?format=json', '/live/npm/react?format=json', '/api/paid/v1/readiness', '/api/v1/premium/catalog'].map(p => probe(origin + p)));
await probe('http://xguardgate.com/live/npm/@ai-sdk/provider-utils?format=json');
await probe(origin + '/fact/npm/react/latest-version', { 'user-agent': 'Googlebot' });
await probe('https://reconcile.xguardgate.com/.well-known/x402');
const key = process.env.LIVE_ADMIN_KEY || '';
report.owner_key_available = key.length >= 24;
if (key.length >= 24) await probe(origin + '/admin/paid-revenue', { authorization: `Bearer ${key}` });
const bytes = Buffer.from(JSON.stringify(report));
const aes = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', aes, iv);
const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
const wrapped = publicEncrypt({ key: readFileSync('scripts/crawler-inventory-public.pem'), oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, aes);
console.log('XGUARD_ENCRYPTED_INVENTORY=' + JSON.stringify({ v: 1, key: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), payload: ciphertext.toString('base64') }));
console.log('Read-only inventory finished. Private settings and financial data are encrypted. No secrets or raw records were printed.');
