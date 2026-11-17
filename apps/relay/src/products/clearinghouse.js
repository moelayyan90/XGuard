import { definition, object, list, reference, number, currency, unique, fail, safeNumber } from './common.js';

export const clearinghouse = definition('reconcile-invoices', 'Invoice & payment reconciliation', 'Match supplied invoice IDs to payment and refund records in integer USD cents. Reports unpaid, partial and overpaid balances. Does not independently verify settlement, move funds or recognize customer-supplied data as XGuard revenue.', object({ currency, invoices: list(object({ id: reference, amount_cents: number() }), 50), payments: { type: 'array', minItems: 0, maxItems: 100, items: object({ id: reference, invoice_id: reference, amount_cents: number(), refunded_cents: number() }) } }), { currency: 'USD', invoices: [{ id: 'invoice-1', amount_cents: 10000 }], payments: [{ id: 'capture-1', invoice_id: 'invoice-1', amount_cents: 10000, refunded_cents: 0 }] }, input => {
  const totals = new Map();
  for (const payment of input.payments) totals.set(payment.invoice_id, (totals.get(payment.invoice_id) || 0n) + BigInt(payment.amount_cents) - BigInt(payment.refunded_cents));
  return { currency: input.currency, invoices: input.invoices.map(invoice => {
    const paid = safeNumber(totals.get(invoice.id) || 0n), delta = invoice.amount_cents - paid;
    return { id: invoice.id, amount_cents: invoice.amount_cents, net_paid_cents: paid, outstanding_cents: Math.max(0, delta), overpaid_cents: Math.max(0, -delta), status: delta === 0 ? 'MATCHED' : delta < 0 ? 'OVERPAID' : paid ? 'PARTIAL' : 'UNPAID' };
  }), unmatched_payments: input.payments.filter(p => !input.invoices.some(i => i.id === p.invoice_id)).map(p => p.id), settlement_independently_verified: false, funds_moved: false };
}, input => { unique(input.invoices); unique(input.payments); for (const p of input.payments) if (p.refunded_cents > p.amount_cents) throw fail('refund_exceeds_payment', 422); });
