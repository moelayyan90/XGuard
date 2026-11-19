import type { Env } from './types.ts';
import { ORIGIN } from './types.ts';
import { controlName, json, rpc } from './util.ts';

const ledger = ORIGIN + '/admin/paypal/ledger';
const hour = 60 * 60 * 1000;
const fields = new Set(['id', 'name', 'status', 'created_at', 'updated_at', 'quoted_cents',
  'captured_cents', 'fee_cents', 'refund_cents', 'denied', 'delivered', 'review', 'liability_cents']);
type Handler = (request: Request, env: Env) => Promise<Response>;

async function checkReport(env: Env, admin: Handler): Promise<boolean> {
  const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
  if (!key || key.length < 24) return false;
  const form = { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } };
  if ((await admin(new Request(ledger, form), env)).status !== 401) return false;
  const headers = { ...form.headers, authorization: 'Bearer ' + key };
  // Direct handler calls stay in the Worker. No request containing owner credentials leaves it.
  const page = await admin(new Request(ORIGIN + '/admin/paypal', { headers }), env);
  if (page.status !== 200 || !(await page.text()).includes('/admin/paypal/ledger')) return false;
  const report = await admin(new Request(ledger, { ...form, headers }), env);
  if (report.status !== 200 || !report.headers.get('cache-control')?.includes('no-store')) return false;
  const data: any = await report.json();
  return data?.scope === 'mapped_xguard_paypal_live_orders' &&
    Array.isArray(data.rows) && data.rows.length <= 12 &&
    (data.next === null || (typeof data.next === 'string' && /^[A-Z0-9]{8,32}$/.test(data.next))) &&
    data.rows.every((row: any) => row && Object.keys(row).every(k => fields.has(k)) &&
      (row.captured_cents === null || Number.isSafeInteger(row.captured_cents)));
}

export async function refreshOwnerReportCheck(env: Env, admin: Handler) {
  const id = env.CF_VERSION_METADATA?.id;
  if (!id) return;
  const key = 'owner-report-health:' + id;
  const saved = await rpc(env.LIVE_CONTROL, controlName, 'get', { key });
  if (saved?.ok === true && Date.now() - Date.parse(saved.checked_at) < hour) return;
  let ok = false;
  try { ok = await checkReport(env, admin); } catch { /* Other subsystems keep running during an outage. */ }
  await rpc(env.LIVE_CONTROL, controlName, 'set', { key, value: { ok, checked_at: new Date().toISOString() } });
}

export async function ownerReportHealth(env: Env): Promise<Response> {
  const worker_id = env.CF_VERSION_METADATA?.id;
  const saved = worker_id && await rpc(env.LIVE_CONTROL, controlName, 'get', { key: 'owner-report-health:' + worker_id });
  const at = Date.parse(saved?.checked_at);
  const fresh = Number.isFinite(at) && at <= Date.now() && Date.now() - at < hour + 15 * 60000;
  const status = fresh ? (saved.ok === true ? 'verified' : 'unavailable') : 'pending';
  return json({ worker_id, status, checked_at: fresh ? new Date(at).toISOString() : null },
    status === 'verified' ? 200 : 503, { 'cache-control': 'no-store' });
}
