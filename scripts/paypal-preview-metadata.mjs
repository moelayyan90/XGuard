// The dashboard creates an untagged version when encrypted bindings are added.
// Restore its proven source annotation only after matching its runtime modules
// to the last CI-deployed release. No script, binding or payment gate changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && /^[a-f0-9]{32}$/i.test(account || ''), 'Provider credentials unavailable');
const accountRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const root = '/workers/scripts/xguard-mainnet';
const knownVersion = '07f811dc-752d-4281-821d-8defa6d7c8f9';
const configuredVersion = '7575edeb-8949-496a-83a3-103401538499';
const expectedTag = 'git-6a7c27ed9da0';
async function accountApi(path, body) {
  const r = await fetch(accountRoot + path, { method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${token}` }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await r.json();
  assert.ok(r.ok && data.success, `Provider request failed (${r.status}); no credential output`);
  return data.result;
}
const api = (path, body) => accountApi(root + path, body);
function moduleIdentity(version) {
  assert.ok(Array.isArray(version.modules) && version.modules.length > 0, 'Provider did not return runtime source');
  return version.modules.map(m => {
    assert.ok(m.name && m.content_type && typeof m.content_base64 === 'string', 'Incomplete runtime source');
    return { name: m.name, type: m.content_type, sha256: createHash('sha256').update(Buffer.from(m.content_base64, 'base64')).digest('hex') };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
async function assertSameModules(previousId, currentId) {
  let worker;
  for (let page = 1; page <= 10 && !worker; page++) {
    const list = await accountApi('/workers/workers?per_page=100&page=' + page);
    assert.ok(Array.isArray(list), 'Provider worker inventory unavailable');
    worker = list.find(x => x.name === 'xguard-mainnet');
    if (list.length < 100) break;
  }
  assert.ok(worker?.id, 'Existing Worker identity unavailable');
  const path = '/workers/workers/' + encodeURIComponent(worker.id) + '/versions/';
  const known = await accountApi(path + previousId + '?include=modules');
  const current = await accountApi(path + currentId + '?include=modules');
  assert.equal(JSON.stringify(moduleIdentity(current)), JSON.stringify(moduleIdentity(known)), 'Runtime module bytes differ; annotation forbidden');
  assert.equal(current.compatibility_date, known.compatibility_date, 'Runtime compatibility differs');
  assert.equal(JSON.stringify(current.compatibility_flags || []), JSON.stringify(known.compatibility_flags || []), 'Runtime compatibility flags differ');
}
const active = (await api('/deployments')).deployments?.[0];
assert.equal(active?.versions?.length, 1, 'Require one production version');
assert.equal(active.versions[0].percentage, 100);
const current = await api('/versions/' + active.versions[0].version_id);
if (current.annotations?.['workers/tag'] === expectedTag) {
  console.log(JSON.stringify({ source_metadata: 'already_verified', tag: expectedTag }));
} else {
  assert.equal(active.versions[0].version_id, configuredVersion, 'Production changed; inspect before annotation');
  assert.ok(!current.annotations?.['workers/tag']);
  const known = await api('/versions/' + knownVersion);
  assert.equal(known.annotations?.['workers/tag'], expectedTag);
  // A settings update changed the version ETag. Do not infer code identity from
  // that hash: compare every provider-returned runtime module byte instead.
  await assertSameModules(knownVersion, configuredVersion);
  const settings = await api('/settings');
  const names = new Map((settings.bindings || []).map(b => [b.name, b.type]));
  for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_VERIFIED_EMAIL', 'PAYPAL_ENVIRONMENT', 'PAYPAL_ENABLED']) assert.equal(names.get(name), 'secret_text', 'Provider credential is not encrypted');
  const form = new FormData();
  form.set('settings', JSON.stringify({ annotations: { 'workers/tag': expectedTag, 'workers/message': 'Preserve verified source identity after owner-authorized encrypted PayPal configuration' } }));
  const latest = (await api('/deployments')).deployments?.[0];
  assert.equal(latest?.versions?.length, 1, 'Production changed during inspection');
  assert.equal(latest.versions[0].version_id, configuredVersion, 'Production changed during inspection');
  assert.equal(latest.versions[0].percentage, 100);
  await api('/settings', form);
  const after = await api('/settings');
  assert.equal(after.annotations?.['workers/tag'], expectedTag);
  assert.ok(JSON.stringify(after.bindings) === JSON.stringify(settings.bindings), 'Metadata update must preserve bindings');
  console.log(JSON.stringify({ source_metadata: 'restored', tag: expectedTag, runtime_modules_matched: true, bindings_preserved: true, real_payments: 0 }));
}
