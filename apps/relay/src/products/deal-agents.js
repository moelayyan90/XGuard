import { definition, object, list, reference, number, currency, text, unique, safeNumber, subtotal, fail, iso } from './common.js';

const offerSchema = object({ id: reference, supplier: reference, unit_cents: number(), quantity: { ...number(1000000), minimum: 1 }, fees_cents: number(), delivery_days: number(365), agreement_reference: text(300), valid_until: text(30), tags: { type: 'array', minItems: 0, maxItems: 20, items: reference } });
export const offerInput = object({ currency, now: text(30), budget_cents: number(), max_delivery_days: number(365), required_tags: { type: 'array', minItems: 0, maxItems: 10, items: reference }, offers: list(offerSchema, 30) });
export const offerExample = { currency: 'USD', now: '2026-11-17T00:00:00Z', budget_cents: 100000, max_delivery_days: 7, required_tags: ['gpu'], offers: [{ id: 'offer-1', supplier: 'example-supplier', unit_cents: 500, quantity: 10, fees_cents: 100, delivery_days: 2, agreement_reference: 'buyer supplied quote', valid_until: '2026-12-01T00:00:00Z', tags: ['gpu'] }] };
export function checkOffers(input) { unique(input.offers); iso(input.now); for (const offer of input.offers) { iso(offer.valid_until); safeNumber(BigInt(subtotal(offer.unit_cents, offer.quantity)) + BigInt(offer.fees_cents)); } }
export function compareOffers(input) {
  const offers = input.offers.map(offer => {
    const total = subtotal(offer.unit_cents, offer.quantity) + offer.fees_cents, reasons = [];
    if (Date.parse(offer.valid_until) <= Date.parse(input.now)) reasons.push('offer_expired');
    if (total > input.budget_cents) reasons.push('budget_exceeded');
    if (offer.delivery_days > input.max_delivery_days) reasons.push('delivery_too_late');
    if (!input.required_tags.every(t => offer.tags.includes(t))) reasons.push('capability_missing');
    return { id: offer.id, supplier: offer.supplier, total_cents: total, delivery_days: offer.delivery_days, eligible: reasons.length === 0, reasons, agreement_reference: offer.agreement_reference, quote_independently_verified: false };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.total_cents - b.total_cents || a.delivery_days - b.delivery_days || a.id.localeCompare(b.id));
  return { currency: input.currency, offers, selected_offer: offers.find(o => o.eligible)?.id ?? null, ranking: 'Eligibility, total cost, delivery days, stable offer ID. No commission preference.', negotiation_performed: false, supplier_contacted: false, binding_order_placed: false, commission_earned_cents: 0 };
}
export const dealAgents = definition('compare-offers', 'RFQ offer comparison', 'Compare your supplier quotes by total cost, capability, expiry, budget and delivery. Explicit fee breakdown and ranking. No autonomous negotiation, supplier commitment or commission collection without an approved partner adapter.', offerInput, offerExample, compareOffers, checkOffers);
