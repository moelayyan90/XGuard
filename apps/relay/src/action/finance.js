import { actionCall } from './state.js';

function usdCents(amount) {
  if (amount?.currency_code !== 'USD' || !/^\d{1,10}\.\d{2}$/.test(amount.value)) return null;
  return Number(amount.value.replace('.', ''));
}

// Emit only the fields needed by the owner. Private input, tokens, payer details
// and the underlying PayPal references stay inside their original order object.
export function financialRow(order) {
  const captured = order.capture?.status === 'COMPLETED' ? usdCents(order.capture.amount) : null;
  const fee = usdCents(order.capture?.seller_receivable_breakdown?.paypal_fee);
  const denied = order.error === 'provider_capture_denied';
  const refund = Number.isSafeInteger(order.confirmed_refund_cents) ? order.confirmed_refund_cents
    : order.status === 'REFUNDED' ? order.amount_cents
    : order.error?.includes('partial_refund') ? null : 0;
  return {
    id: order.id, name: order.name, status: order.status, created_at: order.created_at,
    updated_at: order.updated_at, quoted_cents: order.amount_cents, captured_cents: captured,
    fee_cents: fee, refund_cents: refund, denied, delivered: Boolean(order.receipt?.proof),
    review: ['REVIEW_REQUIRED', 'REFUND_REQUIRED', 'REVERSED', 'PAYMENT_UNKNOWN'].includes(order.status),
    liability_cents: order.status === 'REFUND_REQUIRED' ? order.liability?.amount_cents ?? null : 0,
  };
}

export async function financePage(env, after) {
  const { entries, next } = await actionCall(env, 'references', 'finance-page', { after });
  const unique = [...new Set(entries.map(entry => entry.id))];
  const refs = new Set(entries.map(entry => entry.ref));
  const rows = await Promise.all(unique.map(async id => {
    const { record } = await actionCall(env, id, 'inspect');
    if (record.environment !== 'live') return null;
    // The original reference index includes both the order and its captures.
    // Include each order only on the page holding its canonical provider order ID.
    if (!record.paypal_order_id) throw new Error('order_mapping_incomplete');
    return refs.has(record.paypal_order_id) ? financialRow(record) : null;
  }));
  return { rows: rows.filter(Boolean), next, scope: 'mapped_xguard_paypal_live_orders', as_of: new Date().toISOString() };
}
