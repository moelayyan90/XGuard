// The dashboard creates an untagged version when encrypted bindings are added.
// Restore its proven source annotation only after matching the provider's code
// ETag to the last CI-deployed release. No script, binding or payment gate changes.
import assert from 'node:assert/strict';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && /^[a-f0-9]{32}$/i.test(account || ''), 'Provider credentials unavailable');
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/xguard-mainnet`;
const knownVersion = '07f811dc-752d-4281-821d-8defa6d7c8f9';
const configuredVersion = '7575edeb-8949-496a-83a3-103401538499';
const expectedTag = 'git-6a7c27ed9da0';
async function api(path, body) {
  const r = await fetch(root + path, { method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${token}` }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
  const data = await r.json();
  assert.ok(r.ok && data.success, `Provider request failed (${r.status}); no credential output`);
  return data.result;
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
  assert.ok(known.resources?.script?.etag, 'Missing source identity evidence');
  assert.equal(current.resources?.script?.etag, known.resources.script.etag, 'Source bytes differ; annotation forbidden');
  const settings = await api('/settings');
  const names = new Map((settings.bindings || []).map(b => [b.name, b.type]));
  for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_VERIFIED_EMAIL', 'PAYPAL_ENVIRONMENT', 'PAYPAL_ENABLED']) assert.equal(names.get(name), 'secret_text', 'Provider credential is not encrypted');
  const form = new FormData();
  form.set('settings', JSON.stringify({ annotations: { 'workers/tag': expectedTag, 'workers/message': 'Preserve verified source identity after owner-authorized encrypted PayPal configuration' } }));
  await api('/settings', form);
  const after = await api('/settings');
  assert.equal(after.annotations?.['workers/tag'], expectedTag);
  assert.deepEqual(after.bindings, settings.bindings, 'Metadata update must preserve bindings');
  console.log(JSON.stringify({ source_metadata: 'restored', tag: expectedTag, code_etag_matched: true, bindings_preserved: true, real_payments: 0 }));
}
