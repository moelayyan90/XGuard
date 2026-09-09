import { outcomeDefinition } from "./outcome-catalog.js";

const ratio = (n, d) => d ? n / d : null;
function cap(value) { const id = String(value || "").replace(/^xguard\./, ""); return outcomeDefinition(id) ? id : null; }

export function applyOutcomeMetric(current, body) {
  if (body.traffic_class !== "external" || body.environment === "test") return;
  const id = cap(body.capability || body.tool);
  if (!id && !["discovery_seen", "capability_viewed", "execute_attempted", "intent_normalized"].includes(body.event)) return;
  current.product ||= { since: new Date().toISOString(), events: {}, capabilities: {}, first_result_ms: [] };
  const product = current.product;
  product.events[body.event] = (product.events[body.event] || 0) + 1;
  if (!id) return;
  const entry = product.capabilities[id] ||= { events: {}, failure_causes: {}, result_ms: [] };
  entry.events[body.event] = (entry.events[body.event] || 0) + 1;
  if (body.outcome && /failed|rejected/.test(body.event)) entry.failure_causes[body.outcome] = (entry.failure_causes[body.outcome] || 0) + 1;
  if (body.event === "result_returned" && Number.isFinite(body.first_result_ms) && body.first_result_ms >= 0) {
    entry.result_ms.push(body.first_result_ms); entry.result_ms = entry.result_ms.slice(-256);
    product.first_result_ms.push(body.first_result_ms); product.first_result_ms = product.first_result_ms.slice(-256);
  }
}

export async function applyOutcomeCommerce(txn, body, previous, snapshot) {
  const id = cap(body.capability);
  if (!id) return;
  const key = `product:commerce:${id}`;
  const current = await txn.get(key) || { capability: id, settled_cash_usd_micros: 0, recognized_revenue_usd_micros: 0,
    unfulfilled_liability_usd_micros: 0, successful_paid_executions: 0, estimated_contribution_usd_micros: 0,
    paying_wallets: 0, repeat_paying_wallets: 0, actual_gross_margin: null };
  for (const field of ["settled_cash_usd_micros", "recognized_revenue_usd_micros", "unfulfilled_liability_usd_micros", "successful_paid_executions", "estimated_contribution_usd_micros"]) current[field] += snapshot[field] - (previous?.[field] || 0);
  if (snapshot.successful_paid_executions && !previous?.successful_paid_executions) {
    const walletKey = `product:wallet:${id}:${body.payer_hash}`;
    const count = await txn.get(walletKey) || 0;
    if (!count) current.paying_wallets++;
    if (count === 1) current.repeat_paying_wallets++;
    await txn.put(walletKey, count + 1);
  }
  await txn.put(key, current);
}

function median(values) { if (!values?.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export async function outcomeMetrics(storage, current) {
  const product = current.product || { since: null, events: {}, capabilities: {}, first_result_ms: [] };
  const e = product.events;
  const commerce = {};
  for (const id of ["web-extraction", "product-offers", "feed-digest"]) commerce[id] = await storage.get(`product:commerce:${id}`) || null;
  const complete = Object.values(commerce).filter(Boolean);
  const paidSuccessEvents = Object.entries(product.capabilities).filter(([id]) => id !== "extract-preview").reduce((n, [, x]) => n + (x.events.execution_succeeded || 0), 0);
  const wallets = complete.reduce((n, x) => n + x.paying_wallets, 0);
  const repeats = complete.reduce((n, x) => n + x.repeat_paying_wallets, 0);
  return { ...product, commerce,
    KPI: {
      DiscoveryToCapabilityView: ratio(e.capability_viewed || 0, e.discovery_seen),
      CapabilityViewToExecute: ratio(e.execute_attempted || 0, e.capability_viewed),
      ExecuteToPaymentRequired: ratio(e.payment_required || 0, e.execute_attempted),
      PaymentRequiredToPaid: ratio(e.payment_verified || 0, e.payment_required),
      PaidToSuccess: ratio(paidSuccessEvents, e.payment_verified),
      SuccessToRepeat: ratio(repeats, wallets),
      RevenuePerCapability: Object.fromEntries(Object.entries(commerce).map(([k, v]) => [k, v?.recognized_revenue_usd_micros || 0])),
      GrossMarginPerCapability: Object.fromEntries(Object.entries(commerce).map(([k]) => [k, null])),
      MedianTimeToFirstResult: median(product.first_result_ms),
      ProviderFailureRate: ratio(e.provider_failed || 0, (e.provider_failed || 0) + (e.provider_succeeded || 0)),
    }, measurement: { funnel: "Event ratios, not unique-user cohorts; direct calls can skip discovery. Retries can produce repeated events.",
      repeat: "Per-capability repeat settled payer wallets, not identified people.",
      first_value: "Last 256 externally returned results: paid quote issuance to delivery, or free request processing. No client installation time.",
      margin: "Actual infrastructure/payment costs are unavailable; budget contribution is separate from gross profit.", historical_backfill: false } };
}
