import { digest, fail, sign } from '../compute/common.js';
import { executeAction } from './catalog.js';
import { paypalApi, paypalOrderBody, validatePaypalOrder, paypalConfig } from './paypal.js';
import { storageQuotaCode } from '../live/util.ts';

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
    if (action === 'finance-page') {
      if (body.after && !/^[A-Z0-9]{8,32}$/.test(body.after)) throw fail('invalid_finance_cursor', 400);
      const prefix = 'action:map:', limit = 12;
      const rows = await state.storage.list({ prefix, limit: limit + 1, ...(body.after ? { startAfter: prefix + body.after } : {}) });
      const entries = [...rows].slice(0, limit).map(([key, id]) => ({ ref: key.slice(prefix.length), id }));
      return json({ entries, next: rows.size > limit ? entries[limit - 1].ref : null });
    }
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
    if (action === 'inspect') return json({ record: q, ...(body.event_id ? { seen_event: await state.storage.get('action:event:' + body.event_id) } : {}) }); // Internal binding only.
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
      let patch = body.patch;
      if (body.notice) {
        const eventKey = 'action:event:' + body.notice.id;
        const seen = await tx.get(eventKey);
        if (seen) {
          if (seen.fingerprint !== body.notice.fingerprint) throw fail('paypal_event_conflict', 409);
          return { order: view(row) };
        }
        await tx.put(eventKey, { ...body.notice, received_at: stamp(), previous_state: row.status, ...(body.refund ? { refund: body.refund } : {}) });
      }
      if (body.refund) {
        const refundKey = 'action:refund:' + body.refund.id;
        const known = await tx.get(refundKey);
        if (known !== undefined && known !== body.refund.cents) throw fail('paypal_refund_amount_conflict', 409);
        if (known === undefined) {
          const cents = (row.confirmed_refund_cents || 0) + body.refund.cents;
          if (cents > row.amount_cents) throw fail('paypal_refund_total_invalid', 409);
          row.confirmed_refund_cents = cents;
          await tx.put(refundKey, body.refund.cents);
          await tx.put('action:v1', row);
        }
        if (row.confirmed_refund_cents === row.amount_cents) {
          patch = { status: 'REFUNDED', error: 'provider_refund_confirmed' };
        }
      }
      // Capture confirmation can race with local expiry, denial or a refund.
      // Retain the independently verified financial record on the held order.
      if (patch.status === 'PAID' && (['EXPIRED', 'REFUNDED', 'REVERSED'].includes(row.status) || row.error?.startsWith('provider_'))) {
        if (row.capture || patch.capture?.status !== 'COMPLETED') return { order: view(row) };
        patch = row.status === 'EXPIRED' ? {
          capture: patch.capture, status: 'REFUND_REQUIRED', error: 'completed_capture_after_expiry',
          liability: { capture_id: patch.capture.id, amount_cents: row.amount_cents, currency: 'USD', reason: 'Capture confirmed after the unpaid order expired and its input was removed.' },
        } : { capture: patch.capture };
      } else if (!body.expected.includes(row.status)) return { order: view(row) };
      if (row.capture && ['provider_approval_reversed', 'provider_capture_denied'].includes(patch.error)) return { order: view(row) };
      const permitted = ['status', 'paypal_order_id', 'capture', 'error', 'liability', 'attempts'];
      for (const key of permitted) if (patch[key] !== undefined) row[key] = patch[key];
      row.updated_at = stamp(); row.events.push({ state: row.status, at: row.updated_at });
      row.events = row.events.slice(-32);
      await tx.put('action:v1', row);
      if (!terminal.has(row.status)) await tx.setAlarm(Date.now() + (row.status === 'PAID' ? 1 : 30000));
      return { order: view(row) };
    }));
    throw fail('unknown_checkout_action', 404);
  } catch (error) { return json({ error: storageQuotaCode(error) || error.code || 'checkout_state_unavailable' }, error.status || 503); }
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
export async function reconcilePaypalOrder(env, q, confirmedOrder, notice) {
  // A delayed completion event cannot release a refund, dispute or denial hold.
  if (q.capture && terminal.has(q.status)) {
    if (notice) return actionCall(env, q.id, 'update', { notice, expected: [], patch: {} });
    return { order: view(q) };
  }
  const order = confirmedOrder ?? await paypalApi(env, 'GET', '/v2/checkout/orders/' + q.paypal_order_id);
  const capture = validatePaypalOrder(order, q, env, true);
  if (capture) {
    await actionCall(env, 'references', 'map', { reference: capture.id, id: q.id });
    return actionCall(env, q.id, 'update', { notice, expected: ['AWAITING_PAYMENT', 'CAPTURING', 'PAYMENT_UNKNOWN', 'REVIEW_REQUIRED'], patch: { status: 'PAID', capture, attempts: 0, error: null } });
  }
  if (notice) throw fail('paypal_capture_evidence_not_ready', 503);
  return { order: view(q) };
}
export async function capturePaypalOrder(env, id, token_hash) {
  const { record } = await actionCall(env, id, 'inspect');
  if (record.token_hash !== token_hash) throw fail('order_not_found', 404);
  if (record.status !== 'AWAITING_PAYMENT') return { order: view(record) };
  // The SDK callback and the browser return can arrive concurrently or be replayed.
  // Only PayPal's own order representation can authorize the transition.
  const approvedOrder = await paypalApi(env, 'GET', '/v2/checkout/orders/' + record.paypal_order_id);
  validatePaypalOrder(approvedOrder, record, env);
  if (approvedOrder.status === 'COMPLETED') return reconcilePaypalOrder(env, record, approvedOrder);
  if (approvedOrder.status !== 'APPROVED') return { order: view(record) };
  if (!paypalConfig(env).ready) throw fail('card_payments_not_activated', 503);
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
      await state.storage.transaction(async tx => {
        const row = await tx.get('action:v1');
        if (!['NEW', 'AWAITING_PAYMENT'].includes(row.status)) return;
        const expires = Date.parse(row.created_at) + 30 * 60000;
        if (Date.now() < expires) { await tx.setAlarm(expires); return; }
        row.status = 'EXPIRED'; row.updated_at = stamp(); delete row.input;
        row.events.push({ state: row.status, at: row.updated_at }); await tx.put('action:v1', row);
      });
      return true;
    } else if (q.status === 'CREATING') {
      await actionCall(env, q.id, 'update', { expected: ['CREATING'], patch: { status: 'REVIEW_REQUIRED', error: 'order_creation_interrupted' } });
      return true;
    }
    else if (['CAPTURING', 'PAYMENT_UNKNOWN'].includes(q.status)) {
      await reconcilePaypalOrder(env, q);
      q = await state.storage.transaction(async tx => {
        const row = await tx.get('action:v1');
        if (row.status === 'PAID') return row;
        if (!['CAPTURING', 'PAYMENT_UNKNOWN'].includes(row.status)) return null;
        row.attempts++;
        if (row.attempts >= 3) { row.status = 'REVIEW_REQUIRED'; row.error = 'payment_outcome_unknown'; }
        else { row.status = 'PAYMENT_UNKNOWN'; await tx.setAlarm(Date.now() + 30000 * 2 ** row.attempts); }
        await tx.put('action:v1', row); return null;
      });
      if (!q) return true;
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
  } catch (error) {
    await state.storage.transaction(async tx => {
      const row = await tx.get('action:v1');
      if (terminal.has(row.status)) return;
      row.attempts++;
      if (row.attempts >= 3) {
        row.status = row.capture ? 'REFUND_REQUIRED' : 'REVIEW_REQUIRED';
        row.error = 'task_or_payment_dependency_unavailable';
        if (row.capture) row.liability = { amount_cents: row.amount_cents, currency: 'USD', capture_id: row.capture.id, reason: 'Paid output was not delivered. Operator reconciliation/refund required; no automatic funds movement authorized.' };
      } else await tx.setAlarm(Date.now() + 30000 * 2 ** row.attempts);
      await tx.put('action:v1', row);
    });
  }
  return true;
}
