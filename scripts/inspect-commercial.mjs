// Read-only production evidence. A 402 challenge is not a purchase or revenue.
const api = "https://api.xguardgate.com";
const deployment = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || String(Date.now());
const rows = await Promise.all(["/v1/pricing", "/v1/metrics", "/v1/egress", "/v1/egress/stats", "/v1/payment/readiness"].map(async path => {
  const response = await fetch(`${api}${path}?deployment_probe=${encodeURIComponent(deployment)}`, { headers: { "cache-control": "no-cache", "x-xguard-traffic-class": "synthetic", "user-agent": "xguard-commercial-observer/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return [path, await response.json()];
}));
const data = Object.fromEntries(rows);
let paidCreditAccount = { available: false, reason: "operator_key_not_configured" };
if (process.env.XGUARD_OPERATOR_KEY) {
  try {
    const results = await Promise.all(["/v1/balance", "/v1/ledger"].map(async path => {
      const response = await fetch("https://hooks.xguardgate.com" + path, { headers: { authorization: `Bearer ${process.env.XGUARD_OPERATOR_KEY}` }, signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) throw new Error(`billing_HTTP_${response.status}`);
      return response.json();
    }));
    const [balance, ledger] = results;
    paidCreditAccount = { available: true, granted_credits: balance.granted, consumed_credits: balance.consumed, remaining_credits: balance.credits, purchase_entries_in_recent_page: (ledger.entries || []).filter(entry => entry.type === "purchase").length, verified_cash_amount: null, limitation: "Recent credit journal entries do not expose original cash amount, processing fees or test-mode status; not verified company revenue" };
  } catch { paidCreditAccount = { available: false, reason: "operator_account_read_failed" }; }
}
const evidence = {
  observed_at: new Date().toISOString(),
  source: api,
  worker_payment_ready: data["/v1/payment/readiness"].production_payment_ready,
  price: data["/v1/pricing"].tools?.["xguard.web.fetch"],
  historical_settlement_counter_usd_micros: data["/v1/metrics"].real_revenue_usd_micros,
  delivery_ledger: data["/v1/metrics"].economics,
  paid_credit_account: paidCreditAccount,
  secretless_egress: {
    attempts: data["/v1/egress/stats"].attempts,
    billed_credits: data["/v1/egress/stats"].billed_credits,
    upstream_2xx: data["/v1/egress/stats"].upstream_2xx,
    idempotency: data["/v1/egress"].idempotency,
    credits_are_not_verified_cash_receipts: true,
  },
  limitations: ["No wallet was funded and no payment was made by this observer", "Counters are application observations, not an independent audit of all chain or card receipts", "New delivery ledger has no historical backfill", "Actual infrastructure and payment costs are not reconciled to invoices"],
};
console.log(JSON.stringify(evidence, null, 2));
