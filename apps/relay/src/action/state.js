import { digest, fail, sign } from '../compute/common.js';
import { executeAction } from './catalog.js';
import { paypalApi, paypalOrderBody, validatePaypalOrder, paypalConfig } from './paypal.js';

const stamp = () => new Date().toISOString();
const terminal = new Set(['SUCCEEDED', 'REFUND_REQUIRED', 'REVERSED', 'REFUNDED', 'REVIEW_REQUIRED', 'EXPIRED']);
const json = (data, status = 200) => Response.json(data, { status });
export async function actionCall(env, id, action, body = {}) {
  if (!env.PAID_GATEWAY) throw fail('checkout_storage_unavailable', 503);
  const r = await env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName('action-cloud-v1:' + id)).fetch('https://action.internal/action/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await r.json();
  if (!r.ok) throw fail(value.error || 'checkout_state_unavailable', r.status);
  return value;
}
function view(q) {
  return { id: q.id, service: q.service, name: q.name, status: q.status, amount_cents: q.amount_cents, currency: 'USD', environment: q.environment, paypal_order_id: q.paypal_order_id ?? null, created_at: q.created_at, updated_at: q.updated_at, receipt: q.receipt ?? null, liability: q.liability ?? null, error: q.error ?? null, result_expires_at: q.result_expires_at ?? null };
}
async function storeResult(tx, value) {
  const text = JSON.stringify(value), bytes = new TextEncoder().encode(text);
  if (bytes.length > 262144) throw fail('action_result_limit', 422);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 49152) chunks.push(bytes.slice(i, i + 49152));
  for (let i = 0; i < chunks.length; i++) await tx.put('action:result:' + i, chunks[i]);
  return { chunks: chunks.length, bytes: bytes.length, sha256: await digest(text) };
}
async function readResult(storage, q) {
  if (!q.result_meta || q.status !== 'SUCCEEDED' || Date.now() > Date.parse(q.result_expires_at)) return null;
  const bytes = new Uint8Array(q.result_meta.bytes); let offset = 0;
  for (let i = 0; i < q.result_meta.chunks; i++) { const chunk = await storage.get('action:result:' + i); if (!chunk) throw fail('result_storage_unavailable', 503); bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function actionState(state, env, action, body) {
  try {
    if (action === 'admit') return json(await state.storage.transaction(async tx => {
      const day = stamp().slice(0, 10), old = await tx.get('action:admission'), rate = old?.day === day ? old : { day, orders: 0, actors: {} };
      const limit = Math.min(1000, Math.max(1, Number(env.XGUARD_ACTION_DAILY_ORDERS) || 100));
      if (rate.orders >= limit || (rate.actors[body.actor] || 0) >= 10) throw fail('checkout_daily_capacity', 429);
      rate.orders++; rate.actors[body.actor] = (rate.actors[body.actor] || 0) + 1;
      await tx.put('action:admission', rate); return { admitted: true };
    }));
    if (action === 'lookup') return json({ id: await state.storage.get('action:map:' + body.reference) ?? null });
    if (action === 'map') {
      await state.storage.transaction(async tx => { const key = 'action:map:' + body.reference, previous = await tx.get(key); if (previous && previous !== body.id) throw fail('payment_reference_conflict', 409); await tx.put(key, body.id); });
      return json({ ok: true });
    }
    if (action === 'init') return json(await state.storage.transaction(async tx => {
      const existing = await tx.get('action:v1');
      if (existing) { if (existing.token_hash !== body.token_hash || existing.fingerprint !== body.record.fingerprint) throw fail('idempotency_conflict', 409); return { order: view(existing), created: false }; }
      const q = { ...body.record, token_hash: body.token_hash, status: 'NEW', created_at: stamp(), updated_at: stamp(), attempts: 0, events: [{ state: 'NEW', at: stamp() }] };
      await tx.put('action:v1', q); await tx.setAlarm(Date.now() + 30 * 60000); return { order: view(q), created: true };
    }));
    const q = await state.storage.get('action:v1');
    if (!q) throw fail('order_not_found', 404);
    if (action === 'get') {
      if (q.token_hash !== body.token_hash) throw fail('order_not_found', 404);
      return json({ order: view(q), ...(q.status === 'SUCCEEDED' ? { result: await readResult(state.storage, q) } : {}) });
    }
    if (action === 'inspect') return json({ record: q }); // Internal binding only.
    if (action === 'claim') return json(await state.storage.transaction(async tx => {
      const row = await tx.get('action:v1');
      if (row.token_hash !== body.token_hash) throw fail('order_not_found', 404);
      const allowed = body.kind === 'create' ? ['NEW'] : ['AWAITING_PAYMENT'];
      if (!allowed.includes(row.status)) return { claimed: false, record: row };
      row.status = body.kind === 'create' ? 'CREATING' : 'CAPTURING'; row.updated_at = stamp(); row.events.push({ state: row.status, at: row.updated_at });
      await tx.put('action:v1', row); await tx.setAlarm(Date.now() + 30000); return { claimed: true, record: row };
    }));
    if (action === 'update') return json(await state.storage.transaction(async tx => {
      const row = await tx.get('action:v1');
      if (!body.expected.includes(row.status)) return { order: view(row) };
      const permitted = ['status', 'paypal_order_id', 'capture', 'error', 'liability', 'attempts'];
      for (const key of permitted) if (body.patch[key] !== undefined) row[key] = body.patch[key];
      row.updated_at = stamp(); row.events.push({ state: row.status, at: row.updated_at });
      row.events = row.events.slice(-32);
      await tx.put('action:v1', row);
      if (!terminal.has(row.status)) await tx.setAlarm(Date.now() + (row.status === 'PAID' ? 1 : 30000));
      return { order: view(row) };
    }));
    throw fail('unknown_checkout_action', 404);
  } catch (error) { return json({ error: error.code || 'checkout_state_unavailable' }, error.status || 503); }
}

export async function createPaypalOrder(env, id, token_hash) {
  const claim = await actionCall(env, id, 'claim', { kind: 'create', token_hash });
  if (!claim.claimed) return { order: view(claim.record) };
  const q = claim.record;
  try {
    const order = await paypalApi(env, 'POST', '/v2/checkout/orders', paypalOrderBody(q, env), q.id + '-create');
    validatePaypalOrder(order, q, env);
    await actionCall(env, 'references', 'map', { reference: order.id, id: q.id });
    return actionCall(env, id, 'update', { expected: ['CREATING'], patch: { status: 'AWAITING_PAYMENT', paypal_order_id: order.id } });
  } catch (error) {
    const code = /^[a-z_]{1,80}$/.test(error.code || '') ? error.code : 'paypal_order_creation_unconfirmed';
    console.warn(JSON.stringify({ event: 'checkout_order_creation_unconfirmed', code }));
    // Keep the bounded reason on the authenticated recovery record. Do not
    // expose raw provider bodies, credentials or merchant/buyer identity.
    return actionCall(env, id, 'update', { expected: ['CREATING'], patch: { status: 'REVIEW_REQUIRED', error: code } });
  }
}
export async function reconcilePaypalOrder(env, q) {
  // A delayed completion event cannot release a refund, dispute or denial hold.
  if (['REFUNDED', 'REVERSED'].includes(q.status) || q.error?.startsWith('provider_')) return { order: view(q) };
  const order = await paypalApi(env, 'GET', '/v2/checkout/orders/' + q.paypal_order_id);
  const capture = validatePaypalOrder(order, q, env, true);
  if (capture) {
    await actionCall(env, 'references', 'map', { reference: capture.id, id: q.id });
    return actionCall(env, q.id, 'update', { expected: ['AWAITING_PAYMENT', 'CAPTURING', 'PAYMENT_UNKNOWN', 'REVIEW_REQUIRED'], patch: { status: 'PAID', capture, attempts: 0, error: null } });
  }
  return { order: view(q) };
}
export async function capturePaypalOrder(env, id, token_hash) {
  const claim = await actionCall(env, id, 'claim', { kind: 'capture', token_hash });
  if (!claim.claimed) return { order: view(claim.record) };
  const q = claim.record;
  try {
    const order = await paypalApi(env, 'POST', '/v2/checkout/orders/' + q.paypal_order_id + '/capture', {}, q.id + '-capture');
    const capture = validatePaypalOrder(order, q, env, true);
    if (!capture) throw fail('capture_not_completed', 409);
    await actionCall(env, 'references', 'map', { reference: capture.id, id: q.id });
    return actionCall(env, id, 'update', { expected: ['CAPTURING'], patch: { status: 'PAID', capture, attempts: 0 } });
  } catch {
    return actionCall(env, id, 'update', { expected: ['CAPTURING'], patch: { status: 'PAYMENT_UNKNOWN', error: 'capture_requires_reconciliation' } });
  }
}

// Alarms are only scheduled for actual orders. No permanent polling or new
// namespace is needed. All task adapters are deterministic or public read-only.
export async function actionAlarm(state, env, fetchSource) {
  let q = await state.storage.get('action:v1');
  if (!q) return false;
  if (terminal.has(q.status)) {
    const expires = Date.parse(q.result_expires_at || q.created_at) + (q.result_expires_at ? 0 : 30 * 86400000);
    if (Date.now() >= expires) {
      await state.storage.transaction(async tx => {
        const row = await tx.get('action:v1');
        for (let i = 0; i < (row.result_meta?.chunks || 0); i++) await tx.delete('action:result:' + i);
        delete row.input; delete row.result_meta; delete row.workflow; row.content_purged_at = stamp(); await tx.put('action:v1', row);
      });
    } else await state.storage.setAlarm(expires);
    return true;
  }
  try {
    if (['NEW', 'AWAITING_PAYMENT'].includes(q.status)) {
      if (Date.now() - Date.parse(q.created_at) >= 30 * 60000) { q.status = 'EXPIRED'; delete q.input; }
      else { await state.storage.setAlarm(Date.parse(q.created_at) + 30 * 60000); return true; }
    } else if (q.status === 'CREATING') { q.status = 'REVIEW_REQUIRED'; q.error = 'order_creation_interrupted'; }
    else if (['CAPTURING', 'PAYMENT_UNKNOWN'].includes(q.status)) {
      await reconcilePaypalOrder(env, q);
      q = await state.storage.get('action:v1');
      if (q.status !== 'PAID') {
        q.attempts++;
        if (q.attempts >= 3) { q.status = 'REVIEW_REQUIRED'; q.error = 'payment_outcome_unknown'; }
        else { q.status = 'PAYMENT_UNKNOWN'; await state.storage.put('action:v1', q); await state.storage.setAlarm(Date.now() + 30000 * 2 ** q.attempts); return true; }
      }
    }
    if (['PAID', 'EXECUTING', 'RUNNING'].includes(q.status)) {
      q = await state.storage.transaction(async tx => {
        const row = await tx.get('action:v1');
        if (!['PAID', 'EXECUTING', 'RUNNING'].includes(row.status)) return null;
        row.status = 'EXECUTING'; await tx.put('action:v1', row); await tx.setAlarm(Date.now() + 30000); return row;
      });
      if (!q) return true;
      const started = performance.now(), result = await executeAction(env, q, fetchSource);
      if (result.workflow && result.progress.status !== 'COMPLETED') {
        if (['FAILED', 'CANCELLED'].includes(result.progress.status)) throw fail('workflow_not_completed', 422);
        q.workflow = result.workflow; q.status = 'RUNNING';
        const progress = result.progress;
        // Wake only around the original schedule/checkpoint, with a finite cap.
        const notBefore = Date.parse(q.input.run_at || '') || Date.now();
        const interval = (q.input.interval_seconds || 0) * 1000;
        const nextRun = notBefore + Math.max(0, (progress.current_run || 1) - 1) * interval;
        q.workflow_polls = (q.workflow_polls || 0) + 1;
        if (q.workflow_polls > 30) throw fail('workflow_recovery_limit', 503);
        await state.storage.transaction(async tx => { const latest = await tx.get('action:v1'); if (latest.status !== 'EXECUTING') return; await tx.put('action:v1', q); await tx.setAlarm(Math.max(Date.now() + 60000, nextRun + 30000)); });
        return true;
      }
      // Persist output before receipt signing. A signing outage never reruns work.
      await state.storage.transaction(async tx => {
        const latest = await tx.get('action:v1');
        if (latest.status !== 'EXECUTING') return;
        latest.result_meta = await storeResult(tx, result); latest.status = 'DELIVERY_PENDING'; latest.processing_ms = Math.ceil(performance.now() - started); latest.result_expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
        await tx.put('action:v1', latest);
      });
      q = await state.storage.get('action:v1');
    }
    if (q.status === 'DELIVERY_PENDING') {
      const receipt = { version: 1, order_id: q.id, service: q.service, environment: q.environment, amount_cents: q.amount_cents, currency: 'USD', paypal_capture_id: q.capture.id, input_sha256: q.fingerprint, result_sha256: q.result_meta.sha256, completed_at: stamp(), accounting: { payment_breakdown: q.capture.seller_receivable_breakdown, execution_engine: 'xguard-bounded-worker', processing_wall_ms: q.processing_ms, infrastructure_cost: null, net_profit: null, measured_profit_proven: false } };
      const proof = await sign(env, receipt);
      await state.storage.transaction(async tx => { const latest = await tx.get('action:v1'); if (latest.status !== 'DELIVERY_PENDING') return; latest.receipt = { payload: receipt, proof }; latest.status = 'SUCCEEDED'; latest.updated_at = stamp(); delete latest.input; latest.events.push({ state: 'SUCCEEDED', at: latest.updated_at }); await tx.put('action:v1', latest); await tx.setAlarm(Date.parse(latest.result_expires_at)); });
      return true;
    }
    await state.storage.put('action:v1', q);
  } catch (error) {
    q = await state.storage.get('action:v1');
    if (terminal.has(q.status)) return true;
    q.attempts++;
    if (q.attempts >= 3) {
      q.status = q.capture ? 'REFUND_REQUIRED' : 'REVIEW_REQUIRED';
      q.error = 'task_or_payment_dependency_unavailable';
      if (q.capture) q.liability = { amount_cents: q.amount_cents, currency: 'USD', capture_id: q.capture.id, reason: 'Paid output was not delivered. Operator reconciliation/refund required; no automatic funds movement authorized.' };
    } else await state.storage.setAlarm(Date.now() + 30000 * 2 ** q.attempts);
    await state.storage.put('action:v1', q);
  }
  return true;
}
