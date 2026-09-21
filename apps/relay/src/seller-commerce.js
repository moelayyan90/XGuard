import { digestBytes } from './core/execution-contract.js';
import { SELLER_FUNNEL, SELLER_TRAFFIC_CLASSES, SellerError, splitSellerPrice } from './core/seller-policy.js';
import { prepareSellerPayout, submitSellerPayout, confirmSellerPayout } from './core/seller-payout.js';

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export function sellerStore(env, suffix = 'index') { return env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName(`seller-gateway-v1:${suffix}`)); }
export async function sellerCall(env, path, body = {}, suffix = 'index') {
  const r = await sellerStore(env, suffix).fetch(`https://seller-state${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new SellerError(data.error || 'seller_storage_unavailable', r.status);
  return data;
}
export async function protectSellerSecret(env, plaintext) {
  const r = await env.EGRESS_KEYS.get(env.EGRESS_KEYS.idFromName('root-v1')).fetch('https://egress-key/encrypt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plaintext }) });
  if (!r.ok) throw new SellerError('upstream_secret_storage_unavailable', 503);
  return r.json();
}
export async function openSellerSecret(env, envelope) {
  const r = await env.EGRESS_KEYS.get(env.EGRESS_KEYS.idFromName('root-v1')).fetch('https://egress-key/decrypt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ envelope }) });
  if (!r.ok) throw new SellerError('upstream_secret_unavailable', 503);
  return (await r.json()).plaintext;
}
const counts = () => ({ paid_transactions: 0, gross_atomic: '0', platform_fee_atomic: '0', seller_credit_atomic: '0', seller_payout_atomic: '0', unfulfilled_atomic: '0', same_owner_retained_atomic: '0', failed_payment_attempts: 0, funnel: Object.fromEntries(SELLER_FUNNEL.map(k => [k, 0])) });
const emptyRevenue = () => ({ schema_version: 1, currency: 'USDC', decimals: 6, observed_since: new Date().toISOString(), classes: Object.fromEntries(SELLER_TRAFFIC_CLASSES.map(k => [k, counts()])), recent_failures: [], recent_events: [] });
const add = (a, b) => (BigInt(a || '0') + BigInt(b || '0')).toString();
const monetary = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,8})$/.test(value);

// Called only from the existing payment operation DO, after its durable state
// transition. An outbox/alarm retries index delivery, never the buyer payment.
export async function syncSellerCommerce(state, env, record) {
  if (!record.input?.marketplace || !['settled', 'credited', 'succeeded'].includes(record.status)) return false;
  record.seller_ledger_status = 'pending';
  await state.storage.put('operation', record);
  await state.storage.put('commerce_pending', true);
  try {
    const m = record.input.marketplace;
    await sellerCall(env, '/seller/commerce', { operation_hash: record.authorization_fingerprint, request_id: record.request_id, seller_id: m.seller_id, service_id: m.service_id, payout_destination: m.payout_destination, traffic_class: record.marketplace_traffic_class || 'INTERNAL', transaction: record.transaction, network: record.network, status: record.status, gross_atomic: record.amount, ...splitSellerPrice(record.amount, m.platform_fee), proof: record.status === 'succeeded' ? record.proof?.proof : null, receipt_signature: record.status === 'succeeded' ? record.receipt?.signature : null });
    await state.storage.delete('commerce_pending');
    await state.storage.delete('commerce_sync_attempts');
    record.seller_ledger_status = 'recorded';
    await state.storage.put('operation', record);
  } catch {
    const attempts = Number(await state.storage.get('commerce_sync_attempts') || 0) + 1;
    await state.storage.put('commerce_sync_attempts', attempts);
    await state.storage.setAlarm(Date.now() + Math.min(3600000, attempts * 30000));
    record.seller_ledger_status = 'pending';
  }
  return true;
}

export async function sellerStateRoute(state, env, path, body) {
  if (!path.startsWith('/seller/')) return null;
  const db = state.storage;
  if (path === '/seller/register') {
    if (!/^sel_[a-f0-9]{32}$/.test(body.seller_id || '') || !/^[a-f0-9]{64}$/.test(body.key_hash || '')) return reply({ error: 'invalid_seller_identity' }, 400);
    await db.transaction(async tx => {
      if (await tx.get(`seller:${body.seller_id}`)) throw new SellerError('seller_exists', 409);
      await tx.put(`seller:${body.seller_id}`, { seller_id: body.seller_id, name: body.name, key_hash: body.key_hash, created_at: new Date().toISOString() });
      await tx.put(`seller-key:${body.key_hash}`, body.seller_id);
    });
    return reply({ seller_id: body.seller_id }, 201);
  }
  if (path === '/seller/auth') {
    const id = await db.get(`seller-key:${body.key_hash}`);
    const seller = id && await db.get(`seller:${id}`);
    return seller ? reply({ seller: { seller_id: seller.seller_id, name: seller.name } }) : reply({ error: 'seller_authentication_required' }, 401);
  }
  if (path === '/seller/service-create') {
    let error;
    await db.transaction(async tx => {
      const key = `services:${body.service.seller_id}`;
      const owned = await tx.get(key) || [];
      const catalog = await tx.get('catalog') || [];
      if (owned.length >= 20 || catalog.length >= 2000) { error = 'seller_service_limit'; return; }
      if (owned.includes(body.service.service_id)) { error = 'service_exists'; return; }
      await tx.put(`service:${body.service.service_id}`, body.service);
      await tx.put(key, [...owned, body.service.service_id]);
      await tx.put('catalog', [...catalog, body.service.service_id]);
    });
    return error ? reply({ error }, 409) : reply({ service_id: body.service.service_id }, 201);
  }
  if (path === '/seller/service-get') {
    const service = await db.get(`service:${body.service_id}`);
    return service ? reply({ service }) : reply({ error: 'service_not_found' }, 404);
  }
  if (path === '/seller/service-status') {
    const service = await db.get(`service:${body.service_id}`);
    if (!service || service.seller_id !== body.seller_id) return reply({ error: 'service_not_found' }, 404);
    if (!['active', 'paused', 'draft'].includes(body.status)) return reply({ error: 'invalid_service_status' }, 400);
    await db.put(`service:${body.service_id}`, { ...service, status: body.status });
    return reply({ ok: true, status: body.status });
  }
  if (path === '/seller/catalog') {
    const ids = await db.get(body.seller_id ? `services:${body.seller_id}` : 'catalog') || [];
    const services = await Promise.all(ids.map(id => db.get(`service:${id}`)));
    return reply({ services: services.filter(Boolean) });
  }
  if (path === '/seller/event') {
    const traffic = SELLER_TRAFFIC_CLASSES.includes(body.traffic_class) ? body.traffic_class : 'INTERNAL';
    if (!SELLER_FUNNEL.includes(body.event) && body.event !== 'failure') return reply({ error: 'invalid_funnel_event' }, 400);
    await db.transaction(async tx => {
      const eventKey = `event:${traffic}:${body.request_id}:${body.event}:${body.reason || ''}`;
      if (await tx.get(eventKey)) return;
      await tx.put(eventKey, true);
      const revenue = await tx.get('revenue') || emptyRevenue();
      const row = { at: new Date().toISOString(), event: body.event, traffic_class: traffic, request_id: String(body.request_id || '').slice(0, 128), service_id: String(body.service_id || '').slice(0, 64), reason: /^[a-z_]{1,80}$/.test(body.reason || '') ? body.reason : undefined };
      if (body.event !== 'failure') revenue.classes[traffic].funnel[body.event]++;
      else {
        revenue.recent_failures = [...revenue.recent_failures.slice(-99), row];
        if (body.payment_failure === true) revenue.classes[traffic].failed_payment_attempts++;
      }
      revenue.recent_events = [...revenue.recent_events.slice(-99), row];
      await tx.put('revenue', revenue);
    });
    return reply({ ok: true });
  }
  if (path === '/seller/commerce') {
    if (!/^[a-f0-9]{64}$/.test(body.operation_hash || '') || !/^0x[a-fA-F0-9]{64}$/.test(body.transaction || '') || body.network !== 'eip155:8453' || !['settled', 'credited', 'succeeded'].includes(body.status) || ![body.gross_atomic, body.platform_fee_atomic, body.seller_proceeds_atomic].every(monetary) || BigInt(body.gross_atomic) !== BigInt(body.platform_fee_atomic) + BigInt(body.seller_proceeds_atomic) || !SELLER_TRAFFIC_CLASSES.includes(body.traffic_class)) return reply({ error: 'invalid_seller_settlement' }, 400);
    if (body.status === 'succeeded' && (!body.proof || !body.receipt_signature)) return reply({ error: 'seller_delivery_evidence_required' }, 409);
    let delivered;
    await db.transaction(async tx => {
      const key = `sale:${body.operation_hash}`;
      const prior = await tx.get(key);
      if (prior && (prior.transaction !== body.transaction || prior.gross_atomic !== body.gross_atomic || prior.platform_fee_atomic !== body.platform_fee_atomic || prior.seller_proceeds_atomic !== body.seller_proceeds_atomic || prior.payout_destination !== body.payout_destination || prior.seller_id !== body.seller_id || prior.service_id !== body.service_id || prior.traffic_class !== body.traffic_class)) throw new SellerError('seller_accounting_conflict', 409);
      const rank = { settled: 1, credited: 2, succeeded: 3 };
      if (prior && rank[prior.status] >= rank[body.status]) { delivered = prior.status === 'succeeded' ? prior : null; return; }
      const revenue = await tx.get('revenue') || emptyRevenue();
      const aggregate = revenue.classes[body.traffic_class];
      const sellerKey = `earnings:${body.seller_id}:${body.traffic_class}`;
      const earnings = await tx.get(sellerKey) || { gross_atomic: '0', earned_atomic: '0', paid_out_atomic: '0', platform_fee_atomic: '0', transactions: 0 };
      if (!prior) { aggregate.gross_atomic = add(aggregate.gross_atomic, body.gross_atomic); aggregate.unfulfilled_atomic = add(aggregate.unfulfilled_atomic, body.gross_atomic); earnings.gross_atomic = add(earnings.gross_atomic, body.gross_atomic); }
      const record = { ...body, created_at: prior?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
      if (body.status === 'succeeded') {
        aggregate.unfulfilled_atomic = (BigInt(aggregate.unfulfilled_atomic || '0') - BigInt(body.gross_atomic)).toString();
        aggregate.paid_transactions++; aggregate.platform_fee_atomic = add(aggregate.platform_fee_atomic, body.platform_fee_atomic); aggregate.seller_credit_atomic = add(aggregate.seller_credit_atomic, body.seller_proceeds_atomic); aggregate.funnel.xguard_fee_earned++;
        earnings.earned_atomic = add(earnings.earned_atomic, body.seller_proceeds_atomic); earnings.platform_fee_atomic = add(earnings.platform_fee_atomic, body.platform_fee_atomic); earnings.transactions++;
        delivered = record;
      }
      const recentKey = `transactions:${body.seller_id}`;
      const recent = await tx.get(recentKey) || [];
      await tx.put(recentKey, [record.operation_hash, ...recent.filter(x => x !== record.operation_hash)].slice(0, 100));
      await tx.put(key, record); await tx.put('revenue', revenue); await tx.put(sellerKey, earnings);
    });
    if (delivered) await sellerCall(env, '/seller/payout-create', delivered, `payout:${body.operation_hash}`);
    return reply({ ok: true });
  }
  if (path === '/seller/summary') {
    const revenue = await db.get('revenue') || emptyRevenue();
    if (!body.seller_id) return reply(revenue);
    const hashes = await db.get(`transactions:${body.seller_id}`) || [];
    const transactions = await Promise.all(hashes.map(hash => db.get(`sale:${hash}`)));
    const earnings_by_traffic_class = {};
    for (const traffic of SELLER_TRAFFIC_CLASSES) earnings_by_traffic_class[traffic] = await db.get(`earnings:${body.seller_id}:${traffic}`) || { gross_atomic: '0', earned_atomic: '0', paid_out_atomic: '0', same_owner_retained_atomic: '0', platform_fee_atomic: '0', transactions: 0 };
    return reply({ earnings: earnings_by_traffic_class.REAL, earnings_by_traffic_class, transactions });
  }
  if (path === '/seller/payout-create') {
    if (!await db.get('seller_payout')) {
      await db.put('seller_payout', { ...body, payout_status: 'pending', attempts: 0 });
      await db.setAlarm(Date.now() + 1000);
    }
    return reply({ ok: true });
  }
  if (path === '/seller/payout-confirm') {
    await db.transaction(async tx => {
      const sale = await tx.get(`sale:${body.operation_hash}`);
      if (!sale || sale.status !== 'succeeded') throw new SellerError('sale_not_delivered', 409);
      if (sale.payout_status === 'confirmed' || sale.payout_status === 'same_owner_retained') return;
      if (!['confirmed', 'same_owner_retained'].includes(body.payout_status) || (body.payout_status === 'confirmed' && !/^0x[a-fA-F0-9]{64}$/.test(body.payout_transaction || ''))) throw new SellerError('payout_evidence_required', 409);
      const revenue = await tx.get('revenue'); const earnings = await tx.get(`earnings:${sale.seller_id}:${sale.traffic_class}`);
      // Same-owner retention is explicitly labelled; it is not a new chain transfer.
      const field = body.payout_status === 'confirmed' ? 'seller_payout_atomic' : 'same_owner_retained_atomic';
      revenue.classes[sale.traffic_class][field] = add(revenue.classes[sale.traffic_class][field], sale.seller_proceeds_atomic);
      const earningsField = body.payout_status === 'confirmed' ? 'paid_out_atomic' : 'same_owner_retained_atomic';
      earnings[earningsField] = add(earnings[earningsField], sale.seller_proceeds_atomic);
      await tx.put(`sale:${body.operation_hash}`, { ...sale, payout_status: body.payout_status, payout_transaction: body.payout_transaction || null });
      await tx.put('revenue', revenue); await tx.put(`earnings:${sale.seller_id}:${sale.traffic_class}`, earnings);
    });
    return reply({ ok: true });
  }
  if (path === '/seller/request-reserve') {
    let conflict = false;
    await db.transaction(async tx => {
      const key = `request:${body.key_hash}`;
      const prior = await tx.get(key);
      if (prior && (prior.operation_hash !== body.operation_hash || prior.request_digest !== body.request_digest)) { conflict = true; return; }
      if (!prior) await tx.put(key, { operation_hash: body.operation_hash, request_digest: body.request_digest });
    });
    return conflict ? reply({ error: 'seller_idempotency_conflict' }, 409) : reply({ ok: true });
  }
  if (path === '/seller/payout-status') {
    const payout = await db.get('seller_payout');
    return reply({ payout_status: payout?.payout_status || 'not_started', reason: payout?.reason, payout_transaction: payout?.payout_transaction || null });
  }
  return reply({ error: 'seller_state_route_unknown' }, 404);
}

export async function sellerStage(env, record, event, reason) {
  if (!record.input?.marketplace) return;
  await sellerCall(env, '/seller/event', { event, reason, request_id: record.request_id, service_id: record.input.marketplace.service_id, traffic_class: record.marketplace_traffic_class || 'INTERNAL' }).catch(() => {});
}

export async function sellerPayoutAlarm(state, env) {
  const db = state.storage;
  let payout = await db.get('seller_payout');
  if (!payout) return false;
  if (payout.payout_status === 'pending') {
    try {
      const prepared = await prepareSellerPayout(env, payout);
      payout = { ...payout, prepared, payout_status: prepared.mode === 'same_owner_retained' ? 'same_owner_retained' : 'submission_reserved' };
      await db.put('seller_payout', payout); // durable reservation BEFORE any money is sent
      if (prepared.mode !== 'same_owner_retained') {
        await db.setAlarm(Date.now() + 30000);
        const outcome = await submitSellerPayout(prepared);
        payout = { ...payout, ...outcome, payout_status: outcome.definite_rejection ? 'rejected' : 'awaiting_chain_evidence' };
        await db.put('seller_payout', payout);
      }
    } catch { payout = { ...payout, payout_status: payout.prepared ? 'awaiting_chain_evidence' : 'configuration_blocked', reason: 'payout_requires_recovery' }; await db.put('seller_payout', payout); }
  }
  if (['submission_reserved', 'awaiting_chain_evidence'].includes(payout.payout_status)) {
    const confirmed = await confirmSellerPayout(env, payout);
    if (confirmed) { payout = { ...payout, payout_status: 'confirmed', payout_transaction: confirmed.transaction }; delete payout.prepared; await db.put('seller_payout', payout); }
    else if ((payout.attempts || 0) < 12) { await db.put('seller_payout', { ...payout, attempts: (payout.attempts || 0) + 1 }); await db.setAlarm(Date.now() + 60000); }
  }
  if (['confirmed', 'same_owner_retained'].includes(payout.payout_status)) {
    try { await sellerCall(env, '/seller/payout-confirm', { operation_hash: payout.operation_hash, payout_status: payout.payout_status, payout_transaction: payout.payout_transaction }); }
    catch { await db.setAlarm(Date.now() + 30000); }
  }
  return true;
}
