// Enable Preview URLs for the already-authorized Sandbox checkout. Preserve the
// production workers.dev setting and every deployed version/binding unchanged.
import assert from 'node:assert/strict';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && /^[a-f0-9]{32}$/i.test(account || ''), 'Provider credentials unavailable');
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/xguard-mainnet`;
async function api(path, body) {
  const r = await fetch(root + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
  const data = await r.json();
  assert.ok(r.ok && data.success, `Provider request failed (${r.status}); no credential output`);
  return data.result;
}
const before = await api('/subdomain');
const deployed = (await api('/deployments')).deployments?.[0];
assert.equal(deployed?.versions?.length, 1, 'Require one deployed production version');
assert.equal(deployed.versions[0].percentage, 100);
assert.equal(typeof before.enabled, 'boolean');
if (!before.previews_enabled) await api('/subdomain', { enabled: before.enabled, previews_enabled: true });
const after = await api('/subdomain');
assert.equal(after.enabled, before.enabled, 'Production workers.dev setting must be preserved');
assert.equal(after.previews_enabled, true);
const active = (await api('/deployments')).deployments?.[0];
assert.ok(JSON.stringify(active?.versions) === JSON.stringify(deployed.versions), 'Preview routing must not redeploy production');
console.log(JSON.stringify({ preview_urls: 'enabled', production_workers_dev_preserved: true, production_version: active.versions[0].version_id, production_deployment_preserved: true, real_payments: 0 }));
